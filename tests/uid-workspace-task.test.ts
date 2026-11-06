import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceTask, applyWorkspaceAction, workspaceFeedbackIndex, type Task, type TaskAction, type Receipt, type ReceiptKind, type TaskSnapshot } from '../uid-workspace-task.ts';

const snapshot: TaskSnapshot = { snapshot_id: 's1', canonical_version: 'canonical-1', content_revision: 'v1', content_digest: 'digest-1', assets: [
  { asset_id: 'hero', canonical_slot: 'banner', revision_id: 'a1', content_revision: 'v1', label: 'Hero' },
] };
// Use a real slot from the existing inventory contract.
import { ONEPAGE_DELIVERY_ROLES } from '../supabase/functions/_shared/onepage-packaging.ts';
const slot = Object.keys(ONEPAGE_DELIVERY_ROLES)[0];
const initial = () => createWorkspaceTask('task-1', { ...snapshot, assets: snapshot.assets.map(a => ({ ...a, canonical_slot: slot })) });
function action(task: Task, body: object, id = `action-${task.state_version}`): TaskAction {
  return { action_id: id, task_id: task.task_id, content_revision: task.snapshot.content_revision, expected_state_version: task.state_version, ...body } as TaskAction;
}
function receipt(task: Task, kind: ReceiptKind, extra: Partial<Receipt> = {}): Receipt {
  return { receipt_id: `receipt-${task.state_version}`, task_id: task.task_id, state_version: task.state_version, content_revision: task.snapshot.content_revision, snapshot_id: task.snapshot.snapshot_id, kind, evidence_ref: 'retained-evidence', ...extra };
}
function accept(task: Task, a: TaskAction, receipts: Receipt[] = []): Task {
  const result = applyWorkspaceAction(task, a, receipts, a.type === 'feedback' || a.type === 'content_feedback' || a.type === 'cancel' ? 'user' : 'worker');
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unexpected rejection');
  return result.task;
}
function advance(task: Task, kind: ReceiptKind): Task {
  const extra = kind === 'content_ready' ? { snapshot: { ...task.snapshot, snapshot_id: 'content-s1', content_revision: 'authored-v1', content_digest: 'authored-digest', assets: [] } } : kind === 'assets_complete' ? { snapshot: { ...task.snapshot, snapshot_id: 'assets-s1', assets: initial().snapshot.assets.map(a => ({ ...a, content_revision: task.snapshot.content_revision })) } } : {};
  const r = receipt(task, kind, extra);
  return accept(task, action(task, { type: 'advance', receipt_id: r.receipt_id }), [r]);
}
function reviewContent() { return advance(advance(advance(initial(), 'brief_accepted'), 'research_complete'), 'content_ready'); }
function reviewAssets() { return advance(advance(reviewContent(), 'content_approved'), 'assets_complete'); }
function rejected(task: Task, a: TaskAction, code: string, receipts: Receipt[] = []) {
  assert.deepEqual(applyWorkspaceAction(task, a, receipts, a.type === 'feedback' || a.type === 'content_feedback' || a.type === 'cancel' ? 'user' : 'worker'), { ok: false, code });
}

test('full lifecycle requires matching retained receipts at every stage', () => {
  let task = initial();
  for (const [kind, stage] of [['brief_accepted', 'research'], ['research_complete', 'content_authoring'], ['content_ready', 'content_review'], ['content_approved', 'assets'], ['assets_complete', 'review'], ['review_passed', 'packaging'], ['package_verified', 'completed']] as const) {
    task = advance(task, kind);
    assert.equal(task.stage, stage);
  }
  rejected(task, action(task, { type: 'cancel' }), 'terminal_task');
  assert.equal(task.consumed_receipts.length, 7);
});

test('caller assertions cannot skip stage receipts', () => {
  const task = initial();
  rejected(task, action(task, { type: 'advance', receipt_id: 'fake', approved: true }), 'missing_or_ambiguous_receipt');
  const r = receipt(task, 'package_verified');
  rejected(task, action(task, { type: 'advance', receipt_id: r.receipt_id }), 'wrong_stage_receipt', [r]);
});

