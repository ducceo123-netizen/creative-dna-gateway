import type { Brief, FeedbackRequest, Readiness, Review, TaskResponse, WorkspaceEvent, WorkspaceTask, ActionReceipt, ContentFeedbackRequest, Session, TaskPage, RevisionHistory, Recovery, UploadIntent, UploadReceipt } from './types';

export class WorkspaceApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export interface WorkspaceApi {
  config(signal?: AbortSignal): Promise<Readiness>;
  logout(): Promise<Session>;
  login(email: string, password: string): Promise<Session>;
  session(signal?: AbortSignal): Promise<Session>;
  tasks(signal?: AbortSignal, cursor?: string): Promise<TaskPage>;
  task(id: string, signal?: AbortSignal): Promise<TaskResponse>;
  create(brief: Brief, key: string): Promise<TaskResponse & { duplicate: boolean }>;
  action(task: WorkspaceTask, type: string, key: string, feedback?: FeedbackRequest, contentFeedback?: ContentFeedbackRequest): Promise<TaskResponse & { action: ActionReceipt; duplicate: boolean }>;
  events(id: string, after?: number, signal?: AbortSignal): Promise<{ events: WorkspaceEvent[]; cursor: number; has_more: boolean }>;
  review(id: string, signal?: AbortSignal): Promise<Review>;
  revisions(id: string, signal?: AbortSignal): Promise<RevisionHistory>;
  historicalReview(id: string, revisionId: string, signal?: AbortSignal): Promise<Review>;
  recovery(id: string, signal?: AbortSignal): Promise<Recovery>;
  reconcile(task: WorkspaceTask, runId: string, key: string): Promise<TaskResponse>;
  prepareUpload(id: string, intent: UploadIntent): Promise<{ upload: UploadReceipt; duplicate: boolean }>;
  putUpload(id: string, uploadId: string, file: File): Promise<{ upload: UploadReceipt }>;
  resolveUpload(id: string, idempotencyKey: string): Promise<{ upload: UploadReceipt }>;
  uploadStatus(id: string, uploadId: string): Promise<{ upload: UploadReceipt }>;
  removeReference(task: WorkspaceTask, referenceId: string): Promise<{ removed: boolean; duplicate: boolean }>;

}
/** Cookie session by default; an existing authenticated integration may inject an in-memory token getter.
 * No token entry, storage, fallback identity or automatic mutation retry is implemented here. */
export function createWorkspaceApi(getAccessToken?: () => Promise<string | null>): WorkspaceApi {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getAccessToken?.();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
      const response = await fetch('/api/workspace' + path, { ...options, credentials: 'same-origin',
        signal: controller.signal, headers: { Accept: 'application/json', ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
      const body = await response.json().catch(() => null);
      if (['POST', 'PUT', 'DELETE'].includes(options.method || '') && response.status >= 500 && !['EXECUTION_UNAVAILABLE', 'WORKSPACE_NOT_CONFIGURED', 'AUTH_NOT_CONFIGURED', 'STORAGE_NOT_CONFIGURED'].includes(body?.error?.code)) throw new WorkspaceApiError(0, 'outcome_unknown', 'Máy chủ chưa xác nhận kết quả thao tác. Hãy kiểm tra trạng thái đã lưu trước khi thử lại.');
      if (!response.ok) throw new WorkspaceApiError(response.status, body?.code || body?.error?.code || 'request_failed',
        typeof body?.message === 'string' ? body.message : typeof body?.error?.message === 'string' ? body.error.message : `Yêu cầu chưa hoàn tất (${response.status}).`);
      if (!body || typeof body !== 'object') throw new WorkspaceApiError(502, 'invalid_response', 'Máy chủ chưa trả về dữ liệu hợp lệ.');
      return body as T;
    } catch (error) {
      if (error instanceof WorkspaceApiError) throw error;
      if (options.signal?.aborted) throw error;
      throw new WorkspaceApiError(0, 'outcome_unknown', ['POST', 'PUT', 'DELETE'].includes(options.method || '')
        ? 'Chưa xác nhận được máy chủ đã nhận thao tác. Đừng gửi lại; tải trạng thái mới trước.'
        : 'Không kết nối được máy chủ. Dữ liệu đang nhập vẫn được giữ trong phiên này.');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
    }
  }
  const taskPath = (id: string) => '/tasks/' + encodeURIComponent(id);
  return {
    logout: () => request('/session', { method: 'DELETE' }),
    login: (email, password) => request('/session/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    config: signal => request('/config', { signal }), session: signal => request('/session', { signal }),
    tasks: (signal, cursor) => request('/tasks' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), { signal }), task: (id, signal) => request(taskPath(id), { signal }),
    create: (brief, key) => request('/tasks', { method: 'POST', body: JSON.stringify({ brief, idempotency_key: key }) }),
    action: (task, type, key, feedback, contentFeedback) => request(taskPath(task.task_id) + '/actions', { method: 'POST',
      body: JSON.stringify({ type, idempotency_key: key, expected_state_version: task.state_version,
        content_revision: task.snapshot.content_revision, ...(type === 'approve_artwork' && task.review_manifest ? { review_index_id: task.review_manifest.index_id, render_hash: task.review_manifest.render_hash } : {}), ...(feedback ? { feedback } : {}), ...(contentFeedback ? { content_feedback: contentFeedback } : {}) }) }),
    events: (id, after = 0, signal) => request(taskPath(id) + '/events?after=' + after, { signal }),
    review: (id, signal) => request(taskPath(id) + '/preview', { signal }),
    revisions: (id, signal) => request(taskPath(id) + '/revisions', { signal }),
    historicalReview: (id, revision, signal) => request(taskPath(id) + '/revisions/' + encodeURIComponent(revision) + '/preview', { signal }),
    recovery: (id, signal) => request(taskPath(id) + '/recovery', { signal }),
    reconcile: (task, runId, key) => request(taskPath(task.task_id) + '/recovery', { method: 'POST', body: JSON.stringify({ run_id: runId, expected_state_version: task.state_version, idempotency_key: key }) }),
    prepareUpload: (id, intent) => request(taskPath(id) + '/uploads', { method: 'POST', body: JSON.stringify(intent) }),
    putUpload: (id, uploadId, file) => request(taskPath(id) + '/uploads/' + encodeURIComponent(uploadId), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file }),
    resolveUpload: (id, key) => request(taskPath(id) + '/uploads?idempotency_key=' + encodeURIComponent(key)),
    uploadStatus: (id, uploadId) => request(taskPath(id) + '/uploads/' + encodeURIComponent(uploadId) + '/reconcile', { method: 'POST' }),
    removeReference: (task, referenceId) => request(taskPath(task.task_id) + '/references/' + encodeURIComponent(referenceId), { method: 'DELETE', body: JSON.stringify({ expected_state_version: task.state_version, content_revision: task.snapshot.content_revision }) }),
  };
}
