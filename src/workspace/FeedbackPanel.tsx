import { Plus, Trash2, X, MousePointer2, Layers, AlertTriangle } from 'lucide-react';
import type { FeedbackDraft, WorkspaceReviewManifest, PrivateReference } from './types';
import { feedbackError, isStaleDraft, newKey, readableName, rebaseDraft } from './state';

export function FeedbackPanel({ draft, manifest, disabled, onChange, onClose, references = [] }: {
  references?: PrivateReference[]; draft: FeedbackDraft; manifest: WorkspaceReviewManifest; disabled: boolean;
  onChange: (draft: FeedbackDraft) => void; onClose: () => void;
}) {
  const stale = isStaleDraft(draft, manifest);
  const error = feedbackError(draft, manifest);
  const patch = (id: string, changes: Partial<FeedbackDraft['groups'][number]>) =>
    onChange({ ...draft, groups: draft.groups.map(group => group.id === id ? { ...group, ...changes } : group) });
  const active = draft.groups.find(group => group.id === draft.active_group_id) || draft.groups[0];
  return <aside className="uw-feedback" aria-label="Góp ý theo đối tượng">
    <div className="uw-panel-heading"><div><span className="uw-eyebrow">CHỈNH SỬA ĐÚNG PHẠM VI</span><h2>Góp ý</h2></div>
      <button className="uw-icon-button" onClick={onClose} aria-label="Đóng góp ý"><X size={18} /></button></div>
    <p className="uw-muted">Chọn ảnh, chữ hoặc section trong preview. Mỗi nhóm có một yêu cầu riêng.</p>
    {stale && <div className="uw-notice uw-warning" role="status"><AlertTriangle size={17} /><div>
      <strong>Preview đã thay đổi</strong><p>Nội dung góp ý vẫn được giữ. Chọn lại đối tượng trên phiên bản mới để tránh sửa nhầm.</p>
      <button className="uw-text-button" disabled={disabled} onClick={() => onChange(rebaseDraft(draft, manifest))}>Giữ lời góp ý, chọn lại phạm vi</button>
    </div></div>}
    <div className="uw-feedback-groups">
      {draft.groups.map((group, index) => <section className={`uw-feedback-group ${group.id === active?.id ? 'is-active' : ''}`} key={group.id}>
        <div className="uw-group-heading"><button className="uw-group-select" disabled={disabled} aria-pressed={group.id === active?.id}
          onClick={() => onChange({ ...draft, active_group_id: group.id })}><span>{index + 1}</span>Nhóm {index + 1}<small>{group.element_ids.length} đã chọn</small></button>
          {draft.groups.length > 1 && <button className="uw-icon-button" disabled={disabled} aria-label={`Xóa nhóm ${index + 1}`} onClick={() => {
            const groups = draft.groups.filter(item => item.id !== group.id);
            onChange({ ...draft, groups, active_group_id: draft.active_group_id === group.id ? groups[0].id : draft.active_group_id });
          }}><Trash2 size={14} /></button>}</div>
        <div className="uw-target-chips">
          {group.element_ids.map(id => {
            const target = manifest.elements.find(element => element.id === id);
            const label = target ? readableName(target.kind === 'section' ? target.id : target.slot) : 'Đối tượng phiên bản cũ';
            return <button key={id} title={label} disabled={disabled} onClick={() => patch(group.id, { element_ids: group.element_ids.filter(item => item !== id) })}>
              {target?.kind === 'section' ? <Layers size={12} /> : <MousePointer2 size={12} />}<span>{label}</span><X size={12} /></button>;
          })}
          {!group.element_ids.length && <span className="uw-empty-target">Chưa chọn đối tượng</span>}
        </div>
        {!!references.length && <fieldset className="uw-reference-picker"><legend>Ảnh tham chiếu cho nhóm này</legend>{references.map(reference => <label key={reference.reference_id}><input type="checkbox" disabled={disabled || stale} checked={group.reference_ids?.includes(reference.reference_id) || false} onChange={() => patch(group.id, { reference_ids: group.reference_ids?.includes(reference.reference_id) ? group.reference_ids.filter(id => id !== reference.reference_id) : [...(group.reference_ids || []), reference.reference_id] })} /><span>{reference.filename}</span></label>)}<small>Chỉ gửi ảnh bạn chọn. Đây là tham chiếu, chưa được kiểm tra thị giác.</small></fieldset>}
        <label className="uw-sr-only" htmlFor={`instruction-${group.id}`}>Yêu cầu nhóm {index + 1}</label>
        <textarea id={`instruction-${group.id}`} maxLength={4000} disabled={disabled} value={group.instruction}
          placeholder="Muốn thay đổi điều gì ở các đối tượng này?" rows={4}
          onFocus={() => { if (draft.active_group_id !== group.id) onChange({ ...draft, active_group_id: group.id }); }}
          onChange={event => patch(group.id, { instruction: event.target.value })} />
      </section>)}
    </div>
    <button className="uw-button uw-add-group" disabled={disabled || draft.groups.length >= 10} onClick={() => {
      const id = newKey(); onChange({ ...draft, active_group_id: id, groups: [...draft.groups, { id, instruction: '', element_ids: [], viewport_width: 1280 }] });
    }}><Plus size={15} />Thêm nhóm góp ý <span>{draft.groups.length}/10</span></button>
    <details className="uw-target-list"><summary>Chọn từ danh sách đối tượng</summary>
      {manifest.elements.map(element => <label key={element.id}>
        <input type="checkbox" disabled={disabled || stale || !active} checked={active?.element_ids.includes(element.id) || false}
          onChange={() => active && patch(active.id, { element_ids: active.element_ids.includes(element.id)
            ? active.element_ids.filter(id => id !== element.id) : [...active.element_ids, element.id] })} />
        <span>{readableName(element.kind === 'section' ? element.id : element.slot)}</span><small>{element.kind === 'section' ? 'Section' : element.kind === 'image' ? 'Ảnh' : 'Chữ'}</small>
      </label>)}
    </details>
    <p className="uw-help">Các nhóm được gửi cùng lúc bằng nút bên dưới kết quả. Không thay đổi rule của brand.</p>
    {error && <p className="uw-help" role="status">{error}</p>}
  </aside>;
}