test('receipts bind exact task, state version, content revision and snapshot', () => {
  const task = initial();
  for (const wrong of [{ task_id: 'other' }, { state_version: 12 }, { content_revision: 'v0' }, { snapshot_id: 's0' }, { evidence_ref: '' }]) {
    const r = receipt(task, 'brief_accepted', wrong);
    rejected(task, action(task, { type: 'advance', receipt_id: r.receipt_id }), 'receipt_scope_mismatch', [r]);
  }
  const r = receipt(task, 'brief_accepted');
  rejected(task, action(task, { type: 'advance', receipt_id: r.receipt_id }), 'missing_or_ambiguous_receipt', [r, r]);
});

test('exact duplicate is idempotent even after later progression; altered key reuse fails', () => {
  const task = initial(); const r = receipt(task, 'brief_accepted');
  const a = action(task, { type: 'advance', receipt_id: r.receipt_id });
  const current = advance(accept(task, a, [r]), 'research_complete');
  assert.deepEqual(applyWorkspaceAction(current, a, [], 'worker'), { ok: true, duplicate: true, task: current });
  rejected(current, { ...a, receipt_id: 'changed' } as TaskAction, 'idempotency_conflict');
});

test('stale actions and wrong task cannot mutate current task', () => {
  const task = initial(); const stale = action(task, { type: 'cancel' }, 'stale');
  rejected(advance(task, 'brief_accepted'), stale, 'stale_action');
  rejected(task, { ...stale, task_id: 'other' }, 'wrong_task');
  rejected(task, { ...stale, content_revision: 'v0' }, 'stale_action');
});

test('content change clears approval and returns to content review', () => {
  const task = advance(reviewContent(), 'content_approved');
  const nextSnapshot = { ...task.snapshot, snapshot_id: 's2', content_revision: 'v2', content_digest: 'digest-2', assets: [] };
  const r = receipt(task, 'content_revised', { snapshot: nextSnapshot });
  const result = accept(task, action(task, { type: 'revise_content', receipt_id: r.receipt_id }), [r]);
  assert.equal(result.stage, 'content_review'); assert.equal(result.approval, undefined);
  assert.equal(result.snapshot.content_revision, 'v2');
  assert.ok(task.approval); assert.equal(task.snapshot.content_revision, 'authored-v1');
});

test('revision rejects retained old content assets and canonical drift', () => {
  const task = reviewAssets();
  for (const s of [
    { ...task.snapshot, snapshot_id: 's2', content_revision: 'v2', content_digest: 'd2' },
    { ...task.snapshot, snapshot_id: 's2', content_revision: 'v2', content_digest: 'd2', canonical_version: 'other', assets: [] },
  ]) {
    const r = receipt(task, 'content_revised', { snapshot: s });
    rejected(task, action(task, { type: 'revise_content', receipt_id: r.receipt_id }), 'invalid_content_revision', [r]);
  }
});

test('asset delivery preserves stable slot and binds new rendition, invalidating old feedback index', () => {
  const task = { ...reviewAssets(), stage: 'assets' as const };
  const prior = workspaceFeedbackIndex({ ...task, stage: 'review' }); assert.ok(prior.ok);
  const s = { ...task.snapshot, snapshot_id: 's2', assets: task.snapshot.assets.map(a => ({ ...a, revision_id: 'a2' })) };
  const r = receipt(task, 'assets_complete', { snapshot: s });
  const updated = accept(task, action(task, { type: 'advance', receipt_id: r.receipt_id }), [r]);
  assert.equal(updated.snapshot.assets[0].canonical_slot, slot);
  if (prior.ok) rejected(updated, action(updated, { type: 'feedback', request: { index_id: prior.index.index_id, blocks: [{ text: 'Fix', all: true }] } }), 'stale_index');
});

test('grouped feedback uses current revision-specific inventory and rejects overlap', () => {
  const task = reviewAssets(); const index = workspaceFeedbackIndex(task); assert.ok(index.ok);
  if (!index.ok) return;
  const request = { index_id: index.index.index_id, blocks: [{ text: 'Improve this', canonical_slots: [slot] }] };
  const next = accept(task, action(task, { type: 'feedback', request }));
  assert.deepEqual(next.feedback[0].blocks[0].asset_ids, ['hero@a1']);
  assert.equal(next.stage, 'review'); // Feedback is intent, not generation or training.
  rejected(task, action(task, { type: 'feedback', request: { ...request, blocks: [...request.blocks, ...request.blocks] } }), 'overlapping_blocks');
});

