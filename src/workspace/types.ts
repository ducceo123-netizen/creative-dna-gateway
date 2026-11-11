/** Browser-facing workspace contracts. No provider credentials or task authority live here. */
import type { Task, TaskStage } from '../../uid-workspace-task';
import type { WorkspaceReviewManifest } from '../../uid-workspace-review';

export type { TaskStage, WorkspaceReviewManifest };
export type Readiness = {
  authentication_configured: boolean;
  login_supported?: boolean;
  storage: { configured: boolean; kind: string; production_ready: boolean };
  execution: { ready: boolean; blockers: { code: string; message: string }[] };
  session_endpoint?: string;
  uploads?: { configured: boolean; max_bytes?: number; allowed_media_types?: string[]; blockers?: { code: string; message: string }[] };
  brands?: { id: string; label: string }[];
  materials?: { id: string; label: string; creation_supported: boolean; executable: boolean }[];
};
export type Brief = { brand: string; material: 'onepage'; source_url: string; requirements?: string; title?: string };
export type Artifact = {
  artifact_id: string; filename: string; media_type: string; size_bytes: number; revision_id: string;
  width?: number; height?: number; verification: 'pending' | 'verified' | 'failed'; download_url?: string;
};
export type WorkspaceTask = Omit<Task, 'feedback' | 'applied' | 'consumed_receipts'> & {
  owner_id?: string; brief: Brief; created_at: string; updated_at: string; artifacts: Artifact[];
  review_manifest: WorkspaceReviewManifest | null; content: { revision: string; slots: Record<string, string> } | null;
  quality: { name: string; status: string; detail?: string }[];
  actions: ActionReceipt[]; references?: PrivateReference[]; recovery?: Recovery;
};
export type ActionReceipt = { action_id: string; idempotency_key?: string; type: string; status: string; created_at: string };
export type WorkspaceEvent = { sequence: number; type: string; created_at: string; data: Record<string, unknown> };
export type TaskResponse = { task: WorkspaceTask; readiness: Readiness; owner_id?: string };
export type TaskPage = { tasks: WorkspaceTask[]; readiness: Readiness; owner_id?: string; next_cursor?: string | null; has_more?: boolean };
export type Session = { authenticated: boolean; user?: { id: string } };
export type Review = { html: string; manifest: WorkspaceReviewManifest; channel_nonce: string };
export type FeedbackGroup = { id: string; instruction: string; element_ids: string[]; viewport_width: number; reference_ids?: string[] };
export type FeedbackDraft = {
  task_id: string; content_revision: string; render_hash: string; index_id: string;
  groups: FeedbackGroup[]; active_group_id: string;
};
export type FeedbackRequest = Omit<FeedbackDraft, 'groups' | 'active_group_id'> & {
  groups: Omit<FeedbackGroup, 'id'>[];
};

export type ContentFeedbackDraft = { reference_ids?: string[]; content_revision: string; groups: { id: string; instruction: string; slots: string[] }[]; active_group_id: string };
export type ContentFeedbackRequest = { reference_ids?: string[]; groups: { instruction: string; text_slots: { slot: string; text_hash: string }[] }[] };

export type RevisionSummary = { revision_id: string; captured_at: string; content_revision: string; render_hash?: string; artifact_ids?: string[]; has_preview?: boolean; current: boolean };
export type RevisionHistory = { current_revision_id: string; revisions: RevisionSummary[]; owner_id?: string };
export type Recovery = { status: string; message: string; can_reconcile: boolean; run_id?: string };
export type PrivateReference = { reference_id: string; filename: string; media_type: string; size_bytes: number; sha256: string; width?: number; height?: number; role: string; note?: string; content_revision: string; technical_validation: string; visual_inspection: 'not_performed'; purpose?: 'brief' | 'feedback'; review_index_id?: string; removed_at?: string };
export type UploadIntent = { idempotency_key: string; expected_state_version: number; content_revision: string; filename: string; media_type: string; size_bytes: number; sha256: string; role: 'product' | 'style' | 'brand' | 'other'; note?: string; purpose?: 'brief' | 'feedback'; review_index_id?: string };
export type UploadReceipt = { upload_id: string; status: string; reference_id?: string; filename?: string; message?: string };
