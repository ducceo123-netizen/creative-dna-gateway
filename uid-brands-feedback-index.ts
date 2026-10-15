import { createHash } from "node:crypto";
import { z } from "zod";
import { ONEPAGE_DELIVERY_ROLES } from "./supabase/functions/_shared/onepage-packaging.ts";

const identity = z.string().min(1).max(200).refine(s => s === s.trim());
const canonicalSlot = identity.refine(s => Object.hasOwn(ONEPAGE_DELIVERY_ROLES, s), "Use an exact canonical production slot.");
const label = z.string().trim().min(1).max(200);
const normalize = (s: string) => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const mediaSchema = z.object({ file_id: identity.regex(/^[A-Za-z0-9_-]+$/), label }).strict();
const entrySchema = z.object({
  ordinal: z.number().int().positive(), asset_id: identity, canonical_slot: canonicalSlot.optional(),
  name: label.nullable(), group: label.nullable(),
  position: z.union([label, z.number().finite()]).nullable(),
  media: z.array(mediaSchema).max(24),
  preview_availability: z.enum(["reference_only", "unavailable"]),
}).strict();
const indexSchema = z.object({
  index_id: identity, stage: identity, task_id: identity, content_version: identity,
  branch: identity.optional(), retry_id: identity.optional(),
  entries: z.array(entrySchema).min(1).max(100),
}).strict();
const inputSchema = z.object({
  stage: identity, task_id: identity, content_version: identity,
  branch: identity.optional(), retry_id: identity.optional(),
  assets: z.array(z.object({
    id: identity.optional(), asset_id: identity.optional(), canonical_slot: canonicalSlot.optional(),
    label: label.optional(), asset_name: label.optional(), name: label.optional(),
    element: label.optional(), section: label.optional(),
    position: z.union([label, z.number().finite()]).optional(),
  })).min(1).max(100),
  result_images: z.array(mediaSchema.extend({ asset_id: identity.optional() })).max(24).optional(),
});
export type FeedbackIndex = z.infer<typeof indexSchema>;
export type FeedbackIndexEntry = FeedbackIndex["entries"][number];
export type FeedbackFailure = { ok: false; code: string; message: string; recovery: string };
const fail = (code: string, message: string, recovery = "Rebuild the inventory from the current task and exact content version, show its numbered entries, then ask the user to select again."): FeedbackFailure => ({ ok: false, code, message, recovery });
const digest = (index: Omit<FeedbackIndex, "index_id">) => `feedback:${createHash("sha256").update(JSON.stringify([
  index.stage, index.task_id, index.content_version, index.branch ?? null, index.retry_id ?? null,
  index.entries.map(e => [e.ordinal, e.asset_id, e.name, e.group, e.position, e.media.map(m => [m.file_id, m.label]), e.preview_availability, ...(e.canonical_slot ? [e.canonical_slot] : [])]),
])).digest("hex")}`;

/** Pure correlation inventory. IDs and hashes are not authentication or execution permission. */
export function buildFeedbackIndex(input: unknown): { ok: true; index: FeedbackIndex } | FeedbackFailure {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_inventory", "A nonempty inventory with exact stage, task_id and content_version is required.");
  const data = parsed.data;
  const ids = new Set<string>();
  for (const asset of data.assets) {
    const id = asset.asset_id ?? asset.id;
    if (!id || (asset.id && asset.asset_id && asset.id !== asset.asset_id)) return fail("invalid_asset_id", "Every asset needs a real, unambiguous stable ID.");
    if (ids.has(id)) return fail("duplicate_asset_id", "Asset IDs must be unique within the inventory.");
    ids.add(id);
  }
  const slots = new Set<string>();
  for (const asset of data.assets) {
    const id = (asset.asset_id ?? asset.id)!;
    const exactSlot = Object.hasOwn(ONEPAGE_DELIVERY_ROLES, id) ? id : undefined;
    if (exactSlot && asset.canonical_slot && exactSlot !== asset.canonical_slot) return fail("conflicting_canonical_slot", "The exact asset ID and explicit canonical slot identify different slots.");
    const slot = asset.canonical_slot ?? exactSlot;
    if (slot && slots.has(slot)) return fail("ambiguous_canonical_slot", "A canonical slot is mapped to multiple current assets.");
    if (slot) slots.add(slot);
  }
  const linked = new Map<string, z.infer<typeof mediaSchema>[]>();
  const seenMedia = new Set<string>();
  for (const image of data.result_images ?? []) {
    if (!image.asset_id) continue; // Never infer links from image order, label, or file ID.
    if (!ids.has(image.asset_id)) return fail("unknown_media_asset", "An explicit media link refers to an asset outside this inventory.");
    if (seenMedia.has(image.file_id)) return fail("ambiguous_media_link", "A media reference is repeated; confirm its exact asset linkage.");
    seenMedia.add(image.file_id);
    const refs = linked.get(image.asset_id) ?? [];
    refs.push({ file_id: image.file_id, label: image.label });
    linked.set(image.asset_id, refs);
  }
  const entries: FeedbackIndexEntry[] = [...data.assets]
    .sort((a, b) => order((a.asset_id ?? a.id)!, (b.asset_id ?? b.id)!))
    .map((asset, i) => {
      const asset_id = (asset.asset_id ?? asset.id)!;
      const media = (linked.get(asset_id) ?? []).sort((a, b) => order(a.file_id, b.file_id));
      return { ordinal: i + 1, asset_id, ...(asset.canonical_slot ? { canonical_slot: asset.canonical_slot } : {}), name: asset.label ?? asset.asset_name ?? asset.name ?? asset.element ?? null,
        group: asset.section ?? null, position: asset.position ?? null, media,
        preview_availability: media.length ? "reference_only" : "unavailable" };
    });
  const bound = { stage: data.stage, task_id: data.task_id, content_version: data.content_version,
    ...(data.branch ? { branch: data.branch } : {}), ...(data.retry_id ? { retry_id: data.retry_id } : {}), entries };
  return { ok: true, index: { index_id: digest(bound), ...bound } };
}

