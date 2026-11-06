import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceReviewManifest, resolveWorkspaceElementFeedback } from '../uid-workspace-review.ts';

const h = 'a'.repeat(64), h2 = 'b'.repeat(64);
const fixture = () => buildWorkspaceReviewManifest({
  task_id: 't1', content_revision: 'c1', template_version: 'gtk-v1', canonical_hash: h, render_hash: h,
  elements: [
    { id: 'text:title_01', kind: 'text', slot: 'title_01', text_hash: h },
    { id: 'image:detail_main', kind: 'image', slot: 'detail_main', canonical_slot: 'detail_main', artifact_revision: 'a1', sha256: h },
    { id: 'image:responsive_alias', kind: 'image', slot: 'occasion_story_01_mobile', canonical_slot: 'detail_main', artifact_revision: 'a1', sha256: h },
    { id: 'section:details', kind: 'section', children: ['text:title_01', 'image:detail_main', 'image:responsive_alias'] },
  ],
});
const request = (m = fixture(), element_ids = ['section:details']) => ({ task_id: m.task_id, content_revision: m.content_revision, render_hash: m.render_hash, index_id: m.index_id, groups: [{ instruction: 'Chỉnh đúng nhóm này', element_ids, viewport_width: 390 }] });

test('section selection expands exact descendants and collapses responsive aliases', () => {
  const m = fixture(); const result = resolveWorkspaceElementFeedback(m, request(m));
  assert.equal(result.status, 'RESOLVED_INTENT_NOT_EXECUTED');
  assert.equal(result.groups[0].text_slots.length, 1);
  assert.equal(result.groups[0].assets.length, 1);
  assert.equal(result.groups[0].assets[0].artifact_revision, 'a1');
});
test('text-only feedback needs no image generation target', () => {
  const m = fixture(); const result = resolveWorkspaceElementFeedback(m, request(m, ['text:title_01']));
  assert.deepEqual(result.groups[0].assets, []);
  assert.deepEqual(result.groups[0].text_slots, [{ slot: 'title_01', text_hash: h }]);
});
test('stale task, content, render or index cannot retarget the current result', () => {
  const m = fixture();
  for (const stale of [{ task_id: 'other' }, { content_revision: 'c0' }, { render_hash: h2 }, { index_id: h2 }]) assert.throws(() => resolveWorkspaceElementFeedback(m, { ...request(m), ...stale }), /STALE_PREVIEW/);
});
test('duplicate or invented elements and recursive sections fail closed', () => {
  const { index_id, ...m } = fixture();
  assert.throws(() => buildWorkspaceReviewManifest({ ...m, elements: [...m.elements, m.elements[0]] }), /DUPLICATE_ELEMENT/);
  assert.throws(() => buildWorkspaceReviewManifest({ ...m, elements: [...m.elements, { id: 's2', kind: 'section', children: ['section:details'] }] }), /INVALID_SECTION_CHILDREN/);
  assert.throws(() => resolveWorkspaceElementFeedback(fixture(), request(fixture(), ['invented'])), /UNKNOWN_ELEMENT/);
});
test('changed alias bytes are not accepted as one logical asset', () => {
  const { index_id, ...m } = fixture();
  assert.throws(() => buildWorkspaceReviewManifest({ ...m, elements: m.elements.map(e => e.id === 'image:responsive_alias' ? { ...e, sha256: h2 } : e) }), /RESPONSIVE_ALIAS_CONFLICT/);
});
test('conflicting groups cannot target aliases or section descendants twice', () => {
  const m = fixture(); const r = request(m, ['image:detail_main']);
  r.groups.push({ ...r.groups[0], instruction: 'Khác', element_ids: ['image:responsive_alias'] });
  assert.throws(() => resolveWorkspaceElementFeedback(m, r), /OVERLAPPING_FEEDBACK_GROUPS/);
});
test('tampered current index and extra mutation flags are rejected', () => {
  const m = fixture();
  assert.throws(() => resolveWorkspaceElementFeedback({ ...m, render_hash: h2 }, request(m)), /INVALID_CURRENT_MANIFEST/);
  assert.throws(() => resolveWorkspaceElementFeedback(m, { ...request(m), train: true }));
});
test('separate group instructions and viewport context stay separate', () => {
  const m = fixture(); const r = request(m, ['image:detail_main']);
  r.groups.push({ instruction: 'Chỉ sửa chữ', element_ids: ['text:title_01'], viewport_width: 1280 });
  const result = resolveWorkspaceElementFeedback(m, r);
  assert.deepEqual(result.groups.map(g => g.instruction), ['Chỉnh đúng nhóm này', 'Chỉ sửa chữ']);
  assert.deepEqual(result.groups.map(g => g.viewport_width), [390, 1280]);
});


test('exact identifiers cannot be normalized into another task or selection', () => {
  const m = fixture();
  const { index_id, ...body } = m;
  assert.throws(() => buildWorkspaceReviewManifest({ ...body, task_id: ' t1 ' }));
  assert.throws(() => resolveWorkspaceElementFeedback(m, { ...request(m), task_id: ' t1 ' }));
  assert.throws(() => resolveWorkspaceElementFeedback(m, request(m, [' image:detail_main '])));
});

test('whitespace-tampered stored targets cannot pass an unchanged manifest hash', () => {
  const m = fixture();
  const tampered = { ...m, elements: m.elements.map(e => e.kind === 'image' ? { ...e, canonical_slot: ` ${e.canonical_slot} ` } : e) };
  assert.throws(() => resolveWorkspaceElementFeedback(tampered, request(m)));
});

test('section plus child duplication collapses without broadening the group or mutating input', () => {
  const m = fixture(); const r = request(m, ['section:details', 'image:detail_main', 'image:detail_main']);
  const before = structuredClone({ m, r });
  const result = resolveWorkspaceElementFeedback(m, r);
  assert.deepEqual(result.groups[0].element_ids, ['text:title_01', 'image:detail_main', 'image:responsive_alias']);
  assert.equal(result.groups[0].assets.length, 1);
  assert.deepEqual({ m, r }, before);
});
