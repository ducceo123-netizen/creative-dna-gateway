import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildWorkspaceReviewManifest } from '../uid-workspace-review';
import { createWorkspaceApi, WorkspaceApiError } from '../src/workspace/api';
import { emptyFeedback, feedbackError, feedbackRequest, isStaleDraft, logicalTargets, mergeEventPage, rebaseDraft, safeDownloadPath, selectionFromMessage, sourceUrlError, stageIndex } from '../src/workspace/state';
import { buildContentFeedback, contentFeedbackError, createContentDraft } from '../src/workspace/ContentReview';
import type { Review, WorkspaceTask } from '../src/workspace/types';
import { readFileSync } from 'node:fs';

const hash = 'a'.repeat(64);
const manifest = buildWorkspaceReviewManifest({ task_id: 'task-ui', content_revision: 'content-1', template_version: 'template-1', canonical_hash: hash, render_hash: hash,
  elements: [
    { id: 'title', kind: 'text', slot: 'hero_title', text_hash: hash },
    { id: 'image', kind: 'image', slot: 'occasion_story_01', canonical_slot: 'occasion_01', artifact_revision: 'asset-1', sha256: hash },
    { id: 'image-alias', kind: 'image', slot: 'occasion_story_01_mobile', canonical_slot: 'occasion_01', artifact_revision: 'asset-1', sha256: hash },
    { id: 'section', kind: 'section', children: ['title', 'image'] },
  ] });
const review: Review = { html: '<html></html>', manifest, channel_nonce: 'nonce-ui' };
const message = { type: 'uid-workspace-selection', channel_nonce: 'nonce-ui', render_hash: hash, index_id: manifest.index_id, element_id: 'image', viewport_width: 1280 };