test('unknown provider outcome cannot advance, revise, cancel or retry by ordinary recovery', () => {
  const task = advance(reviewContent(), 'content_approved');
  const unknown = accept(task, action(task, { type: 'interrupt', outcome: 'unknown', operation_id: 'provider-job', reason: 'timeout' }));
  rejected(unknown, action(unknown, { type: 'cancel' }), 'reconciliation_required');
  const wrong = receipt(unknown, 'recovery_verified', { operation_id: 'provider-job' });
  rejected(unknown, action(unknown, { type: 'recover', receipt_id: wrong.receipt_id }), 'reconciliation_required', [wrong]);
  const completed = receipt(unknown, 'assets_complete');
  rejected(unknown, action(unknown, { type: 'advance', receipt_id: completed.receipt_id }), 'recovery_required', [completed]);
  const revised = receipt(unknown, 'content_revised');
  rejected(unknown, action(unknown, { type: 'revise_content', receipt_id: revised.receipt_id }), 'recovery_required', [revised]);
  const r = receipt(unknown, 'reconciled', { operation_id: 'provider-job' });
  const restored = accept(unknown, action(unknown, { type: 'recover', receipt_id: r.receipt_id }), [r]);
  assert.equal(restored.stage, 'assets'); assert.equal(restored.interruption, undefined);
});

test('blocked and failed recover only with evidence for the same operation', () => {
  for (const outcome of ['blocked', 'failed'] as const) {
    const task = initial();
    const stopped = accept(task, action(task, { type: 'interrupt', outcome, operation_id: 'op1', reason: 'reason' }));
    const wrong = receipt(stopped, 'recovery_verified', { operation_id: 'other' });
    rejected(stopped, action(stopped, { type: 'recover', receipt_id: wrong.receipt_id }), 'reconciliation_required', [wrong]);
    const r = receipt(stopped, 'recovery_verified', { operation_id: 'op1' });
    assert.equal(accept(stopped, action(stopped, { type: 'recover', receipt_id: r.receipt_id }), [r]).stage, 'draft');
  }
});

test('snapshots reject duplicate canonical slots and isolate source objects', () => {
  const t = initial();
  assert.throws(() => createWorkspaceTask('bad', { ...t.snapshot, assets: [...t.snapshot.assets, { ...t.snapshot.assets[0], asset_id: 'another' }] }), /invalid_task_snapshot/);
  const source = structuredClone(t.snapshot);
  const created = createWorkspaceTask('clone', source);
  (source.assets[0] as { label: string }).label = 'changed';
  assert.equal(created.snapshot.assets[0].label, 'Hero');
});

test('asset-dependent gates reject an empty inventory and missing approval', () => {
  const task = { ...reviewAssets(), stage: 'assets' as const };
  const empty = { ...task, snapshot: { ...task.snapshot, assets: [] } };
  const r = receipt(empty, 'assets_complete');
  rejected(empty, action(empty, { type: 'advance', receipt_id: r.receipt_id }), 'asset_inventory_required', [r]);
  const noApproval = { ...task, approval: undefined };
  const r2 = receipt(noApproval, 'assets_complete');
  rejected(noApproval, action(noApproval, { type: 'advance', receipt_id: r2.receipt_id }), 'content_approval_required', [r2]);
});

 test('workers advance automatically but cannot impersonate user feedback; users cannot submit worker receipts', () => {
  const task = initial();
  const r = receipt(task, 'brief_accepted');
  assert.deepEqual(applyWorkspaceAction(task, action(task, { type: 'advance', receipt_id: r.receipt_id }), [r], 'user'), { ok: false, code: 'wrong_command_source' });
  assert.deepEqual(applyWorkspaceAction(task, action(task, { type: 'cancel' }), [], 'worker'), { ok: false, code: 'wrong_command_source' });
});

