import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Server-side selection contract for the NEW workspace only. It does not alter the
 * copy-only ChatGPT preview runtime. The adapter builds this index from the exact
 * bound canonical document and verified artifact catalog, then persists it. Neither
 * a hash nor a client-supplied index is authority, proof of pixel QA, or an edit.
 */
// Identifiers are exact bindings, not user prose. Normalizing here could validate
// a stored manifest hash while the resolver reads different, unnormalized targets.
const id = z.string().min(1).max(200).refine(value => value === value.trim(), 'Use an exact identifier.');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.object({ id, kind: z.literal('text'), slot: id, text_hash: hash }).strict();
const image = z.object({ id, kind: z.literal('image'), slot: id, canonical_slot: id, artifact_revision: id, sha256: hash }).strict();
const section = z.object({ id, kind: z.literal('section'), children: z.array(id).min(1).max(500) }).strict();
const schema = z.object({
  task_id: id, content_revision: id, template_version: id, canonical_hash: hash,
  render_hash: hash, elements: z.array(z.discriminatedUnion('kind', [text, image, section])).min(1).max(600),
}).strict();
type ManifestInput = z.infer<typeof schema>;
export type WorkspaceReviewManifest = ManifestInput & { index_id: string };
const digest = (input: ManifestInput) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

export function buildWorkspaceReviewManifest(input: unknown): WorkspaceReviewManifest {
  const parsed = schema.parse(input);
  const byId = new Map(parsed.elements.map(element => [element.id, element]));
  if (byId.size !== parsed.elements.length) throw new Error('DUPLICATE_ELEMENT');
  const textSlots = new Set<string>();
  const imageSlots = new Set<string>();
  const assets = new Map<string, string>();
  for (const element of parsed.elements) {
    if (element.kind === 'section') {
      if (new Set(element.children).size !== element.children.length || element.children.some(child => !byId.has(child) || byId.get(child)!.kind === 'section')) throw new Error('INVALID_SECTION_CHILDREN');
    } else if (element.kind === 'text') {
      if (textSlots.has(element.slot)) throw new Error('DUPLICATE_TEXT_SLOT');
      textSlots.add(element.slot);
    } else {
      if (imageSlots.has(element.slot)) throw new Error('DUPLICATE_IMAGE_SLOT');
      imageSlots.add(element.slot);
      const revision = JSON.stringify([element.artifact_revision, element.sha256]);
      if (assets.has(element.canonical_slot) && assets.get(element.canonical_slot) !== revision) throw new Error('RESPONSIVE_ALIAS_CONFLICT');
      assets.set(element.canonical_slot, revision);
    }
  }
  return { ...parsed, index_id: digest(parsed) };
}

const requestSchema = z.object({
  task_id: id, content_revision: id, render_hash: hash, index_id: hash,
  groups: z.array(z.object({
    instruction: z.string().trim().min(1).max(4000),
    element_ids: z.array(id).min(1).max(500),
    viewport_width: z.number().int().min(240).max(10000),
    reference_ids: z.array(id).max(16).refine(ids => new Set(ids).size === ids.length).optional(),
  }).strict()).min(1).max(10),
}).strict();

/** Read current manifest from the database and authorize the actor BEFORE calling.
 * Returns bounded edit intent only. The task reducer/outbox starts the real async
 * action; generation, template binding, QA and delivery still require real receipts.
 */
export function resolveWorkspaceElementFeedback(current: WorkspaceReviewManifest, input: unknown) {
  const { index_id, ...body } = current;
  const verified = buildWorkspaceReviewManifest(body);
  if (verified.index_id !== index_id) throw new Error('INVALID_CURRENT_MANIFEST');
  const request = requestSchema.parse(input);
  if (request.task_id !== current.task_id || request.content_revision !== current.content_revision || request.render_hash !== current.render_hash || request.index_id !== current.index_id) throw new Error('STALE_PREVIEW');
  const byId = new Map(verified.elements.map(element => [element.id, element]));
  const assigned = new Set<string>();
  const groups = request.groups.map(group => {
    const leafIds = new Set<string>();
    for (const selected of group.element_ids) {
      const entry = byId.get(selected);
      if (!entry) throw new Error('UNKNOWN_ELEMENT');
      if (entry.kind === 'section') entry.children.forEach(child => leafIds.add(child));
      else leafIds.add(entry.id);
    }
    const targets = [...leafIds].map(leaf => byId.get(leaf)!);
    const texts = targets.filter((entry): entry is z.infer<typeof text> => entry.kind === 'text');
    const images = targets.filter((entry): entry is z.infer<typeof image> => entry.kind === 'image');
    // Responsive aliases and section+child selections may select the same logical
    // asset once in one group. Conflicting instructions across groups are rejected.
    const logical = new Set([...texts.map(entry => 'text:' + entry.slot), ...images.map(entry => 'asset:' + entry.canonical_slot)]);
    for (const target of logical) {
      if (assigned.has(target)) throw new Error('OVERLAPPING_FEEDBACK_GROUPS');
      assigned.add(target);
    }
    const uniqueAssets = [...new Map(images.map(entry => [entry.canonical_slot, { canonical_slot: entry.canonical_slot, artifact_revision: entry.artifact_revision, sha256: entry.sha256 }])).values()];
    return { instruction: group.instruction, viewport_width: group.viewport_width, ...(group.reference_ids ? { reference_ids: group.reference_ids } : {}),
      element_ids: [...leafIds], text_slots: texts.map(entry => ({ slot: entry.slot, text_hash: entry.text_hash })), assets: uniqueAssets };
  });
  return { task_id: current.task_id, content_revision: current.content_revision,
    index_id: current.index_id, render_hash: current.render_hash, groups,
    status: 'RESOLVED_INTENT_NOT_EXECUTED' as const };
}