test('UI selection rejects another frame, render, nonce, index, target and nonobject payloads', () => {
  assert.equal(selectionFromMessage(message, true, review), 'image');
  assert.equal(selectionFromMessage(message, false, review), null);
  for (const change of [{ channel_nonce: 'bad' }, { render_hash: 'bad' }, { index_id: 'bad' }, { element_id: 'missing' }, { type: 'execute' }]) assert.equal(selectionFromMessage({ ...message, ...change }, true, review), null);
  for (const invalid of [null, [], 'image', false, 1]) assert.equal(selectionFromMessage(invalid, true, review), null);
});
test('UI logical selection expands actual descendants and deduplicates responsive image aliases', () => {
  assert.deepEqual([...logicalTargets(manifest, ['section', 'title', 'image-alias'])], ['text:hero_title', 'asset:occasion_01']);
});
test('UI grouped feedback retains instructions and detects conflicting aliases across groups', () => {
  const draft = emptyFeedback(manifest, 'group-1');
  draft.groups[0] = { id: 'group-1', instruction: '  Giữ sản phẩm, đổi ánh sáng  ', element_ids: ['image'], viewport_width: 390 };
  assert.equal(feedbackError(draft, manifest), null);
  assert.equal(feedbackRequest(draft).groups[0].instruction, 'Giữ sản phẩm, đổi ánh sáng');
  assert.equal(feedbackRequest(draft).groups[0].viewport_width, 390);
  assert.ok(!('id' in feedbackRequest(draft).groups[0]));
  draft.groups.push({ id: 'group-2', instruction: 'Đổi màu', element_ids: ['image-alias'], viewport_width: 1280 });
  assert.match(feedbackError(draft, manifest)!, /trùng đối tượng/);
});
test('UI stale render requires explicit reselect, preserving Vietnamese feedback text', () => {
  const draft = emptyFeedback(manifest, 'g');
  draft.groups[0].instruction = 'Đổi màu nền thành be, giữ nét chữ rõ.'; draft.groups[0].element_ids = ['title'];
  const next = { ...manifest, content_revision: 'content-2', index_id: 'b'.repeat(64) };
  assert.equal(isStaleDraft(draft, next), true);
  assert.match(feedbackError(draft, next)!, /phiên bản mới/);
  const rebased = rebaseDraft(draft, next);
  assert.equal(rebased.groups[0].instruction, draft.groups[0].instruction);
  assert.deepEqual(rebased.groups[0].element_ids, []);
  assert.equal(rebased.groups[0].id, 'g');
  assert.equal(isStaleDraft(rebased, next), false);
});
test('UI feedback enforces 1–10 nonempty groups with existing targets', () => {
  const draft = emptyFeedback(manifest, 'g');
  assert.match(feedbackError(draft, manifest)!, /Nhập yêu cầu/);
  draft.groups[0].instruction = 'Sửa chữ'; assert.match(feedbackError(draft, manifest)!, /Chọn ít nhất/);
  draft.groups[0].element_ids = ['absent']; assert.match(feedbackError(draft, manifest)!, /không còn/);
  draft.groups = Array.from({ length: 11 }, (_, i) => ({ id: `g${i}`, instruction: 'Sửa', element_ids: ['title'], viewport_width: 390 }));
  assert.match(feedbackError(draft, manifest)!, /1 đến 10/);
});
test('UI download accepts only the authenticated same-task artifact route', () => {
  const path = '/api/workspace/tasks/task-ui/artifacts/file-1';
  assert.equal(safeDownloadPath(path, 'task-ui'), path);
  for (const wrong of ['https://evil.test/file.zip', '//evil.test', '/api/workspace/tasks/other/artifacts/file-1', path + '?secret=x', path + '#x', path + '/../../actions', path + '%2f..', path + '\\bad']) assert.equal(safeDownloadPath(wrong, 'task-ui'), null);
});
test('UI stage timeline is descriptive, not artificial completion or user stage controls', () => {
  assert.equal(stageIndex('content_review'), 2); assert.equal(stageIndex('review'), 3);
  assert.equal(stageIndex('unknown'), -1); assert.equal(stageIndex('blocked'), -1);
});
test('UI source input rejects plaintext and credential-bearing URLs', () => {
  assert.equal(sourceUrlError('https://shop.example/products/item'), null);
  for (const url of ['http://shop.example', 'https://user:password@shop.example', 'not a url']) assert.ok(sourceUrlError(url));
});
test('UI pre-asset content feedback hashes exact UTF-8 slots and retains separate instructions', async () => {
  const content = { revision: 'content-1', slots: { hero_title: 'Món quà của bạn', support: 'Dành riêng cho gia đình' } };
  const draft = createContentDraft(content.revision);
  draft.groups[0].instruction = '  Giữ ý, rút gọn  '; draft.groups[0].slots = ['hero_title'];
  const result = await buildContentFeedback(draft, content);
  assert.equal(result.groups[0].instruction, 'Giữ ý, rút gọn');
  assert.equal(result.groups[0].text_slots[0].text_hash, createHash('sha256').update(content.slots.hero_title).digest('hex'));
  draft.groups.push({ id: 'second', instruction: 'Đổi tone', slots: ['hero_title'] });
  assert.match(contentFeedbackError(draft, content)!, /trùng/);
  assert.match(contentFeedbackError(draft, { ...content, revision: 'new' })!, /đổi phiên bản/);
});
test('UI fetch uses same-origin session and does not retry uncertain paid mutations', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.equal(init?.credentials, 'same-origin'); throw new TypeError('connection reset'); };
  try {
    await assert.rejects(createWorkspaceApi().create({ brand: 'PawfectHouse', material: 'onepage', source_url: 'https://shop.example/item' }, 'key-12345'), (error: unknown) => error instanceof WorkspaceApiError && error.code === 'outcome_unknown');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
test('UI parser respects server nested errors without pretending accepted equals completed', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'STALE_PREVIEW', message: 'Review changed' } }), { status: 409 });
  try { await assert.rejects(createWorkspaceApi().task('task-ui'), (error: unknown) => error instanceof WorkspaceApiError && error.code === 'STALE_PREVIEW' && error.status === 409); }
  finally { globalThis.fetch = original; }
});
test('UI visual acceptance binds exact manifest and content/state without browser receipts', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, { type: 'approve_artwork', idempotency_key: 'key-12345', expected_state_version: 7, content_revision: 'content-1', review_index_id: manifest.index_id, render_hash: hash });
    return new Response(JSON.stringify({ task: {}, action: { status: 'queued' } }), { status: 202 });
  };
  try { await createWorkspaceApi().action({ task_id: 'task-ui', state_version: 7, snapshot: { content_revision: 'content-1' }, review_manifest: manifest } as WorkspaceTask, 'approve_artwork', 'key-12345'); }
  finally { globalThis.fetch = original; }
});
test('workspace route is additive; iframe remains opaque; forms use official Polaris 2', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('../src/workspace/Preview.tsx', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/workspace/WorkspaceApp.tsx', import.meta.url), 'utf8');
  const polaris = readFileSync(new URL('../src/workspace/polaris.tsx', import.meta.url), 'utf8');
  assert.match(main, /pathname === '\/workspace'/); assert.match(main, /: <App \/>/);
  assert.match(preview, /sandbox="allow-scripts"/); assert.doesNotMatch(preview, /allow-same-origin/);
  assert.match(polaris, /https:\/\/cdn\.shopify\.com\/shopifycloud\/polaris-2\.js/); assert.doesNotMatch(polaris, /app-bridge/);
  assert.match(ui, /<s-page /); assert.match(ui, /<s-text-area /); assert.doesNotMatch(ui, /localStorage|sessionStorage|clipboard\.writeText/);
});

