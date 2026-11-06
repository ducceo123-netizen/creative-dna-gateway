import type { Brief, ContentFeedbackDraft, FeedbackDraft } from './types';
/** Unsent input only. Never persist authentication, approvals, receipts, task outcomes or upload bytes. */
export type UnsentDrafts = { brief: Brief; visual: Record<string, FeedbackDraft>; content: Record<string, ContentFeedbackDraft> };
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const maxBytes = 250_000;
const lifetime = 7 * 24 * 60 * 60 * 1000;
const key = (owner: string) => 'uid.workspace.unsent.v1:' + encodeURIComponent(owner);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const refs = (value: unknown): string[] => Array.isArray(value) && value.length <= 32 && value.every(id => text(id, 200)) ? [...new Set(value)] : [];
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
function cleanDrafts(value: unknown): UnsentDrafts | null {
  if (!object(value) || !object(value.brief) || !object(value.visual) || !object(value.content)) return null;
  const b = value.brief;
  if (!text(b.brand, 100) || b.material !== 'onepage' || !text(b.source_url, 2000) || !text(b.requirements ?? '', 8000) || !text(b.title ?? '', 160)) return null;
  const brief: Brief = { brand: b.brand, material: 'onepage', source_url: b.source_url, requirements: b.requirements ?? '', title: b.title ?? '' };
  const visual: Record<string, FeedbackDraft> = Object.create(null);
  const content: Record<string, ContentFeedbackDraft> = Object.create(null);
  for (const [id, d] of Object.entries(value.visual).slice(-100)) {
    if (!text(id, 200) || !object(d) || d.task_id !== id || !text(d.content_revision, 200) || !text(d.render_hash, 128) || !text(d.index_id, 200) || !text(d.active_group_id, 100) || !Array.isArray(d.groups) || d.groups.length > 10) continue;
    if (!d.groups.every(g => object(g) && text(g.id, 100) && text(g.instruction, 4000) && Array.isArray(g.element_ids) && g.element_ids.length <= 500 && g.element_ids.every((x: unknown) => text(x, 300)) && Number.isFinite(g.viewport_width))) continue;
    visual[id] = { task_id: id, content_revision: d.content_revision, render_hash: d.render_hash, index_id: d.index_id, active_group_id: d.active_group_id, groups: d.groups.map(g => ({ id: g.id, instruction: g.instruction, element_ids: [...g.element_ids], viewport_width: g.viewport_width, ...(refs(g.reference_ids).length ? { reference_ids: refs(g.reference_ids) } : {}) })) };
  }
  for (const [id, d] of Object.entries(value.content).slice(-100)) {
    if (!text(id, 200) || !object(d) || !text(d.content_revision, 200) || !text(d.active_group_id, 100) || !Array.isArray(d.groups) || d.groups.length > 10) continue;
    if (!d.groups.every(g => object(g) && text(g.id, 100) && text(g.instruction, 4000) && Array.isArray(g.slots) && g.slots.length <= 500 && g.slots.every((x: unknown) => text(x, 300)))) continue;
    content[id] = { ...(refs(d.reference_ids).length ? { reference_ids: refs(d.reference_ids) } : {}), content_revision: d.content_revision, active_group_id: d.active_group_id, groups: d.groups.map(g => ({ id: g.id, instruction: g.instruction, slots: [...g.slots] })) };
  }
  return { brief, visual, content };
}
export function readUnsentDrafts(storage: DraftStorage, verifiedOwner: string, now = Date.now()): UnsentDrafts | null {
  if (!verifiedOwner) return null;
  try {
    const raw = storage.getItem(key(verifiedOwner));
    if (!raw || raw.length > maxBytes) return null;
    const value = JSON.parse(raw);
    if (value.owner !== verifiedOwner || value.version !== 1 || !Number.isFinite(value.saved_at) || value.saved_at > now || now - value.saved_at > lifetime) { storage.removeItem(key(verifiedOwner)); return null; }
    return cleanDrafts(value.drafts);
  } catch { return null; }
}
export function saveUnsentDrafts(storage: DraftStorage, verifiedOwner: string, drafts: UnsentDrafts, now = Date.now()): boolean {
  if (!verifiedOwner) return false;
  try {
    const clean = cleanDrafts(drafts);
    if (!clean) return false;
    const raw = JSON.stringify({ version: 1, owner: verifiedOwner, saved_at: now, drafts: clean });
    if (raw.length > maxBytes) return false;
    storage.setItem(key(verifiedOwner), raw); return true;
  } catch { return false; }
}
export function browserDraftStorage(): DraftStorage | null {
  try { return window.localStorage; } catch { return null; }
}
