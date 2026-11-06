import { Plus, Trash2, X } from 'lucide-react';
import type { ContentFeedbackDraft, ContentFeedbackRequest, WorkspaceTask, PrivateReference } from './types';
import { newKey, readableName } from './state';
import { PolarisButton } from './polaris';

export function createContentDraft(revision: string): ContentFeedbackDraft {
  const id = newKey();
  return { content_revision: revision, groups: [{ id, instruction: '', slots: [] }], active_group_id: id };
}
export function contentFeedbackError(draft: ContentFeedbackDraft, content: NonNullable<WorkspaceTask['content']>): string | null {
  if (draft.content_revision !== content.revision) return 'Content đã đổi phiên bản. Giữ yêu cầu và chọn lại phạm vi.';
  const assigned = new Set<string>();
  if (draft.groups.length < 1 || draft.groups.length > 10) return 'Mỗi lần gửi gồm 1 đến 10 nhóm.';
  for (const [index, group] of draft.groups.entries()) {
    if (!group.instruction.trim() || group.instruction.length > 4000) return `Nhóm ${index + 1} cần yêu cầu từ 1 đến 4.000 ký tự.`;
    if (!group.slots.length) return `Chọn nội dung cho nhóm ${index + 1}.`;
    for (const slot of group.slots) {
      if (!Object.hasOwn(content.slots, slot)) return 'Nội dung đã chọn không còn tồn tại.';
      if (assigned.has(slot)) return 'Các nhóm không được trùng nội dung.';
      assigned.add(slot);
    }
  }
  return null;
}
export async function buildContentFeedback(draft: ContentFeedbackDraft, content: NonNullable<WorkspaceTask['content']>): Promise<ContentFeedbackRequest> {
  const error = contentFeedbackError(draft, content);
  if (error) throw new Error(error);
  return { ...(draft.reference_ids?.length ? { reference_ids: draft.reference_ids } : {}), groups: await Promise.all(draft.groups.map(async group => ({ instruction: group.instruction.trim(),
    text_slots: await Promise.all(group.slots.map(async slot => ({ slot, text_hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content.slots[slot])))).map(byte => byte.toString(16).padStart(2, '0')).join('') }))),
  }))) };
}
export function ContentReview({ content, draft, onChange, disabled, editing, onEdit, references = [] }: {
  references?: PrivateReference[]; content: NonNullable<WorkspaceTask['content']>; draft: ContentFeedbackDraft; onChange: (draft: ContentFeedbackDraft) => void;
  disabled: boolean; editing: boolean; onEdit: () => void;
}) {
  const stale = draft.content_revision !== content.revision;
  const active = draft.groups.find(group => group.id === draft.active_group_id) || draft.groups[0];
  return <div className="uw-content-review"><div className="uw-section-heading"><div><h2>Content theo slot canonical</h2><p className="uw-help">Chọn từng đoạn để góp ý. Chưa có material được tạo ở bước này.</p></div></div>
    <div className="uw-content-slots">{Object.entries(content.slots).map(([slot, text]) => <button className={active?.slots.includes(slot) && editing ? 'is-selected' : ''} key={slot} disabled={disabled || stale}
      aria-pressed={editing && !!active?.slots.includes(slot)} onClick={() => { onEdit(); onChange({ ...draft, groups: draft.groups.map(group => group.id === active.id ? { ...group, slots: group.slots.includes(slot) ? group.slots.filter(item => item !== slot) : [...group.slots, slot] } : group) }); }}>
      <span>{readableName(slot)}</span><p>{text}</p></button>)}</div>
    {editing && <section className="uw-content-feedback"><h3>Góp ý content</h3>
      {stale && <div className="uw-notice uw-warning"><div><strong>Content đã có phiên bản mới</strong><p>Nội dung góp ý được giữ. Chọn lại các đoạn cần sửa.</p><button className="uw-text-button" onClick={() => onChange({ ...draft, reference_ids: [], content_revision: content.revision, groups: draft.groups.map(group => ({ ...group, slots: [] })) })}>Giữ góp ý và chọn lại</button></div></div>}
      {draft.groups.map((group, index) => <div className={`uw-content-group ${active.id === group.id ? 'is-active' : ''}`} key={group.id}>
        <div className="uw-group-heading"><button className="uw-group-select" disabled={disabled} aria-pressed={active.id === group.id} onClick={() => onChange({ ...draft, active_group_id: group.id })}><span>{index + 1}</span>Nhóm {index + 1}<small>{group.slots.length} đoạn đã chọn</small></button>
          {draft.groups.length > 1 && <button className="uw-icon-button" disabled={disabled} aria-label={`Xóa nhóm ${index + 1}`} onClick={() => { const groups = draft.groups.filter(item => item.id !== group.id); onChange({ ...draft, groups, active_group_id: active.id === group.id ? groups[0].id : active.id }); }}><Trash2 size={14} /></button>}</div>
        <div className="uw-target-chips">{group.slots.map(slot => <button key={slot} disabled={disabled} onClick={() => onChange({ ...draft, groups: draft.groups.map(item => item.id === group.id ? { ...item, slots: item.slots.filter(key => key !== slot) } : item) })}><span>{readableName(slot)}</span><X size={11} /></button>)}</div>
        <s-text-area label={`Yêu cầu nhóm ${index + 1}`} value={group.instruction} rows={3} maxLength={4000} disabled={disabled} onInput={event => onChange({ ...draft, groups: draft.groups.map(item => item.id === group.id ? { ...item, instruction: event.currentTarget.value } : item) })} />
      </div>)}
      {!!references.length && <fieldset className="uw-reference-picker"><legend>Ảnh tham chiếu cho lần góp ý này</legend>{references.map(reference => <label key={reference.reference_id}><input type="checkbox" disabled={disabled || stale} checked={draft.reference_ids?.includes(reference.reference_id) || false} onChange={() => onChange({ ...draft, reference_ids: draft.reference_ids?.includes(reference.reference_id) ? draft.reference_ids.filter(id => id !== reference.reference_id) : [...(draft.reference_ids || []), reference.reference_id] })} /><span>{reference.filename}</span></label>)}<small>Chỉ gửi ảnh đã chọn. Đính kèm không có nghĩa đã kiểm tra thị giác.</small></fieldset>}
      <PolarisButton disabled={disabled || draft.groups.length >= 10} icon="plus" onClick={() => { const id = newKey(); onChange({ ...draft, active_group_id: id, groups: [...draft.groups, { id, instruction: '', slots: [] }] }); }}>Thêm nhóm ({draft.groups.length}/10)</PolarisButton>
      <p className="uw-help" role="status">{contentFeedbackError(draft, content) || 'Các nhóm sẵn sàng để gửi bằng nút bên dưới.'}</p>
    </section>}
  </div>;
}