test('UI event cursor advances beyond 200, deduplicates replay and retains newest activity', () => {
  const event = (sequence: number) => ({ sequence, type: 'progress', created_at: '2026-11-06T00:00:00Z', data: {} });
  const first = mergeEventPage({ cursor: 0, events: [] }, { cursor: 200, events: Array.from({ length: 200 }, (_, i) => event(i + 1)) });
  const second = mergeEventPage(first, { cursor: 400, events: Array.from({ length: 201 }, (_, i) => event(i + 200)) });
  assert.equal(second.cursor, 400); assert.equal(second.events.length, 200); assert.equal(second.events[0].sequence, 201);
  assert.equal(second.events.at(-1)?.sequence, 400);
  const replay = mergeEventPage(second, { cursor: 300, events: [event(299), event(300)] });
  assert.equal(replay.cursor, 400); assert.deepEqual(replay.events, second.events);
});
test('UI real login sends credentials only to the same-origin login endpoint and has no token persistence', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/workspace/session/login'); assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { email: 'member@example.test', password: 'synthetic-test-only' });
    return new Response(JSON.stringify({ authenticated: true }));
  };
  try { assert.equal((await createWorkspaceApi().login('member@example.test', 'synthetic-test-only')).authenticated, true); }
  finally { globalThis.fetch = original; }
  const login = readFileSync(new URL('../src/workspace/LoginDialog.tsx', import.meta.url), 'utf8');
  assert.match(login, /setPassword\(''\)/); assert.doesNotMatch(login, /localStorage|sessionStorage|console\.log/);
});

