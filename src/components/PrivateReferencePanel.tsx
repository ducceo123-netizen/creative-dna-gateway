import { useEffect, useRef, useState } from 'react';
import { encodeLibraryNotes, inspectLibraryImage, LIBRARY_IMAGE_TYPES, MAX_LIBRARY_IMAGE_BYTES, parseLibraryPage, sanitizeLibraryNotes, type LibraryNotes, type LibraryRecord } from '../../supabase/functions/_shared/reference-library-contract.ts';
type Props = { request: (url: string, init?: RequestInit) => Promise<Response> };
type Pending = { id: string; file: File; bytes: ArrayBuffer; preview: string; sha256: string; status: string };
const blank: Omit<LibraryNotes, 'filename'> = { case_title: '', brand: '', material: '', caption: '', why_good: '' };
const hash = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
const message = (status: number) => status === 401 ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' : status === 403 ? 'Tài khoản chưa có quyền UID phù hợp.' : status === 413 ? 'Mỗi ảnh tối đa 5 MB.' : status === 409 ? 'Lần tải này đã có dữ liệu khác. Hãy chọn lại ảnh để tạo mục mới.' : 'Chưa xác minh được dữ liệu. Bạn có thể tải lại thư viện rồi thử lại.';

/** Existing signed-in session only. All previews are revocable in-memory object URLs. */
export function PrivateReferencePanel({ request }: Props) {
  const [references, setReferences] = useState<LibraryRecord[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [notes, setNotes] = useState(blank);
  const [canUpload, setCanUpload] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const urls = useRef(new Map<string, string>());
  const attemptedNotes = useRef(new Map<string, string>());
  const catalogGeneration = useRef(0);
  const mounted = useRef(true), running = useRef(false);
  const abort = useRef(new AbortController());
  const release = (id: string) => { const url = urls.current.get(id); if (url) URL.revokeObjectURL(url); urls.current.delete(id); };
  const keepPreview = (id: string, bytes: ArrayBuffer, mime: string) => { release(id); const url = URL.createObjectURL(new Blob([bytes], { type: mime })); urls.current.set(id, url); return url; };
  const loadCatalog = async (offset = 0) => {
    const generation = ++catalogGeneration.current, signal = abort.current.signal;
    const response = await request('/api/member/creative-references' + (offset ? '?offset=' + offset : ''), { signal }).catch(error => {
      if (!mounted.current || signal.aborted || generation !== catalogGeneration.current) return null;
      throw error;
    });
    if (!response || !mounted.current || signal.aborted || generation !== catalogGeneration.current) return;
    if (!response.ok) throw new Error(message(response.status));
    const body = await response.json().catch(error => {
      if (!mounted.current || signal.aborted || generation !== catalogGeneration.current) return null;
      throw error;
    });
    if (!mounted.current || signal.aborted || generation !== catalogGeneration.current) return;
    const page = parseLibraryPage(body);
    if (!mounted.current || signal.aborted || generation !== catalogGeneration.current) return;
    setReferences(previous => offset ? [...new Map([...previous, ...page.references].map(r => [r.id, r])).values()] : page.references);
    setCanUpload(page.can_upload); setNextOffset(page.next_offset); setLoaded(true);
  };
  useEffect(() => {
    mounted.current = true; const controller = new AbortController(); abort.current = controller;
    void loadCatalog().catch(error => { if (mounted.current && !controller.signal.aborted) setNotice(error.message); });
    return () => { mounted.current = false; controller.abort(); for (const url of urls.current.values()) URL.revokeObjectURL(url); urls.current.clear(); };
  }, []);
  const run = async (task: () => Promise<void>) => {
    if (running.current) return; running.current = true; setBusy(true); setNotice('');
    try { await task(); } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : 'Chưa hoàn tất thao tác.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const stage = (files: File[]) => run(async () => {
    if (!files.length) return;
    if (files.length > 10) throw new Error('Chọn tối đa 10 ảnh mỗi lần. Bạn có thể thêm các lần tiếp theo.');
    const prepared: Pending[] = [];
    try {
      for (const file of files) {
        if (!mounted.current) return;
        if (!LIBRARY_IMAGE_TYPES.includes(file.type as any) || !file.size || file.size > MAX_LIBRARY_IMAGE_BYTES) throw new Error('Chỉ nhận PNG, JPEG hoặc WebP, tối đa 5 MB mỗi ảnh.');
        const bytes = await file.arrayBuffer(); const dimensions = inspectLibraryImage(new Uint8Array(bytes), file.type);
        // Decode locally before any upload; a MIME label or a signature alone is not enough.
        const bitmap = await createImageBitmap(file);
        // Phone JPEGs may rotate by EXIF; transposition preserves both pixel and edge limits.
        const decodedMatches = (bitmap.width === dimensions.width && bitmap.height === dimensions.height) ||
          (file.type === 'image/jpeg' && bitmap.width === dimensions.height && bitmap.height === dimensions.width); bitmap.close();
        if (!decodedMatches) throw new Error('Kích thước ảnh giải mã không khớp dữ liệu. Hãy xuất lại ảnh.');
        const sha256 = await hash(bytes);
        if (prepared.some(item => item.sha256 === sha256)) throw new Error('Có ảnh trùng trong lần chọn này. Hãy giữ một bản.');
        if (!mounted.current) return;
        const id = crypto.randomUUID(), preview = keepPreview('pending:' + id, bytes, file.type);
        prepared.push({ id, file, bytes, preview, sha256, status: 'Sẵn sàng tải lên' });
      }
      pending.forEach(item => { release('pending:' + item.id); attemptedNotes.current.delete(item.id); });
      if (mounted.current) setPending(prepared);
    } catch (error) { prepared.forEach(item => release('pending:' + item.id)); throw error; }
  });
  const previewReference = async (record: LibraryRecord) => {
    const response = await request('/api/member/creative-references/' + encodeURIComponent(record.id), { signal: abort.current.signal });
    if (!response.ok) throw new Error(message(response.status));
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== record.byte_length || await hash(bytes) !== record.sha256) throw new Error('Ảnh trả về không khớp dữ liệu trong thư viện.');
    inspectLibraryImage(new Uint8Array(bytes), record.mime_type);
    if (!mounted.current) return;
    const preview = keepPreview(record.id, bytes, record.mime_type);
    setPreviews(previous => ({ ...previous, [record.id]: preview }));
  };
  const upload = () => run(async () => {
    if (!canUpload || !pending.length) return;
    const preparedNotes = new Map(pending.map(item => [item.id, attemptedNotes.current.get(item.id) || encodeLibraryNotes(sanitizeLibraryNotes({ ...notes, filename: item.file.name }))]));
    let saved = 0;
    for (const item of pending) {
      if (!mounted.current || abort.current.signal.aborted) return;
      attemptedNotes.current.set(item.id, preparedNotes.get(item.id)!);
      setPending(items => items.map(p => p.id === item.id ? { ...p, status: 'Đang tải lên và kiểm tra…' } : p));
      try {
        const response = await request('/api/admin/creative-references/' + encodeURIComponent(item.id), { method: 'POST', headers: { 'Content-Type': item.file.type, 'X-Reference-Metadata': preparedNotes.get(item.id)! }, body: item.bytes, signal: abort.current.signal });
        if (!response.ok) throw new Error(message(response.status));
        const receipt = await response.json();
        if (receipt.reference_id !== item.id || !['ALREADY_STORED', 'STORED_AND_VERIFIED'].includes(receipt.status)) throw new Error('Chưa xác minh được lần tải lên.');
        saved++;
        if (mounted.current) { setPending(items => items.filter(p => p.id !== item.id)); release('pending:' + item.id); attemptedNotes.current.delete(item.id); }
      } catch (error) {
        if (mounted.current) setPending(items => items.map(p => p.id === item.id ? { ...p, status: 'Chưa xác minh. Thử lại giữ nguyên ảnh, ghi chú và mã để tránh tạo bản trùng.' } : p));
        if (mounted.current && !abort.current.signal.aborted) await loadCatalog().catch(() => {});
        throw error;
      }
    }
    await loadCatalog();
    if (mounted.current) { setNotice('Đã lưu và xác minh ' + saved + ' ảnh trong thư viện riêng.'); setNotes(blank); }
  });
  const visible = references.filter(r => [r.case_title,r.brand,r.material,r.caption,r.why_good,r.filename].join(' ').toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const groups = new Map<string, LibraryRecord[]>();
  for (const record of visible) { const key = record.case_title || 'Chưa gắn tên case'; groups.set(key, [...(groups.get(key) || []), record]); }
  const inputClass = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
  return <section className="rounded-xl border bg-white p-5 space-y-5" aria-label="Private Reference Library">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-bold text-lg">Reference Library</h2><p className="text-sm text-slate-600 mt-1">Lưu ảnh những case có outcome tốt để tham khảo thêm khi cần.</p></div>
      <button className="px-3 py-2 border rounded-lg text-sm disabled:opacity-50" onClick={() => void run(() => loadCatalog())} disabled={busy}>Tải lại thư viện</button>
    </div>
    <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Không cần bộ ảnh cố định. Đây là nguồn cảm hứng phụ, không áp một style cho mọi brand và không thay thế quy tắc brand hoặc sự thật về sản phẩm. Chưa có ảnh vẫn tiếp tục được công việc.</p>
    {canUpload && <div className="rounded-lg border border-dashed p-4 space-y-3">
      <label className="block text-sm font-medium">Thêm ảnh case của bạn
        <input className="block mt-2 text-sm" aria-label="Reference images" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void stage(files); }}/>
      </label>
      <p className="text-xs text-slate-500">PNG, JPEG, WebP · tối đa 5 MB/ảnh · tối đa 10 ảnh/lần. Chỉ admin UID đang hoạt động được thêm ảnh.</p>
      {pending.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">Tên case (tuỳ chọn)<input className={inputClass} value={notes.case_title} maxLength={120} disabled={busy} placeholder="Ví dụ: Landing page quà tặng cho mẹ" onChange={e => setNotes(n => ({ ...n, case_title: e.target.value }))}/></label>
          <label className="text-xs font-medium">Brand (tuỳ chọn)<input className={inputClass} value={notes.brand} maxLength={80} disabled={busy} placeholder="Brand liên quan" onChange={e => setNotes(n => ({ ...n, brand: e.target.value }))}/></label>
          <label className="text-xs font-medium">Loại nội dung (tuỳ chọn)<input className={inputClass} value={notes.material} maxLength={80} disabled={busy} placeholder="Hero, ảnh sản phẩm, UGC…" onChange={e => setNotes(n => ({ ...n, material: e.target.value }))}/></label>
          <label className="text-xs font-medium">Chú thích (tuỳ chọn)<input className={inputClass} value={notes.caption} maxLength={160} disabled={busy} onChange={e => setNotes(n => ({ ...n, caption: e.target.value }))}/></label>
        </div>
        <label className="block text-xs font-medium">Điểm bạn thấy tốt (tuỳ chọn)<textarea className={inputClass} rows={2} value={notes.why_good} maxLength={500} disabled={busy} placeholder="Bố cục, ánh sáng, cảm xúc, cách làm nổi bật sản phẩm…" onChange={e => setNotes(n => ({ ...n, why_good: e.target.value }))}/></label>
        <p className="text-xs text-slate-500">Thông tin trên áp dụng cho các ảnh đang chọn. Bạn có thể dùng cùng tên case để thêm ảnh vào nhóm đó.</p>
        <div className="grid gap-3 sm:grid-cols-3">{pending.map(item => <div className="rounded-lg border p-2" key={item.id}><img className="h-28 w-full object-contain bg-slate-50" src={item.preview} alt={item.file.name}/><p className="text-xs break-all mt-2">{item.file.name}</p><p className="text-xs text-slate-500">{item.status}</p></div>)}</div>
        <div className="flex gap-2"><button className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => void upload()}>{busy ? 'Đang xử lý…' : 'Lưu vào thư viện'}</button><button className="border rounded-lg px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => { pending.forEach(item => { release('pending:' + item.id); attemptedNotes.current.delete(item.id); }); setPending([]); }}>Bỏ chọn</button></div>
      </>}
    </div>}
    {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
    {!loaded && !notice && <p className="text-sm text-slate-500">Đang tải thư viện riêng…</p>}
    {loaded && references.length === 0 && <div className="rounded-lg bg-slate-50 p-5 text-sm text-slate-600">Thư viện chưa có ảnh. {canUpload ? 'Thêm case đầu tiên khi bạn có mẫu muốn lưu.' : 'Admin có thể thêm case khi cần.'}</div>}
    {references.length > 0 && <label className="block text-xs font-medium">Tìm trong các ảnh đã tải<input className={inputClass} type="search" value={filter} placeholder="Case, brand, loại nội dung…" onChange={e => setFilter(e.target.value)}/></label>}
    {[...groups].map(([title, records]) => <div className="space-y-3" key={title}><h3 className="font-semibold text-sm">{title} <span className="font-normal text-slate-500">({records.length})</span></h3><div className="grid gap-3 md:grid-cols-2">{records.map(record => <article className="rounded-lg border p-3 space-y-2" key={record.id}>
      {previews[record.id] ? <img className="max-h-72 w-full object-contain bg-slate-50 rounded" src={previews[record.id]} alt={record.caption || record.filename}/> : <button className="w-full min-h-24 bg-slate-50 rounded text-sm disabled:opacity-50" disabled={busy} onClick={() => void run(() => previewReference(record))}>Xem ảnh riêng tư</button>}
      <h4 className="font-medium text-xs break-all">{record.filename}</h4>
      {(record.brand || record.material) && <p className="text-xs text-slate-500">{[record.brand,record.material].filter(Boolean).join(' · ')}</p>}
      {record.caption && <p className="text-sm">{record.caption}</p>}{record.why_good && <p className="text-xs text-slate-600">Điểm tốt: {record.why_good}</p>}
    </article>)}</div></div>)}
    {nextOffset !== null && <button className="border rounded-lg px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => void run(() => loadCatalog(nextOffset))}>Tải thêm ảnh</button>}
    <p className="text-xs text-slate-500">Chỉ member UID được xác thực và đang hoạt động mới đọc được ảnh. Tool MCP công khai chưa có phiên member nên chưa tự đọc ảnh trong thư viện; không được coi ảnh là đã xem khi chưa truy cập được.</p>
  </section>;
}