test('initial content requires distinct authored snapshot after research, before approval', () => {
  const task = advance(advance(initial(), 'brief_accepted'), 'research_complete');
  assert.equal(task.stage, 'content_authoring');
  const missing = receipt(task, 'content_ready');
  rejected(task, action(task, { type: 'advance', receipt_id: missing.receipt_id }), 'invalid_initial_content', [missing]);
  const unchanged = receipt(task, 'content_ready', { snapshot: task.snapshot });
  rejected(task, action(task, { type: 'advance', receipt_id: unchanged.receipt_id }), 'invalid_initial_content', [unchanged]);
  const authored = advance(task, 'content_ready');
  assert.equal(authored.stage, 'content_review');
  assert.notEqual(authored.snapshot.content_revision, task.snapshot.content_revision);
  assert.equal(authored.snapshot.assets.length, 0);
});

test('content-only feedback works with no assets, blocks approval and needs matching revision receipt', () => {
  const task = reviewContent();
  assert.equal(task.snapshot.assets.length, 0);
  const pending = accept(task, action(task, { type: 'content_feedback', text: 'Change the headline and explain the gift meaning.' }));
  assert.equal(pending.pending_feedback?.kind, 'content');
  const approval = receipt(pending, 'content_approved');
  rejected(pending, action(pending, { type: 'advance', receipt_id: approval.receipt_id }), 'feedback_unresolved', [approval]);
  const s = { ...pending.snapshot, snapshot_id: 'content-s2', content_revision: 'authored-v2', content_digest: 'digest-v2' };
  const wrong = receipt(pending, 'content_revised', { snapshot: s, feedback_action_id: 'wrong' });
  rejected(pending, action(pending, { type: 'revise_content', receipt_id: wrong.receipt_id }), 'feedback_receipt_mismatch', [wrong]);
  const r = receipt(pending, 'content_revised', { snapshot: s, feedback_action_id: pending.pending_feedback!.action_id });
  const revised = accept(pending, action(pending, { type: 'revise_content', receipt_id: r.receipt_id }), [r]);
  assert.equal(revised.pending_feedback, undefined);
  assert.equal(revised.approval, undefined);
  assert.equal(advance(revised, 'content_approved').stage, 'assets');
});

function selectedRevisionSetup() {
  const t = reviewAssets();
  const secondSlot = Object.keys(ONEPAGE_DELIVERY_ROLES)[1];
  const task: Task = { ...t, snapshot: { ...t.snapshot, assets: [...t.snapshot.assets, { asset_id: 'detail', canonical_slot: secondSlot, revision_id: 'detail-1', content_revision: t.snapshot.content_revision, label: 'Detail' }] } };
  const index = workspaceFeedbackIndex(task); if (!index.ok) throw new Error('index');
  const a = action(task, { type: 'feedback', request: { index_id: index.index.index_id, blocks: [{ text: 'Repair hero only', canonical_slots: [slot] }] } });
  const pending = accept(task, a);
  const snapshot: TaskSnapshot = { ...pending.snapshot, snapshot_id: 'selective-s2', assets: pending.snapshot.assets.map(a => a.canonical_slot === slot ? { ...a, revision_id: 'hero-2' } : a) };
  return { task, pending, snapshot };
}

test('pending asset feedback blocks fresh QA, old QA, packaging and extra feedback', () => {
  const { task, pending } = selectedRevisionSetup();
  const oldQa = receipt(task, 'review_passed');
  rejected(pending, action(pending, { type: 'advance', receipt_id: oldQa.receipt_id }), 'receipt_scope_mismatch', [oldQa]);
  const freshQa = receipt(pending, 'review_passed');
  rejected(pending, action(pending, { type: 'advance', receipt_id: freshQa.receipt_id }), 'feedback_unresolved', [freshQa]);
  const fakePackage = receipt(pending, 'package_verified');
  rejected(pending, action(pending, { type: 'advance', receipt_id: fakePackage.receipt_id }), 'feedback_unresolved', [fakePackage]);
  rejected(pending, action(pending, { type: 'feedback', request: {} }), 'feedback_unresolved');
});