import { readUnsentDrafts, saveUnsentDrafts } from '../src/workspace/drafts';
import { mergeTaskPage } from '../src/workspace/state';
import { historyMatches } from '../src/workspace/HistoryPanel';
import { galleryArtifacts } from '../src/workspace/ArtifactGallery';
import { uploadFileError, uploadFilename, safeReferencePath, uploadStagedReferences, type UploadItem } from '../src/workspace/Uploads';
import type { WorkspaceApi } from '../src/workspace/api';
function localStore() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
const briefDraft = { brand: 'PawfectHouse', material: 'onepage' as const, source_url: 'https://shop.example/item', requirements: 'Giữ nguyên sản phẩm, đổi màu nền.' };
test('UI durable input drafts restore only for verified owner and never restore authority', () => {
  const storage = localStore(); const d = emptyFeedback(manifest, 'g');
  d.groups[0].instruction = 'Chữ tiếng Việt được giữ nguyên';
  d.groups[0].reference_ids = ['reference-1'];
  const data = { brief: briefDraft, visual: { 'task-ui': d }, content: {}, authenticated: true, token: 'not-stored', approvals: ['not-stored'] };
  assert.equal(saveUnsentDrafts(storage, 'owner-a', data, 1000), true);
  assert.equal(readUnsentDrafts(storage, '', 1001), null);
  assert.equal(readUnsentDrafts(storage, 'owner-b', 1001), null);
  const restored = readUnsentDrafts(storage, 'owner-a', 1001)!;
  assert.equal(restored.visual['task-ui'].groups[0].instruction, d.groups[0].instruction);
  assert.deepEqual(restored.visual['task-ui'].groups[0].reference_ids, ['reference-1']);
  assert.doesNotMatch([...storage.entries.values()][0], /not-stored|authenticated|approvals/);
  assert.equal(readUnsentDrafts(storage, 'owner-a', 1000 + 8 * 24 * 60 * 60 * 1000), null);
  assert.equal(storage.entries.size, 0);
});
test('UI durable input storage fails safely on malformed, over-size and blocked browser storage', () => {
  const storage = localStore();
  assert.equal(saveUnsentDrafts(storage, '', { brief: briefDraft, visual: {}, content: {} }), false);
  assert.equal(saveUnsentDrafts(storage, 'owner-a', { brief: { ...briefDraft, requirements: 'x'.repeat(8001) }, visual: {}, content: {} }), false);
  storage.setItem('uid.workspace.unsent.v1:owner-a', '{'); assert.equal(readUnsentDrafts(storage, 'owner-a'), null);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  assert.equal(readUnsentDrafts(blocked, 'owner-a'), null);
  assert.equal(saveUnsentDrafts(blocked, 'owner-a', { brief: briefDraft, visual: {}, content: {} }), false);
});
test('UI cursor pages show more than 100 tasks without duplicate IDs or revision downgrades', async () => {
  const row = (i: number, version = 1) => ({ task_id: `task-${i}`, state_version: version, updated_at: '2026-11-06T00:00:00Z' } as WorkspaceTask);
  const all = mergeTaskPage(Array.from({ length: 100 }, (_, i) => row(i)), Array.from({ length: 100 }, (_, i) => row(i + 75)));
  assert.equal(all.length, 175);
  const next = mergeTaskPage(mergeTaskPage(all, [row(3, 5)]), [row(3, 2)]);
  assert.equal(next.find(task => task.task_id === 'task-3')?.state_version, 5);
  const original = globalThis.fetch;
  globalThis.fetch = async url => { assert.equal(url, '/api/workspace/tasks?cursor=cursor%2F%2B%3D'); return new Response(JSON.stringify({ tasks: [], next_cursor: null, has_more: false })); };
  try { await createWorkspaceApi().tasks(undefined, 'cursor/+='); } finally { globalThis.fetch = original; }
});
test('UI history exact content and render bindings reject wrong task/version', () => {
  assert.equal(historyMatches(review, 'task-ui', { content_revision: 'content-1', render_hash: hash }), true);
  assert.equal(historyMatches(review, 'other', { content_revision: 'content-1', render_hash: hash }), false);
  assert.equal(historyMatches(review, 'task-ui', { content_revision: 'content-2', render_hash: hash }), false);
  assert.equal(historyMatches(review, 'task-ui', { content_revision: 'content-1', render_hash: 'b'.repeat(64) }), false);
  const source = readFileSync(new URL('../src/workspace/WorkspaceApp.tsx', import.meta.url), 'utf8');
  assert.match(source, /const actionType = historicalReview \? null/);
  assert.match(source, /epoch !== sessionEpoch.current/);
  assert.match(source, /session.user\?\.id !== owner/);
});
test('UI image gallery excludes unverified and cross-task files', () => {
  const file = { artifact_id: 'image', verification: 'verified', media_type: 'image/png', download_url: '/api/workspace/tasks/task-ui/artifacts/image' };
  const task = { task_id: 'task-ui', artifacts: [file, { ...file, artifact_id: 'pending', verification: 'pending' }, { ...file, artifact_id: 'wrong-task', download_url: '/api/workspace/tasks/task-other/artifacts/image' }, { ...file, artifact_id: 'html', media_type: 'text/html' }] } as WorkspaceTask;
  assert.deepEqual(galleryArtifacts(task).map(file => file.artifact_id), ['image']);
});
test('UI upload checks raster limits, safe filenames and private reference paths', () => {
  assert.equal(uploadFileError({ size: 1024, type: 'image/png' }), null);
  assert.ok(uploadFileError({ size: 1, type: 'image/svg+xml' }));
  assert.ok(uploadFileError({ size: 8 * 1024 * 1024 + 1, type: 'image/png' }));
  assert.ok(uploadFileError({ size: 0, type: 'image/webp' }));
  assert.equal(uploadFilename('Ảnh mẫu đậm.png'), 'Anh-mau-dam.png');
  assert.equal(uploadFilename('CON.png'), 'reference-CON.png');
  assert.equal(uploadFilename('photo...'), 'photo');
  assert.equal(safeReferencePath('task-ui', 'ref-1'), '/api/workspace/tasks/task-ui/references/ref-1');
  assert.equal(safeReferencePath('task-ui', '../other'), null);
});
const fakeFile = () => new File([new Uint8Array([1, 2, 3])], 'Ảnh.png', { type: 'image/png' });
const uploadTask = { task_id: 'task-ui', state_version: 2, snapshot: { content_revision: 'content-1' }, review_manifest: manifest } as WorkspaceTask;
test('UI real upload sends digest and raw bytes, refreshes CAS between files, never claims inspection', async () => {
  const states: string[] = []; const versions: number[] = []; let current = 2;
  const api = { prepareUpload: async (_id: string, intent: any) => { versions.push(intent.expected_state_version); assert.equal(intent.filename, 'Anh.png'); assert.equal(intent.sha256, createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex')); return { upload: { upload_id: 'u', status: 'reserved' } }; }, putUpload: async (_id: string, _u: string, file: File) => { assert.equal(await file.text(), '\x01\x02\x03'); current++; return { upload: { upload_id: 'u', status: 'linked', reference_id: 'r' } }; }, task: async () => ({ task: { ...uploadTask, state_version: current } }) } as unknown as WorkspaceApi;
  const items: UploadItem[] = [1, 2].map(i => ({ id: `upload-${i}`, file: fakeFile(), role: 'product', status: 'staged' }));
  const result = await uploadStagedReferences(api, uploadTask, items, (_id, patch) => { if (patch.status) states.push(patch.status); });
  assert.deepEqual(versions, [2, 3]); assert.equal(result.state_version, 4); assert.deepEqual(states, ['uploading', 'linked', 'uploading', 'linked']);
});
test('UI upload timeout marks unknown, does not retry PUT or begin next file', async () => {
  let calls = 0; const patches: Partial<UploadItem>[] = [];
  const api = { prepareUpload: async () => ({ upload: { upload_id: 'u', status: 'reserved' } }), putUpload: async () => { calls++; throw new WorkspaceApiError(0, 'outcome_unknown', 'lost response'); } } as unknown as WorkspaceApi;
  const item: UploadItem = { id: 'upload-a', file: fakeFile(), role: 'product', status: 'staged' };
  await assert.rejects(uploadStagedReferences(api, uploadTask, [item, { ...item, id: 'upload-b' }], (_id, patch) => patches.push(patch)), /lost response/);
  assert.equal(calls, 1); assert.equal(patches.at(-1)?.status, 'unknown');
  assert.ok(patches.some(patch => patch.upload_id === 'u'));
});
test('UI upload fetch uses octet-stream without JSON encoding and no retry', async () => {
  const original = globalThis.fetch; const file = fakeFile();
  globalThis.fetch = async (url, options) => { assert.equal(url, '/api/workspace/tasks/task-ui/uploads/upload-a'); assert.equal(options?.method, 'PUT'); assert.equal(new Headers(options?.headers).get('Content-Type'), 'application/octet-stream'); assert.equal(options?.body, file); return new Response(JSON.stringify({ upload: { upload_id: 'upload-a', status: 'linked' } })); };
  try { await createWorkspaceApi().putUpload('task-ui', 'upload-a', file); } finally { globalThis.fetch = original; }
});
test('UI explicit rebase clears old selected objects and private reference IDs', () => {
  const draft = emptyFeedback(manifest, 'group'); draft.groups[0].instruction = 'Chỉ đổi phần đã chọn'; draft.groups[0].reference_ids = ['old-ref']; draft.groups[0].element_ids = ['image'];
  const next = rebaseDraft(draft, { ...manifest, content_revision: 'new-content' });
  assert.deepEqual(next.groups[0].reference_ids, []); assert.deepEqual(next.groups[0].element_ids, []); assert.equal(next.groups[0].instruction, draft.groups[0].instruction);
});
test('UI upload reservation reconciliation is a read-only lookup of the original intent', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, '/api/workspace/tasks/task-ui/uploads?idempotency_key=original%3Akey'); assert.equal(options?.method, undefined); return new Response(JSON.stringify({ upload: { upload_id: 'u', status: 'reserved' } })); };
  try { const result = await createWorkspaceApi().resolveUpload('task-ui', 'original:key'); assert.equal(result.upload.status, 'reserved'); assert.equal(calls, 1); } finally { globalThis.fetch = original; }
});
test('UI feedback references are explicit and preserved in exact group boundaries', async () => {
  const d = emptyFeedback(manifest, 'first'); d.groups[0].instruction = 'Đổi ánh sáng theo mẫu'; d.groups[0].element_ids = ['image']; d.groups[0].reference_ids = ['ref-selected'];
  assert.deepEqual(feedbackRequest(d).groups[0].reference_ids, ['ref-selected']);
  const content = { revision: 'content-1', slots: { hero: 'Bản chữ chính' } };
  const cd = createContentDraft(content.revision); cd.groups[0].instruction = 'Đổi câu'; cd.groups[0].slots = ['hero'];
  assert.equal((await buildContentFeedback(cd, content)).reference_ids, undefined);
  cd.reference_ids = ['explicit-ref']; assert.deepEqual((await buildContentFeedback(cd, content)).reference_ids, ['explicit-ref']);
});

test('UI reconciliation uses a protected POST, while status/lookup GET remains read-only', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/workspace/tasks/task-ui/uploads/upload-a/reconcile');assert.equal(options?.method,'POST');return new Response(JSON.stringify({upload:{upload_id:'upload-a',status:'linked'}}));};
  try{await createWorkspaceApi().uploadStatus('task-ui','upload-a');}finally{globalThis.fetch=original;}
});

test('UI distinguishes unsupported canonical variants from uncertain paid outcomes without promising retries', async () => {
  const { interruptionMessage } = await import('../src/workspace/state.ts');
  assert.match(interruptionMessage('RESEARCH_MULTI_VARIANT_CANONICAL_UNSUPPORTED'), /biến thể/);
  assert.match(interruptionMessage('RESEARCH_MULTI_VARIANT_CANONICAL_UNSUPPORTED', true), /không tạo lại/);
  assert.ok(!interruptionMessage('<script>untrusted instruction</script>').includes('<script>'));
});
