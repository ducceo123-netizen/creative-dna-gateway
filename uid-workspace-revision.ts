import type { TaskSnapshot } from './uid-workspace-task.ts';
import type { WorkspaceRecord } from './uid-workspace-store.ts';
import type { WorkspaceFeedbackIntent } from './uid-workspace-runner.ts';

/** Private immutable history. An API must project owner-authorized metadata and
 * serve historical bytes through the existing private artifact renderer. */
export type WorkspaceRevisionHistory = {
  revision_id: string; captured_at: string; action_id: string;
  snapshot: TaskSnapshot; content: WorkspaceRecord['content'];
  review_manifest: WorkspaceRecord['review_manifest']; preview: WorkspaceRecord['preview'];
  artifact_ids: string[];
};
export type WorkspaceRevisionPlan = {
  plan_id: string; action_id: string; source_revision_id: string;
  source_snapshot: TaskSnapshot; source_content: WorkspaceRecord['content'];
  source_assets: Array<{ canonical_slot: string; asset_id: string; revision_id: string;
    artifact_id: string; sha256: string; storage_key: string; media_type: string;
    filename: string; size_bytes: number; width?: number; height?: number }>;
  /** Original exact group boundaries/instructions never rewritten on content rebase. */
  intent: WorkspaceFeedbackIntent;
  source_references?: WorkspaceRecord['references'];
  phase: 'content_pending' | 'awaiting_content_approval' | 'reusing_assets' | 'assets_pending' | 'review_ready';
  revised_content_revision?: string; reuse_evidence_refs?: string[];
  completed_snapshot_id?: string;
};

export function captureWorkspaceRevision(record: WorkspaceRecord, actionId: string, now: string): WorkspaceRevisionHistory {
  return structuredClone({ revision_id: record.task.snapshot.snapshot_id, captured_at: now, action_id: actionId,
    snapshot: record.task.snapshot, content: record.content, review_manifest: record.review_manifest, preview: record.preview,
    // Freeze supporting immutable documents that already exist at capture time.
    // Canonical/research receipts may belong to the original brief revision. Do
    // not resolve dependencies later from the current record or admit future docs.
    artifact_ids: record.artifacts.filter(item => item.content_revision === record.task.snapshot.content_revision || item.kind === 'document' && item.verification === 'verified').map(item => item.artifact_id) });
}
export function createWorkspaceRevisionPlan(record: WorkspaceRecord, actionId: string, intent: WorkspaceFeedbackIntent): WorkspaceRevisionPlan {
  const source_assets = record.task.snapshot.assets.map(asset => {
    const matches = record.artifacts.filter(file => file.kind === 'image' && file.verification === 'verified' && file.revision_id === asset.revision_id && file.content_revision === record.task.snapshot.content_revision);
    if (!matches.length || new Set(matches.map(item => `${item.sha256}:${item.storage_key}`)).size !== 1) throw new Error('REVISION_SOURCE_ASSET_CONFLICT');
    const file = matches[0];
    return { canonical_slot: asset.canonical_slot, asset_id: asset.asset_id, revision_id: asset.revision_id, artifact_id: file.artifact_id,
      sha256: file.sha256, storage_key: file.storage_key, media_type: file.media_type, filename: file.filename, size_bytes: file.size_bytes,
      ...(file.width === undefined ? {} : { width: file.width }), ...(file.height === undefined ? {} : { height: file.height }) };
  });
  const selectedReferenceIds = new Set([...(intent.reference_ids ?? []), ...intent.groups.flatMap(group => group.reference_ids ?? [])]);
  const source_references = (record.references ?? []).filter(reference => selectedReferenceIds.has(reference.reference_id));
  return structuredClone({ source_references, plan_id: 'revision:' + actionId, action_id: actionId, source_revision_id: record.task.snapshot.snapshot_id,
    source_snapshot: record.task.snapshot, source_content: record.content, source_assets, intent,
    phase: intent.groups.some(group => group.text_slots.length) ? 'content_pending' : 'assets_pending' });
}
