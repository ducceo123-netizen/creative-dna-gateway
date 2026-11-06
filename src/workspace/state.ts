import type { FeedbackDraft, FeedbackRequest, Review, TaskStage, WorkspaceEvent, WorkspaceReviewManifest } from './types';

export const stageLabels: Record<TaskStage, string> = {
  draft: 'Bản brief', research: 'Đang research', content_authoring: 'Đang viết content',
  content_review: 'Cần duyệt content', assets: 'Đang tạo material', review: 'Cần review',
  packaging: 'Đang đóng gói', completed: 'Đã hoàn tất', blocked: 'Đang bị chặn',
  failed: 'Cần xử lý lỗi', unknown: 'Cần đối soát', cancelled: 'Đã hủy',
};
export const stages = ['Brief', 'Research', 'Content', 'Material', 'Đóng gói'] as const;
export function stageIndex(stage: TaskStage): number {
  return ({ draft: 0, research: 1, content_authoring: 2, content_review: 2, assets: 3,
    review: 3, packaging: 4, completed: 4 } as Partial<Record<TaskStage, number>>)[stage] ?? -1;
}
export function newKey(): string { return crypto.randomUUID(); }
export function emptyFeedback(manifest: WorkspaceReviewManifest, groupId = newKey()): FeedbackDraft {
  return { task_id: manifest.task_id, content_revision: manifest.content_revision,
    render_hash: manifest.render_hash, index_id: manifest.index_id,
    groups: [{ id: groupId, instruction: '', element_ids: [], viewport_width: 1280 }], active_group_id: groupId };
}
export function isStaleDraft(draft: FeedbackDraft, manifest: WorkspaceReviewManifest): boolean {
  return draft.task_id !== manifest.task_id || draft.content_revision !== manifest.content_revision
    || draft.render_hash !== manifest.render_hash || draft.index_id !== manifest.index_id;
}
/** Rebinding is an explicit user action. Keep instructions but never silently carry stale targets. */
export function rebaseDraft(draft: FeedbackDraft, manifest: WorkspaceReviewManifest): FeedbackDraft {
  return { ...draft, task_id: manifest.task_id, content_revision: manifest.content_revision,
    render_hash: manifest.render_hash, index_id: manifest.index_id,
    groups: draft.groups.map(group => ({ ...group, element_ids: [], reference_ids: [] })) };
}
export function logicalTargets(manifest: WorkspaceReviewManifest, selected: string[]): Set<string> {
  const entries = new Map(manifest.elements.map(element => [element.id, element]));
  const leaves = new Set<string>();
  for (const id of selected) {
    const element = entries.get(id);
    if (!element) continue;
    if (element.kind === 'section') element.children.forEach(child => leaves.add(child));
    else leaves.add(id);
  }
  return new Set([...leaves].flatMap(id => {
    const element = entries.get(id);
    return element?.kind === 'text' ? ['text:' + element.slot]
      : element?.kind === 'image' ? ['asset:' + element.canonical_slot] : [];
  }));
}
export function feedbackError(draft: FeedbackDraft, manifest: WorkspaceReviewManifest): string | null {
  if (isStaleDraft(draft, manifest)) return 'Preview đã có phiên bản mới. Giữ lại nội dung góp ý và chọn lại phạm vi trước khi gửi.';
  if (!draft.groups.length || draft.groups.length > 10) return 'Mỗi lần gửi gồm 1 đến 10 nhóm góp ý.';
  const assigned = new Set<string>();
  for (const [index, group] of draft.groups.entries()) {
    if (!group.instruction.trim()) return `Nhập yêu cầu cho nhóm ${index + 1}.`;
    if (group.instruction.trim().length > 4000) return `Nhóm ${index + 1} vượt quá 4.000 ký tự.`;
    if (!group.element_ids.length) return `Chọn ít nhất một đối tượng cho nhóm ${index + 1}.`;
    if (group.element_ids.some(id => !manifest.elements.some(element => element.id === id))) return `Nhóm ${index + 1} có đối tượng không còn trong preview.`;
    const targets = logicalTargets(manifest, group.element_ids);
    for (const target of targets) {
      if (assigned.has(target)) return 'Các nhóm đang trùng đối tượng. Gộp yêu cầu hoặc bỏ đối tượng trùng trước khi gửi.';
      assigned.add(target);
    }
  }
  return null;
}
export function feedbackRequest(draft: FeedbackDraft): FeedbackRequest {
  const { active_group_id: _active, groups, ...binding } = draft;
  return { ...binding, groups: groups.map(({ id: _id, instruction, ...group }) => ({ ...group, instruction: instruction.trim() })) };
}
/** Validate opaque-frame messages against the exact frame + current trusted render. */
export function selectionFromMessage(data: unknown, sourceMatches: boolean, review: Review): string | null {
  if (!sourceMatches || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (message.type !== 'uid-workspace-selection' || message.channel_nonce !== review.channel_nonce

      || message.render_hash !== review.manifest.render_hash || message.index_id !== review.manifest.index_id
      || typeof message.element_id !== 'string') return null;
  return review.manifest.elements.some(element => element.id === message.element_id) ? message.element_id : null;
}
export function safeDownloadPath(path: string | undefined, taskId: string): string | null {
  if (!path || !path.startsWith(`/api/workspace/tasks/${encodeURIComponent(taskId)}/artifacts/`)
    || /[\\\r\n]/.test(path) || path.includes('?') || path.includes('#') || /(?:^|\/)\.\.?(?:\/|$)|%2f|%5c|%2e/i.test(path)) return null;
  return path;
}
export function sourceUrlError(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return 'Dùng đường dẫn HTTPS công khai, không kèm thông tin đăng nhập.';
    return null;
  } catch { return 'Nhập đường dẫn sản phẩm hoặc collection hợp lệ.'; }
}
export function readableName(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/^./, char => char.toUpperCase());
}
/** Static explanations only. Provider/source strings are never instructions or
 * an assurance that retrying a paid operation is safe. */