test('selective asset revision preserves all unselected revisions and requires fresh QA', () => {
  const { task, pending, snapshot } = selectedRevisionSetup();
  const r = receipt(pending, 'assets_revised', { snapshot, feedback_action_id: pending.pending_feedback!.action_id });
  const revised = accept(pending, action(pending, { type: 'revise_assets', receipt_id: r.receipt_id }), [r]);
  assert.equal(revised.stage, 'review'); assert.equal(revised.pending_feedback, undefined);
  assert.deepEqual(revised.snapshot.assets[1], task.snapshot.assets[1]);
  assert.equal(revised.approval?.receipt_id, task.approval?.receipt_id);
  const oldQa = receipt(task, 'review_passed');
  rejected(revised, action(revised, { type: 'advance', receipt_id: oldQa.receipt_id }), 'receipt_scope_mismatch', [oldQa]);
  assert.notDeepEqual(workspaceFeedbackIndex(revised), workspaceFeedbackIndex(task));
  assert.equal(advance(revised, 'review_passed').stage, 'packaging');
});

test('selective revision rejects scope expansion, unchanged selected assets and wrong feedback', () => {
  const { pending, snapshot } = selectedRevisionSetup();
  for (const [s, expected] of [
    [{ ...snapshot, assets: snapshot.assets.map(a => ({ ...a, revision_id: 'all-new' })) }, 'unselected_asset_changed'],
    [{ ...snapshot, assets: pending.snapshot.assets }, 'selected_asset_not_revised'],
    [{ ...snapshot, assets: snapshot.assets.map(a => ({ ...a, asset_id: 'replaced-' + a.asset_id })) }, 'asset_scope_changed'],
    [{ ...snapshot, content_digest: 'changed-copy' }, 'invalid_asset_snapshot'],
  ] as const) {
    const r = receipt(pending, 'assets_revised', { snapshot: s, feedback_action_id: pending.pending_feedback!.action_id });
    rejected(pending, action(pending, { type: 'revise_assets', receipt_id: r.receipt_id }), expected, [r]);
  }
  const r = receipt(pending, 'assets_revised', { snapshot, feedback_action_id: 'different-feedback' });
  rejected(pending, action(pending, { type: 'revise_assets', receipt_id: r.receipt_id }), 'feedback_receipt_mismatch', [r]);
});

test('delivered task explicitly reopens on asset or content feedback but cannot reuse package receipt', () => {
  const done = advance(advance(reviewAssets(), 'review_passed'), 'package_verified');
  const index = workspaceFeedbackIndex(done); if (!index.ok) throw new Error('index');
  const assets = accept(done, action(done, { type: 'feedback', request: { index_id: index.index.index_id, blocks: [{ text: 'Change the hero', canonical_slots: [slot] }] } }));
  assert.equal(assets.stage, 'review'); assert.equal(assets.pending_feedback?.kind, 'assets');
  const content = accept(done, action(done, { type: 'content_feedback', text: 'Revise the headline' }));
  assert.equal(content.stage, 'content_review'); assert.equal(content.approval, undefined);
  assert.equal(done.stage, 'completed');
  const r = receipt(assets, 'package_verified');
  rejected(assets, action(assets, { type: 'advance', receipt_id: r.receipt_id }), 'feedback_unresolved', [r]);
});

test('unresolved brief requires a trusted canonical pin without changing brief content', () => {
 const task=createWorkspaceTask('task-new',{snapshot_id:'brief-s',canonical_version:'unresolved',content_revision:'brief-v',content_digest:'brief-d',assets:[]});
 const r=receipt(task,'brief_accepted'); const a=action(task,{type:'advance',receipt_id:r.receipt_id});
 rejected(task,a,'canonical_pin_required',[r]);
 const pinned={...task.snapshot,snapshot_id:'pinned-s',canonical_version:'canonical-hash'};
 for(const invalid of [{canonical_version:'unresolved'},{snapshot_id:'brief-s'},{content_revision:'rewritten'},{content_digest:'rewritten'},{assets:initial().snapshot.assets}]) rejected(task,a,'canonical_pin_required',[{...r,snapshot:{...pinned,...invalid}}]);
 const next=accept(task,a,[{...r,snapshot:pinned}]); assert.equal(next.stage,'research');assert.equal(next.snapshot.canonical_version,'canonical-hash');assert.equal(next.snapshot.content_digest,'brief-d');
});