const requestSchema = z.object({
  index_id: identity,
  blocks: z.array(z.object({
    text: z.string().trim().min(1).max(4000),
    ordinals: z.array(z.number().int().positive()).min(1).max(100).optional(),
    asset_names: z.array(label).min(1).max(100).optional(),
    group_names: z.array(label).min(1).max(100).optional(),
    all: z.boolean().optional(),
    canonical_slots: z.array(canonicalSlot).min(1).max(100).optional(),
    exclude_canonical_slots: z.array(canonicalSlot).min(1).max(100).optional(),
    exclude_ordinals: z.array(z.number().int().positive()).min(1).max(100).optional(),
    exclude_asset_names: z.array(label).min(1).max(100).optional(),
  }).strict()).min(1).max(10),
}).strict();
export type ResolvedFeedbackBlock = { text: string; asset_ids: string[]; ordinals: number[] };

/** Resolve against the CURRENT authoritative inventory, never a caller-supplied historical index.
 * Returns intent only: no dispatch, training, mutation, or claim that media is visible. */
export function resolveFeedbackBlocks(index: unknown, request: unknown):
  { ok: true; index_id: string; blocks: ResolvedFeedbackBlock[] } | FeedbackFailure {
  const checked = indexSchema.safeParse(index);
  if (!checked.success) return fail("invalid_index", "The current inventory is malformed or unbound.");
  const current = checked.data;
  if (current.index_id !== digest(current) || current.entries.some((entry, i) =>
    entry.ordinal !== i + 1 || (i > 0 && order(current.entries[i - 1].asset_id, entry.asset_id) >= 0) ||
    entry.preview_availability !== (entry.media.length ? "reference_only" : "unavailable") ||
    entry.media.some((media, j) => j > 0 && order(entry.media[j - 1].file_id, media.file_id) >= 0))) {
    return fail("invalid_index", "The inventory has changed or its binding cannot be verified.");
  }
  const mappedSlots = new Set<string>();
  for (const entry of current.entries) {
    const exactSlot = Object.hasOwn(ONEPAGE_DELIVERY_ROLES, entry.asset_id) ? entry.asset_id : undefined;
    if (exactSlot && entry.canonical_slot && exactSlot !== entry.canonical_slot) return fail("invalid_index", "The inventory contains conflicting canonical slot mappings.");
    const slot = entry.canonical_slot ?? exactSlot;
    if (slot && mappedSlots.has(slot)) return fail("invalid_index", "The inventory contains ambiguous canonical slot mappings.");
    if (slot) mappedSlots.add(slot);
  }
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return fail("invalid_feedback", "Supply 1–10 feedback blocks with nonempty text and valid explicit selectors.", "Ask the user to provide each feedback instruction and its current item numbers, exact names, exact groups, or explicit all-items scope.");
  if (parsed.data.index_id !== current.index_id) return fail("stale_index", "The feedback refers to a different inventory or revision.");
  if (current.branch !== "onepage-system" && parsed.data.blocks.some(block => block.canonical_slots || block.exclude_canonical_slots)) {
    return fail("canonical_branch_required", "Canonical Onepage selectors require the current inventory's verified onepage-system branch.", "Confirm the actual current task branch and rebuild its inventory before resolving Onepage slots; do not infer the branch from the copied prompt.");
  }
  const used = new Set<string>();
  const blocks: ResolvedFeedbackBlock[] = [];
  for (const block of parsed.data.blocks) {
    const selected = new Set<string>();
    if (block.all && (block.ordinals || block.asset_names || block.group_names || block.canonical_slots)) return fail("conflicting_selectors", "All-items scope cannot be combined with narrower selectors.", "Ask whether this block applies to all current items or only the listed items.");
    if (block.all) current.entries.forEach(e => selected.add(e.asset_id));
    for (const ordinal of block.ordinals ?? []) {
      const entry = current.entries.find(e => e.ordinal === ordinal);
      if (!entry) return fail("unknown_ordinal", "An item number is outside the current inventory.");
      selected.add(entry.asset_id);
    }
    for (const name of block.asset_names ?? []) {
      const matches = current.entries.filter(e => e.name !== null && normalize(e.name) === normalize(name));
      if (matches.length !== 1) return fail(matches.length ? "ambiguous_name" : "unknown_name", "An item name does not identify exactly one current item.", "Show the matching current items and ask for their item numbers.");
      selected.add(matches[0].asset_id);
    }
    for (const group of block.group_names ?? []) {
      const matches = current.entries.filter(e => e.group !== null && normalize(e.group) === normalize(group));
      if (!matches.length) return fail("unknown_group", "A group is absent from the current inventory.");
      if (new Set(matches.map(e => e.group)).size !== 1) return fail("ambiguous_group", "Multiple group labels normalize to the same selector.", "Ask for the current item numbers rather than the ambiguous group label.");
      matches.forEach(e => selected.add(e.asset_id));
    }
    for (const slot of block.canonical_slots ?? []) {
      const matches = current.entries.filter(e => e.asset_id === slot || e.canonical_slot === slot);
      if (matches.length !== 1) return fail(matches.length ? "ambiguous_canonical_slot" : "missing_canonical_slot", "A canonical slot does not identify exactly one actual current asset.", "Confirm the current task inventory and its explicit canonical slot mapping before applying this block.");
      selected.add(matches[0].asset_id);
    }
    if (!selected.size) return fail("missing_selector", "Every block needs an explicit item, group, or all-items selector.", "Ask which current item numbers this feedback applies to.");
    const excluded = new Set<string>();
    for (const ordinal of block.exclude_ordinals ?? []) {
      const entry = current.entries.find(e => e.ordinal === ordinal);
      if (!entry) return fail("unknown_excluded_ordinal", "An excluded item number is outside the current inventory.");
      excluded.add(entry.asset_id);
    }
    for (const name of block.exclude_asset_names ?? []) {
      const matches = current.entries.filter(e => e.name !== null && normalize(e.name) === normalize(name));
      if (matches.length !== 1) return fail(matches.length ? "ambiguous_excluded_name" : "unknown_excluded_name", "An excluded item name does not identify exactly one current item.", "Show the matching current items and ask for the item numbers to exclude.");
      excluded.add(matches[0].asset_id);
    }
    for (const slot of block.exclude_canonical_slots ?? []) {
      const matches = current.entries.filter(e => e.asset_id === slot || e.canonical_slot === slot);
      if (matches.length !== 1) return fail(matches.length ? "ambiguous_canonical_slot" : "missing_canonical_slot", "An excluded canonical slot does not identify exactly one actual current asset.", "Confirm the current task inventory and its explicit canonical slot mapping before applying exclusions.");
      excluded.add(matches[0].asset_id);
    }
    if ([...excluded].some(id => !selected.has(id))) return fail("exclusion_outside_selection", "An excluded item is not part of this block's positive selection.", "Ask which current group or items to change, and which of those items to exclude.");
    excluded.forEach(id => selected.delete(id));
    if (!selected.size) return fail("empty_selection", "The exclusions remove every selected item.", "Ask which current items should still receive this feedback.");
    if ([...selected].some(id => used.has(id))) return fail("overlapping_blocks", "An item is targeted by more than one feedback block.", "Ask the user to combine or clarify the overlapping instructions for each shared item before continuing.");
    selected.forEach(id => used.add(id));
    const entries = current.entries.filter(e => selected.has(e.asset_id));
    blocks.push({ text: block.text, asset_ids: entries.map(e => e.asset_id), ordinals: entries.map(e => e.ordinal) });
  }
  return { ok: true, index_id: current.index_id, blocks };
}
