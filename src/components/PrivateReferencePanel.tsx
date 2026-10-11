import { useEffect, useRef, useState } from 'react';
import { parsePrivateReferenceManifest, type PrivateReferenceUiRecord } from '../../uid-private-reference-manifest.ts';

type Props = { request: (url: string, init?: RequestInit) => Promise<Response> };
type State = { status: string; preview?: string };
const hash = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
const message = (status: number) => status === 401 ? 'Cần đăng nhập lại.' : status === 403 ? 'Tài khoản chưa có quyền UID phù hợp.' : 'Ảnh chưa sẵn sàng trong kho riêng.';

/** Uses the existing signed-in session; no credentials or image bytes are embedded in source. */
export function PrivateReferencePanel({ request }: Props) {
  const [references, setReferences] = useState<PrivateReferenceUiRecord[]>([]);
  const [states, setStates] = useState<Record<string, State>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const urls = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const running = useRef(false);
  const abort = useRef(new AbortController());
  useEffect(() => { mounted.current = true; abort.current = new AbortController(); void loadCatalog().catch(() => { if (mounted.current) setNotice('Chưa tải được danh sách mẫu riêng. Hãy kiểm tra phiên đăng nhập.'); }); return () => { mounted.current = false; abort.current.abort(); for (const url of urls.current.values()) URL.revokeObjectURL(url); urls.current.clear(); }; }, []);
  const update = (id: string, value: State) => { if (mounted.current) setStates(s => ({ ...s, [id]: value })); };
  const loadCatalog = async () => {
    const response = await request('/api/member/creative-references', { signal: abort.current.signal });
    if (!response.ok) throw new Error(message(response.status));
    const catalog = parsePrivateReferenceManifest(await response.json());
    if (mounted.current) setReferences(catalog);
    return catalog;
  };
  const verify = async (reference: PrivateReferenceUiRecord) => {
    if (!mounted.current || abort.current.signal.aborted) return;
    update(reference.id, { status: 'Đang kiểm tra quyền và dữ liệu…' });
    const response = await request('/api/member/creative-references/' + encodeURIComponent(reference.id), { signal: abort.current.signal });
    if (!response.ok) { update(reference.id, { status: message(response.status) }); return; }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== reference.byte_length || await hash(bytes) !== reference.sha256) throw new Error('Dữ liệu không khớp ảnh mẫu đã duyệt.');
    const old = urls.current.get(reference.id); if (old) URL.revokeObjectURL(old);
    if (!mounted.current) return;
    const preview = URL.createObjectURL(new Blob([bytes], { type: reference.mime_type })); urls.current.set(reference.id, preview);
    update(reference.id, { status: 'Đọc riêng tư thành công · SHA-256 khớp', preview });
  };
  const checkAll = async () => {
    if (running.current) return; running.current = true;
    setBusy(true); setNotice('');
    try { const catalog = await loadCatalog(); for (const reference of catalog) { if (!mounted.current) break; await verify(reference); } }
    catch { if (mounted.current) setNotice('Chưa xác minh được đủ ảnh. Hãy kiểm tra phiên đăng nhập và thử lại.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const uploadSelected = async (files: File[]) => {
    if (running.current || !files.length) return; running.current = true;
    setBusy(true); setNotice('');
    try {
      // Validate the entire selection first, before transmitting even one item.
      const prepared: { reference: PrivateReferenceUiRecord; bytes: ArrayBuffer }[] = [];
      for (const file of files) {
        if (!mounted.current) return;
        const reference = references.find(r => r.filename === file.name);
        if (!reference || file.size !== reference.byte_length) throw new Error('Chỉ nhận đúng các file mẫu trong danh sách đã duyệt.');
        const bytes = await file.arrayBuffer();
        if (await hash(bytes) !== reference.sha256) throw new Error('File không khớp SHA-256 của mẫu đã duyệt: ' + reference.filename);
        if (prepared.some(p => p.reference.id === reference.id)) throw new Error('Không chọn cùng một ảnh hai lần.');
        prepared.push({ reference, bytes });
      }
      for (const { reference, bytes } of prepared) {
        if (!mounted.current || abort.current.signal.aborted) return;
        update(reference.id, { status: 'Đang lưu vào kho riêng…' });
        const response = await request('/api/admin/creative-references/' + encodeURIComponent(reference.id), { method: 'POST', headers: { 'Content-Type': reference.mime_type }, body: bytes, signal: abort.current.signal });
        if (!response.ok) throw new Error(response.status === 403 ? 'Chỉ admin UID đang hoạt động được lưu ảnh mẫu.' : 'Chưa xác minh được lần lưu. Bấm kiểm tra quyền đọc trước khi thử lại.');
        await verify(reference);
      }
      if (mounted.current) setNotice('Đã xử lý các file được chọn; trạng thái từng ảnh ở bên dưới.');
    } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : 'Không thể lưu ảnh mẫu.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="rounded-xl border bg-white p-5 space-y-4" aria-label="Private UID reference images">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold text-lg">Ảnh mẫu riêng của UID</h2><p className="text-xs text-slate-600">Chỉ member UID được xác thực và đang hoạt động mới đọc được.</p></div>
      <button className="px-3 py-2 border rounded-lg text-sm disabled:opacity-50" onClick={checkAll} disabled={busy}>Kiểm tra quyền đọc ảnh</button>
    </div>
    <label className="block text-sm font-medium">Lưu đúng các file đã duyệt (admin)
      <input className="block mt-2 text-xs" aria-label="Approved reference files" type="file" accept="image/webp,image/png" multiple disabled={busy || !references.length} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void uploadSelected(files); }}/>
    </label>
    {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
    <div className="grid gap-3 md:grid-cols-2">
      {references.map(reference => <article className="rounded-lg border p-3 space-y-2" key={reference.id}>
        <h3 className="font-medium text-xs break-all">{reference.filename}</h3>
        <p className="text-xs text-slate-600">{states[reference.id]?.status || 'Chưa kiểm tra trong phiên này.'}</p>
        {states[reference.id]?.preview && <img className="max-h-64 w-full object-contain bg-slate-50 rounded" src={states[reference.id].preview} alt={'Private approved reference: ' + reference.filename}/>}
      </article>)}
    </div>
    <p className="text-xs text-slate-500">Đối chiếu dữ liệu không thay thế kiểm tra hình ảnh. MCP công khai hiện chưa mang phiên member, nên bước tạo ảnh vẫn phải chờ quyền đọc và kiểm tra mẫu trên tài khoản đang tạo.</p>
  </section>;
}