export function interruptionMessage(code: string, unknown = false): string {
  if (unknown) return 'Chưa xác nhận được kết quả cuối cùng. Giữ nguyên tác vụ để đối soát; không tạo lại lần chạy có thể đã phát sinh phí.';
  const messages: Record<string, string> = {
    RESEARCH_MULTI_VARIANT_CANONICAL_UNSUPPORTED: 'Nguồn có nhiều biến thể hoặc ảnh dùng chung mà cấu trúc Onepage hiện tại chưa biểu diễn được đầy đủ. Cần kiểm tra phạm vi sản phẩm; chưa chuyển sang viết content hay tạo ảnh.',
    INVENTORY_REVIEWED_PLAN_REQUIRED: 'Chưa có cách kiểm tra đầy đủ gallery và biến thể cho phiên bản trang nguồn này. Cần bổ sung kiểm tra nguồn trước khi tiếp tục.',
    RESEARCH_RENDERED_INVENTORY_NOT_CONFIGURED: 'Chưa cấu hình kiểm tra gallery và chi tiết sản phẩm từ nguồn thật.',
    ONEPAGE_RESEARCH_INCOMPLETE: 'Bằng chứng research chưa đủ điều kiện. Cần bổ sung nguồn hoặc xử lý những phần chưa được kiểm tra.',
    ASSET_ICON_DISPLAY_EVIDENCE_REQUIRED: 'Chưa xác minh kích thước hiển thị của icon trong template. Chưa gửi yêu cầu tạo ảnh.',
    ASSET_REVIEWED_FITTING_STRATEGY_REQUIRED: 'Kích thước ảnh cần được kiểm tra để giữ đúng tỷ lệ và không cắt nội dung trước khi tạo.',
    CURRENT_MEMBER_AUTHORIZATION_REQUIRED: 'Quyền thực thi hiện tại của tài khoản chưa được xác nhận. Cần kiểm tra quyền thành viên trước khi tiếp tục.',
  };
  return messages[code] ?? 'Tác vụ đang dừng ở một điều kiện chưa đạt. Kiểm tra hoạt động và cấu hình liên quan trước khi tiếp tục; kết quả chưa được xem là hoàn tất.';
}

export function mergeEventPage(current: { cursor: number; events: WorkspaceEvent[] }, page: { cursor: number; events: WorkspaceEvent[] }) {
  const bySequence = new Map([...current.events, ...page.events].map(event => [event.sequence, event]));
  return { cursor: Math.max(current.cursor, page.cursor), events: [...bySequence.values()].sort((a, b) => a.sequence - b.sequence).slice(-200) };
}

/** Merge server pages without downgrading an already observed revision. */
export function mergeTaskPage(current: import('./types').WorkspaceTask[], page: import('./types').WorkspaceTask[]): import('./types').WorkspaceTask[] {
  const byId = new Map(current.map(task => [task.task_id, task]));
  for (const task of page) if (!byId.has(task.task_id) || byId.get(task.task_id)!.state_version <= task.state_version) byId.set(task.task_id, task);
  return [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.task_id.localeCompare(a.task_id));
}
