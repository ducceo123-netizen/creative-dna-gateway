import { useEffect, useRef, useState } from 'react';
import { FileImage, LockKeyhole, Upload, X } from 'lucide-react';
import { PolarisButton } from './polaris';
import type { PrivateReference, Readiness, UploadReceipt, WorkspaceTask } from './types';
import type { WorkspaceApi } from './api';
import { WorkspaceApiError } from './api';
import { newKey } from './state';
export type UploadItem = { id: string; file: File; role: 'product' | 'style' | 'brand' | 'other'; purpose?: 'brief' | 'feedback'; status: 'staged' | 'uploading' | 'linked' | 'failed' | 'unknown'; upload_id?: string; reference_id?: string; error?: string };
export function uploadFileError(file: Pick<File, 'size' | 'type'>, maxBytes = 8 * 1024 * 1024): string | null {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'Chỉ nhận PNG, JPEG hoặc WebP.';
  if (!file.size || file.size > maxBytes) return `Ảnh phải lớn hơn 0 và không quá ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`;
  return null;
}
export function uploadFilename(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 180).replace(/\.+$/, '').replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i, 'reference-$1').slice(0, 180).replace(/\.+$/, '') || 'reference-image';
}
export function safeReferencePath(taskId: string, referenceId: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(referenceId) || !/^[A-Za-z0-9_-]{1,200}$/.test(taskId)) return null;
  return `/api/workspace/tasks/${encodeURIComponent(taskId)}/references/${encodeURIComponent(referenceId)}`;
}
function LocalThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url ? <img src={url} alt="Ảnh bạn vừa chọn, chưa được kiểm tra nội dung" /> : <FileImage size={22} />;
}
const statusLabel: Record<UploadItem['status'], string> = { staged: 'Đang chờ tải', uploading: 'Đang tải riêng tư…', linked: 'Đã đính kèm · chưa kiểm tra thị giác', failed: 'Chưa tải được', unknown: 'Cần đối soát, chưa gửi lại' };
export function ReferenceUploads({ items, references = [], taskId, ready, disabled, onChange, onUpload, onReconcile, onRemoveReference, purpose = 'brief' }: {
  purpose?: 'brief' | 'feedback'; onRemoveReference?: (referenceId: string) => void; items: UploadItem[]; references?: PrivateReference[]; taskId?: string; ready: Readiness['uploads']; disabled: boolean;
  onChange: (items: UploadItem[]) => void; onUpload?: () => void; onReconcile?: (item: UploadItem) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const enabled = ready?.configured === true && !disabled;
  const add = (files: File[]) => {
    if (!enabled) return;
    if (items.length + references.length + files.length > 10) { setError('Mỗi brief nhận tối đa 10 ảnh tham chiếu.'); return; }
    const invalid = files.map(file => uploadFileError(file, ready?.max_bytes)).find(Boolean);
    if (invalid) { setError(invalid); return; }
    setError(''); onChange([...items, ...files.map(file => ({ id: newKey(), file, role: 'product' as const, purpose, status: 'staged' as const }))]);
  };
  return <section className="uw-reference-upload" aria-label="Ảnh tham chiếu riêng tư">
    <div className={`uw-upload-zone ${enabled ? '' : 'is-disabled'}`} tabIndex={enabled ? 0 : -1} role="group" aria-label="Thả ảnh hoặc dán ảnh tham chiếu tại đây"
      onDragOver={event => { if (enabled) event.preventDefault(); }} onDrop={event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); }}
      onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); add(files); } }}>
      <Upload size={22} /><strong>{purpose === 'feedback' ? 'Ảnh tham chiếu cho góp ý' : 'Ảnh tham chiếu'}</strong><p>{ready?.configured ? 'Thả, dán ảnh hoặc chọn tệp. PNG, JPEG, WebP · tối đa 8 MB/ảnh.' : 'Upload riêng tư chưa được cấu hình. Chưa nhận tệp ở bước này.'}</p>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!enabled} className="uw-sr-only" tabIndex={-1} onChange={event => { add(Array.from(event.currentTarget.files || [])); event.currentTarget.value = ''; }} />
      <PolarisButton disabled={!enabled} onClick={() => input.current?.click()}>Chọn ảnh</PolarisButton>
      <small><LockKeyhole size={12} />Chỉ tải vào tác vụ riêng của bạn. Đính kèm không có nghĩa là ảnh đã được kiểm tra thị giác.</small>
    </div>
    {error && <p className="uw-danger-text" role="alert">{error}</p>}
    {!!items.length && <ul className="uw-upload-items">{items.map(item => <li key={item.id}><div className="uw-upload-thumb"><LocalThumbnail file={item.file} /></div><div className="uw-upload-description"><strong>{item.file.name}</strong><small>{statusLabel[item.status]} · {(item.file.size / 1024).toFixed(0)} KB</small>
      <s-select label="Vai trò tham chiếu" value={item.role} disabled={disabled || !['staged', 'failed'].includes(item.status)} onChange={event => onChange(items.map(x => x.id === item.id ? { ...x, role: event.currentTarget.value as UploadItem['role'] } : x))}><s-option value="product">Sản phẩm</s-option><s-option value="style">Phong cách</s-option><s-option value="brand">Brand</s-option><s-option value="other">Khác</s-option></s-select>
      {item.error && <small className="uw-danger-text" role="status">{item.error}</small>}
      {item.status === 'failed' && <button type="button" className="uw-text-button" disabled={disabled} onClick={() => onChange(items.map(x => x.id === item.id ? { ...x, id: newKey(), status: 'staged', upload_id: undefined, error: undefined } : x))}>Chuẩn bị thử lại</button>}
      {item.status === 'unknown' && onReconcile && <button type="button" className="uw-text-button" disabled={disabled} onClick={() => onReconcile(item)}>Kiểm tra lần tải trước</button>}</div>
      {['staged', 'failed'].includes(item.status) && <button type="button" className="uw-icon-button" disabled={disabled} aria-label={`Bỏ ${item.file.name}`} onClick={() => onChange(items.filter(x => x.id !== item.id))}><X size={16} /></button>}
    </li>)}</ul>}
    {!!references.length && <ul className="uw-upload-items">{references.map(reference => { const path = taskId ? safeReferencePath(taskId, reference.reference_id) : null; return <li key={reference.reference_id}><div className="uw-upload-thumb">{path ? <img src={path} alt={reference.filename} loading="lazy" /> : <FileImage size={23} />}</div><div className="uw-upload-description"><strong>{reference.filename}</strong><small>Đã đính kèm · {reference.width} × {reference.height} · chưa kiểm tra thị giác</small></div>{path && <a href={path} download className="uw-text-button">Tải ảnh</a>}{onRemoveReference && <button type="button" className="uw-icon-button" disabled={disabled} aria-label={`Bỏ tham chiếu ${reference.filename}`} onClick={() => onRemoveReference(reference.reference_id)}><X size={16} /></button>}</li>; })}</ul>}
    {onUpload && items.some(item => item.status === 'staged') && <div className="uw-upload-action"><PolarisButton disabled={!enabled} onClick={onUpload}>Tải ảnh vào brief</PolarisButton></div>}
  </section>;
}
/** No retries after a lost PUT response. Reconcile only through the server's immutable upload status. */
export async function uploadStagedReferences(api: WorkspaceApi, task: WorkspaceTask, items: UploadItem[], update: (id: string, changes: Partial<UploadItem>) => void, isCurrent: () => boolean = () => true): Promise<WorkspaceTask> {
  let current = task;
  for (const item of items) {
    if (item.status === 'linked') continue;
    if (item.status !== 'staged' || !isCurrent()) throw new Error('Hoàn tất đối soát ảnh tham chiếu trước khi bắt đầu tác vụ.');
    update(item.id, { status: 'uploading', error: undefined });
    let upload: UploadReceipt | undefined;
    try {
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await item.file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
      if (!isCurrent()) throw new Error('Phiên đăng nhập đã thay đổi.');
      upload = (await api.prepareUpload(task.task_id, { idempotency_key: item.id, expected_state_version: current.state_version, content_revision: current.snapshot.content_revision, filename: uploadFilename(item.file.name), media_type: item.file.type, size_bytes: item.file.size, sha256, role: item.role, purpose: item.purpose || 'brief', ...(item.purpose === 'feedback' && current.review_manifest ? { review_index_id: current.review_manifest.index_id } : {}) })).upload;
      if (!isCurrent()) throw new Error('Phiên đăng nhập đã thay đổi.');
      update(item.id, { upload_id: upload.upload_id });
      if (!isCurrent()) throw new Error('Phiên đăng nhập đã thay đổi.');
      if (upload.status === 'reserved' || upload.status === 'prepared' || upload.status === 'created') upload = (await api.putUpload(task.task_id, upload.upload_id, item.file)).upload;
      if (!isCurrent()) throw new Error('Phiên đăng nhập đã thay đổi.');
      if (upload.status !== 'linked') { update(item.id, { status: upload.status === 'failed' || upload.status === 'rejected' ? 'failed' : 'unknown', error: upload.message || 'Máy chủ chưa xác nhận đính kèm. Không tự gửi lại.' }); throw new Error('Ảnh tham chiếu chưa được xác nhận. Tác vụ chưa bắt đầu.'); }
      update(item.id, { status: 'linked', reference_id: upload.reference_id });
      current = (await api.task(task.task_id)).task;
      if (current.task_id !== task.task_id) throw new Error('Máy chủ trả về sai tác vụ.');
    } catch (error) {
      const unknown = error instanceof WorkspaceApiError && error.code === 'outcome_unknown';
      if (!upload || upload.status === 'reserved' || upload.status === 'prepared' || upload.status === 'created') update(item.id, { status: unknown ? 'unknown' : 'failed', error: error instanceof Error ? error.message : 'Chưa tải được ảnh.' });
      throw error;
    }
  }
  return current;
}
