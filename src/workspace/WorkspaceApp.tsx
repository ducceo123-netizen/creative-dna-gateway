import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronRight, Circle, Clock3, FileArchive, FileText, FolderOpen, Image, LayoutDashboard, Layers, LockKeyhole, Menu, MessageSquare, Monitor, MoreHorizontal, Plus, RefreshCw, Search, ShieldCheck, Smartphone, Sparkles, TriangleAlert, X } from 'lucide-react';
import { createWorkspaceApi, WorkspaceApiError, type WorkspaceApi } from './api';
import { mergeTaskPage, emptyFeedback, feedbackError, feedbackRequest, isStaleDraft, mergeEventPage, newKey, readableName, safeDownloadPath, sourceUrlError, stageIndex, stageLabels, stages, interruptionMessage } from './state';
import type { Brief, ContentFeedbackDraft, FeedbackDraft, Readiness, Review, WorkspaceEvent, WorkspaceTask } from './types';
import { browserDraftStorage, readUnsentDrafts, saveUnsentDrafts } from './drafts';
import { ReferenceUploads, uploadStagedReferences, type UploadItem } from './Uploads';
import { HistoryPanel } from './HistoryPanel';
import { ArtifactGallery } from './ArtifactGallery';
import { FeedbackPanel } from './FeedbackPanel';
import { Preview } from './Preview';
import { LoginDialog } from './LoginDialog';
import { ContentReview, buildContentFeedback, contentFeedbackError, createContentDraft } from './ContentReview';
import './workspace.css';
import { loadPolaris, PolarisButton } from './polaris';

const defaultApi = createWorkspaceApi();
const freshBrief = (): Brief => ({ brand: '', material: 'onepage', title: '', source_url: '', requirements: '' });
const formatDate = (value: string) => Number.isNaN(Date.parse(value)) ? '' : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const taskTitle = (task: WorkspaceTask) => task.brief.title || 'Onepage · ' + task.brief.brand;
function taskFromUrl(): string | null { return new URLSearchParams(window.location.search).get('task'); }
function useTaskRoute() {
  const [id, setId] = useState<string | null>(taskFromUrl);
  useEffect(() => { const listener = () => setId(taskFromUrl()); window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener); }, []);
  const navigate = (next: string | null) => {
    const url = new URL(window.location.href); next ? url.searchParams.set('task', next) : url.searchParams.delete('task');
    window.history.pushState(null, '', url); setId(next);
  };
  return [id, navigate] as const;
}

function ReadinessNotice({ readiness, authenticated, loading, onLogin }: { readiness: Readiness | null; authenticated: boolean; loading: boolean; onLogin: () => void }) {
  if (loading && !readiness) return <div className="uw-banner"><s-banner tone="info" heading="Đang kiểm tra kết nối workspace" /></div>;
  const blockers = readiness?.execution.blockers || [];
  if (authenticated && readiness?.execution.ready) return <div className="uw-banner"><s-banner tone="success" heading="Sẵn sàng thực thi">Các bước tự động tiếp tục sau brief và dừng ở những điểm cần duyệt.</s-banner></div>;
  return <div className="uw-banner"><s-banner tone="info" heading={!authenticated ? 'Workspace chưa có phiên đăng nhập' : readiness?.storage.configured ? 'Có thể lưu brief, chưa thể chạy AI' : 'Workspace chưa sẵn sàng lưu tác vụ'}>
    <p>{!readiness?.authentication_configured ? 'Đăng nhập workspace chưa được cấu hình. Chưa thể lưu tác vụ hay chạy AI.' : !authenticated ? readiness?.login_supported ? 'Đăng nhập bằng tài khoản UID để mở và lưu các tác vụ riêng của bạn. API dùng chung được quản lý ở máy chủ.' : 'Cần phiên đăng nhập UID hợp lệ để mở và lưu tác vụ. Đăng nhập chưa được cấu hình cho workspace này.' : 'Tác vụ sẽ chỉ bắt đầu khi hạ tầng và quyền thực thi đã được xác minh.'}</p>
    {!!blockers.length && <details className="uw-blocker-list"><summary>{blockers.length} điều kiện thực thi chưa sẵn sàng</summary><ul>{blockers.map((item, index) => <li key={item.code + index}>{item.message}</li>)}</ul></details>}
    {!authenticated && readiness?.login_supported && <div className="uw-login-entry"><PolarisButton onClick={onLogin}>Đăng nhập UID</PolarisButton></div>}
  </s-banner></div>;
}

function BriefForm({ value, onChange, readiness, authenticated, pending, uncertain, onSubmit, uploads, onUploads, draftSaved }: {
  uploads: UploadItem[]; onUploads: (items: UploadItem[]) => void; draftSaved: boolean; value: Brief; onChange: (brief: Brief) => void; readiness: Readiness | null; authenticated: boolean; pending: boolean; uncertain: boolean; onSubmit: () => void;
}) {
  const brands = readiness?.brands || [];
  const supported = readiness?.materials?.some(material => material.id === 'onepage' && material.creation_supported) ?? false;
  const sourceError = value.source_url ? sourceUrlError(value.source_url) : null;
  const allowed = authenticated && readiness?.storage.configured && supported && value.brand && value.source_url && !sourceError && !pending && !uncertain && uploads.every(item => item.status === 'staged');
  return <div className="uw-brief-page">
    <div className="uw-page-intro"><span className="uw-eyebrow">TỪ BRIEF ĐẾN BỘ MATERIAL</span><h2>Bắt đầu một ý tưởng mới.</h2><p>Một đầu vào, một tác vụ xuyên suốt. Research, content và material ở cùng một nơi.</p></div>
    <div className="uw-brief-grid"><div className="uw-brief-form"><s-section heading="Brief của bạn" subheading="Thông tin để bắt đầu đúng sản phẩm, đúng brand."><form onSubmit={event => { event.preventDefault(); if (allowed) onSubmit(); }}>
      <div className="uw-polaris-fields"><div className="uw-form-row">
        <s-select label="Brand" value={value.brand} disabled={pending || !brands.length} required onChange={event => onChange({ ...value, brand: event.currentTarget.value })}>
          <s-option value="">Chọn brand</s-option>{brands.map(brand => <s-option key={brand.id} value={brand.id}>{brand.label}</s-option>)}
        </s-select><s-select label="Material" value="onepage" disabled><s-option value="onepage">Onepage</s-option></s-select>
      </div>
      <s-url-field label="Đường dẫn sản phẩm / collection" required placeholder="https://…" value={value.source_url} maxLength={2000} disabled={pending}
        error={sourceError || undefined} details="Nguồn được kiểm tra khi tác vụ thực sự bắt đầu." onInput={event => onChange({ ...value, source_url: event.currentTarget.value })} />
      <s-text-field label="Tên tác vụ (tùy chọn)" placeholder="VD: Christmas · Personalized Blanket" value={value.title || ''} maxLength={160} disabled={pending}
        onInput={event => onChange({ ...value, title: event.currentTarget.value })} />
      <s-text-area label="Yêu cầu thêm (tùy chọn)" placeholder="Theme, thị trường, người nhận, điểm cần nhấn mạnh hoặc điều cần giữ nguyên…" rows={5} value={value.requirements || ''} maxLength={8000} disabled={pending}
        onInput={event => onChange({ ...value, requirements: event.currentTarget.value })} />
      <ReferenceUploads items={uploads} onChange={onUploads} ready={readiness?.uploads} disabled={pending || !authenticated} /></div>
      <div className="uw-form-footer"><span>{uncertain ? 'Cần đối soát lần gửi trước.' : draftSaved ? 'Bản nháp có thể khôi phục trên thiết bị này trong 7 ngày. Ảnh chưa tải chỉ giữ ở tab này.' : 'Bản nháp chỉ giữ trong tab này; chưa xác nhận lưu trên thiết bị.'}</span>
        <PolarisButton primary disabled={!allowed} loading={pending} type="submit">{readiness?.execution.ready ? 'Tạo và bắt đầu' : 'Lưu brief'}</PolarisButton></div>
    </form></s-section></div><aside className="uw-brief-guide"><div className="uw-guide-icon"><Layers size={23} /></div><h2>Tập trung vào kết quả.</h2><p>Không cần sao chép prompt hoặc bấm qua từng bước.</p>
      <ol><li><span>1</span><div><strong>Research & content</strong><p>Kiểm tra nguồn, chắt lọc giá trị và viết theo cấu trúc canonical.</p></div></li>
      <li><span>2</span><div><strong>Duyệt & tạo material</strong><p>Chốt đúng phiên bản content trước khi tạo ảnh.</p></div></li>
      <li><span>3</span><div><strong>Góp ý ngay trên preview</strong><p>Chọn ảnh, chữ hoặc section. Gửi nhiều nhóm chỉnh sửa một lần.</p></div></li>
      <li><span>4</span><div><strong>Kiểm tra & nhận file</strong><p>Chỉ tải khi có tệp thật và kiểm tra đóng gói đạt.</p></div></li></ol>
      <div className="uw-guide-foot"><ShieldCheck size={16} /><span>Template và quy tắc UID dùng chung với luồng ChatGPT.</span></div>
    </aside></div>
  </div>;
}

function FilesPanel({ task }: { task: WorkspaceTask }) {
  return <div className="uw-files"><ArtifactGallery task={task} /><div className="uw-section-heading"><h2>Tệp của tác vụ</h2><span>{task.artifacts.length} tệp</span></div>
    {!task.artifacts.length ? <div className="uw-empty"><FileArchive size={32} /><h3>Chưa có tệp được lưu</h3><p>Material và bộ ZIP sẽ xuất hiện tại đây khi máy chủ xác nhận có tệp thật.</p></div>
      : <ul>{task.artifacts.map(file => {
        const path = file.verification === 'verified' ? safeDownloadPath(file.download_url, task.task_id) : null;
        return <li key={file.artifact_id}><FileText size={22} /><div><strong>{file.filename}</strong><p>{file.media_type} · {Number.isFinite(file.size_bytes) ? (file.size_bytes / 1024).toFixed(1) + ' KB' : 'Chưa có kích thước'}{file.width && file.height ? ` · ${file.width} × ${file.height}` : ''}</p><small>Phiên bản {file.revision_id} · {file.verification === 'verified' ? 'Đã xác minh' : 'Chưa xác minh'}</small></div>
          {path ? <a className="uw-icon-button" href={path} download aria-label={`Tải ${file.filename}`}><ArrowDownToLine size={18} /></a> : <LockKeyhole size={16} aria-label="Chưa sẵn sàng tải" />}</li>;
      })}</ul>}
  </div>;
}

function Activity({ events }: { events: WorkspaceEvent[] }) {
  return <div className="uw-activity"><div className="uw-section-heading"><h2>Hoạt động</h2><span>Từ máy chủ</span></div>
    {!events.length ? <p className="uw-muted">Chưa có sự kiện được ghi nhận.</p> : <ol>{events.slice(-20).reverse().map(event => <li key={event.sequence}><span className="uw-event-dot" /><div><strong>{typeof event.data?.message === 'string' ? event.data.message : readableName(event.type)}</strong><time>{formatDate(event.created_at)}</time></div></li>)}</ol>}
  </div>;
}

export function WorkspaceShell({ api = defaultApi }: { api?: WorkspaceApi }) {
  const [selectedId, navigate] = useTaskRoute();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const ownerRef = useRef<string | null>(null);
  const sessionEpoch = useRef(0);
  const [draftSaved, setDraftSaved] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploads, setUploads] = useState<Record<string, UploadItem[]>>({});
  const [historicalReview, setHistoricalReview] = useState<Review | null>(null);
  const [comparison, setComparison] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [booting, setBooting] = useState(true);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [task, setTask] = useState<WorkspaceTask | null>(null);
  const [brief, setBrief] = useState<Brief>(freshBrief);
  const [review, setReview] = useState<Review | null>(null);
  const [events, setEvents] = useState<WorkspaceEvent[]>([]);
  const [contentDrafts, setContentDrafts] = useState<Record<string, ContentFeedbackDraft>>({});
  const [contentEditing, setContentEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, FeedbackDraft>>({});
  const [drawer, setDrawer] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [tab, setTab] = useState<'preview' | 'files' | 'activity'>('preview');
  const [viewport, setViewport] = useState<1280 | 390>(1280);
  const [selectionMode, setSelectionMode] = useState<'element' | 'section'>('element');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [pending, setPending] = useState(false);
  const [loadingTask, setLoadingTask] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mutationLock = useRef(false);
  const submittedAction = useRef<{ taskId: string; key: string } | null>(null);
  const eventCache = useRef<Record<string, { cursor: number; events: WorkspaceEvent[] }>>({});
  const knownVersions = useRef<Record<string, number>>({});
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const activeDraft = selectedId ? drafts[selectedId] : undefined;
  const updateDraft = (next: FeedbackDraft) => setDrafts(previous => ({ ...previous, [next.task_id]: next }));

  const clearPrivate = () => {
    sessionEpoch.current++; ownerRef.current = null; setOwnerId(null); setAuthenticated(false);
    eventCache.current = {}; knownVersions.current = {}; submittedAction.current = null;
    setTasks([]); setTask(null); setReview(null); setHistoricalReview(null); setEvents([]); setDrafts({}); setContentDrafts({});
    setBrief(freshBrief()); setUploads({}); setUncertain(false); setNextCursor(null); setDraftSaved(false); setDrawer(false); setContentEditing(false);
  };
  const verifyOwner = (responseOwner?: string) => { if (responseOwner && responseOwner !== ownerRef.current) { clearPrivate(); throw new Error('Phiên đăng nhập đã thay đổi. Tải lại workspace để tiếp tục.'); } };
  useEffect(() => {
    if (!ownerId || !authenticated) return;
    const storage = browserDraftStorage();
    setDraftSaved(!!storage && saveUnsentDrafts(storage, ownerId, { brief, visual: drafts, content: contentDrafts }));
  }, [ownerId, authenticated, brief, drafts, contentDrafts]);
  useEffect(() => { const visible = () => { if (document.visibilityState === 'visible') setRefresh(value => value + 1); }; document.addEventListener('visibilitychange', visible); return () => document.removeEventListener('visibilitychange', visible); }, []);


  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const boot = async () => {
      try {
        const config = await api.config(controller.signal); if (!alive) return; setReadiness(config);
        const session = await api.session(controller.signal).catch(error => {
          if (error instanceof WorkspaceApiError && [401, 503].includes(error.status)) return { authenticated: false };
          throw error;
        });
        if (!alive) return;
        const verifiedId = session.authenticated && 'user' in session && session.user?.id ? session.user.id : null;
        if (verifiedId !== ownerRef.current) {
          clearPrivate();
          if (verifiedId) {
            ownerRef.current = verifiedId; setOwnerId(verifiedId);
            const storage = browserDraftStorage(); const saved = storage ? readUnsentDrafts(storage, verifiedId) : null;
            if (saved) { setBrief(saved.brief); setDrafts(saved.visual); setContentDrafts(saved.content); }
          }
        }
        setAuthenticated(!!verifiedId);
        if (verifiedId) {
          const scopeEpoch = sessionEpoch.current; const response = await api.tasks(controller.signal); if (!alive || scopeEpoch !== sessionEpoch.current) return;
          verifyOwner(response.owner_id); setTasks(previous => mergeTaskPage(previous, response.tasks)); setNextCursor(response.next_cursor || null); setReadiness(response.readiness);
        } else { clearPrivate(); }
      } catch (failure) { if (alive) { if (failure instanceof WorkspaceApiError && [401, 403].includes(failure.status)) clearPrivate(); setError(failure instanceof Error ? failure.message : 'Không tải được workspace.'); } }
      finally { if (alive) setBooting(false); }
    };
    void boot(); return () => { alive = false; controller.abort(); };
  }, [api, refresh]);

  useEffect(() => {
    setTask(null); setReview(null); setEvents([]); setDrawer(false); setTab('preview'); setContentEditing(false); setHistoricalReview(null); setComparison(false); setError('');
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !authenticated) return;
    const epoch = sessionEpoch.current; const owner = ownerRef.current;
    const controller = new AbortController(); let alive = true; let timeout: ReturnType<typeof setTimeout>;
    const load = async (initial: boolean) => {
      if (initial) setLoadingTask(true);
      try {
        const session = await api.session(controller.signal);
        if (!alive || epoch !== sessionEpoch.current) return;
        if (!session.authenticated || session.user?.id !== owner) { clearPrivate(); setRefresh(value => value + 1); return; }
        const response = await api.task(selectedId, controller.signal);
        if (!alive || epoch !== sessionEpoch.current) return;
        verifyOwner(response.owner_id);
        if (response.task.state_version < (knownVersions.current[selectedId] ?? -1)) return;
        knownVersions.current[selectedId] = response.task.state_version;
        const prior = submittedAction.current;
        if (prior?.taskId === selectedId && !mutationLock.current) {
          const receipt = response.task.actions.find(action => action.idempotency_key === prior.key);
          if (receipt && receipt.status !== 'unknown') {
            submittedAction.current = null; setUncertain(false);
            setNotice('Đã đối soát lần gửi trước với máy chủ. Trạng thái tác vụ hiện tại được giữ, không gửi lại thao tác.');
          }
        }
        setTask(response.task); setReadiness(response.readiness);
        if (response.task.content) setContentDrafts(previous => previous[selectedId] ? previous : { ...previous, [selectedId]: createContentDraft(response.task.content!.revision) });
        setTasks(previous => [response.task, ...previous.filter(item => item.task_id !== selectedId)]);
        const readEvents = async () => {
          let current = eventCache.current[selectedId] || { cursor: 0, events: [] };
          for (let page = 0; page < 5; page++) {
            const response = await api.events(selectedId, current.cursor, controller.signal);
            if (!alive || epoch !== sessionEpoch.current) return current;
            const next = mergeEventPage(current, response);
            eventCache.current[selectedId] = next;
            if (!response.has_more || next.cursor <= current.cursor) return next;
            current = next;
          }
          return current;
        };
        const results = await Promise.allSettled([readEvents(), api.review(selectedId, controller.signal), api.recovery(selectedId, controller.signal)]);
        if (!alive || epoch !== sessionEpoch.current || response.task.state_version < (knownVersions.current[selectedId] ?? -1)) return;
        if (results[2].status === 'fulfilled') { const recovery = results[2].value; setTask(previous => previous?.task_id === selectedId && previous.state_version === response.task.state_version ? { ...previous, recovery } : previous); }
        if (results[0].status === 'fulfilled') setEvents(results[0].value.events);
        if (results[1].status === 'fulfilled') {
          const next = results[1].value;
          if (next.manifest.task_id !== selectedId || next.manifest.content_revision !== response.task.snapshot.content_revision || (response.task.review_manifest && next.manifest.index_id !== response.task.review_manifest.index_id)) {
            setReview(null); setError('Preview chưa khớp phiên bản tác vụ. Tải lại trạng thái trước khi góp ý.');
          } else {
            setReview(previous => previous?.manifest.index_id === next.manifest.index_id && previous.channel_nonce === next.channel_nonce ? previous : next);
            setDrafts(previous => previous[selectedId] ? previous : { ...previous, [selectedId]: emptyFeedback(next.manifest) });
          }
        } else { setReview(null); }
      } catch (failure) {
        if (alive && epoch === sessionEpoch.current) {
          setError(failure instanceof Error ? failure.message : 'Không tải được tác vụ.');
          if (failure instanceof WorkspaceApiError && [401, 403].includes(failure.status)) { clearPrivate(); }
        }
      } finally { if (alive) { setLoadingTask(false); timeout = setTimeout(() => void load(false), 8000); } }
    };
    void load(true); return () => { alive = false; controller.abort(); clearTimeout(timeout); };
  }, [api, selectedId, authenticated, ownerId, refresh]);

  const applyResult = (next: WorkspaceTask) => {
    verifyOwner(next.owner_id);
    knownVersions.current[next.task_id] = Math.max(knownVersions.current[next.task_id] ?? -1, next.state_version);
    setTasks(previous => [next, ...previous.filter(item => item.task_id !== next.task_id)]);
    if (selectedRef.current === next.task_id) setTask(next);
  };
  const runMutation = async (operation: () => Promise<void>, trustedReconciliation = false) => {
    if (mutationLock.current || (uncertain && !trustedReconciliation)) return;
    const epoch = sessionEpoch.current;
    mutationLock.current = true; setPending(true); setError(''); setNotice('');
    try { await operation(); }
    catch (failure) {
      if (epoch !== sessionEpoch.current) return;
      setError(failure instanceof Error ? failure.message : 'Thao tác chưa hoàn tất.');
      if (failure instanceof WorkspaceApiError && failure.code === 'outcome_unknown') setUncertain(true);
      if (failure instanceof WorkspaceApiError && failure.status === 409) { setNotice('Bản nháp góp ý được giữ nguyên. Kiểm tra phiên bản mới trước khi gửi.'); setRefresh(value => value + 1); }
      if (failure instanceof WorkspaceApiError && [401, 403].includes(failure.status)) { clearPrivate(); }
    } finally { mutationLock.current = false; setPending(false); }
  };
  const createTask = () => void runMutation(async () => {
    submittedAction.current = null; const epoch = sessionEpoch.current;
    const staged = uploads.new || [];
    const response = await api.create({ ...brief, title: brief.title?.trim() || undefined, requirements: brief.requirements?.trim() || undefined }, newKey());
    if (epoch !== sessionEpoch.current) return; verifyOwner(response.owner_id);
    applyResult(response.task); setReadiness(response.readiness); navigate(response.task.task_id); setBrief(freshBrief());
    setUploads(previous => ({ ...previous, new: [], [response.task.task_id]: staged }));
    let readyTask = response.task;
    if (staged.length) readyTask = await uploadStagedReferences(api, readyTask, staged, (id, patch) => { if (epoch === sessionEpoch.current) updateUpload(response.task.task_id, id, patch); }, () => epoch === sessionEpoch.current);
    if (epoch !== sessionEpoch.current) return;
    applyResult(readyTask);
    if (response.readiness.execution.ready) {
      // Creation is durable first; the single user intent may then request real execution, never a fake stage transition.
      const key = newKey(); submittedAction.current = { taskId: response.task.task_id, key };
      const started = await api.action(readyTask, 'start', key); if (epoch !== sessionEpoch.current) return; verifyOwner(started.owner_id); submittedAction.current = null; applyResult(started.task);
      setNotice('Máy chủ đã nhận yêu cầu bắt đầu. Hoạt động sẽ hiển thị khi thực sự được ghi nhận.');
    } else setNotice('Đã lưu brief. Chưa bắt đầu chạy AI vì điều kiện thực thi chưa sẵn sàng.');
    setRefresh(value => value + 1);
  });
  const performAction = (type: string) => {
    if (!task || (historicalReview && ['approve_artwork', 'feedback'].includes(type))) return;
    const epoch = sessionEpoch.current; const current = task;
    const submitted = activeDraft;
    void runMutation(async () => {
      const contentFeedback = type === 'content_feedback' && current.content && contentDrafts[current.task_id] ? await buildContentFeedback(contentDrafts[current.task_id], current.content) : undefined;
      const key = newKey(); submittedAction.current = { taskId: current.task_id, key };
      const response = await api.action(current, type, key, type === 'feedback' && submitted ? feedbackRequest(submitted) : undefined, contentFeedback);
      if (epoch !== sessionEpoch.current) return; verifyOwner(response.owner_id);
      submittedAction.current = null; applyResult(response.task); setReadiness(response.readiness);
      setNotice('Máy chủ đã nhận thao tác. Đây là xác nhận tiếp nhận, chưa phải kết quả hoàn tất.');
      if (type === 'feedback') { setDrawer(false); setDrafts(previous => { const next = { ...previous }; delete next[current.task_id]; return next; }); }
      if (type === 'content_feedback') { setContentEditing(false); setContentDrafts(previous => { const next = { ...previous }; delete next[current.task_id]; return next; }); }
      setRefresh(value => value + 1);
    });
  };
  const logout = async () => {
    if (pending) return;
    setPending(true);
    try {
      await api.logout(); clearPrivate(); setNotice('Đã đăng xuất khỏi workspace.');
    } catch { setError('Chưa xác nhận được đăng xuất. Kiểm tra kết nối và thử lại.'); }
    finally { setPending(false); }
  };
  const updateUpload = (taskId: string, id: string, changes: Partial<UploadItem>) => setUploads(previous => ({ ...previous, [taskId]: (previous[taskId] || []).map(item => item.id === id ? { ...item, ...changes } : item) }));
  const uploadToTask = () => { if (!task) return; const current = task; const epoch = sessionEpoch.current; void runMutation(async () => {
    const next = await uploadStagedReferences(api, current, uploads[current.task_id] || [], (id, patch) => { if (epoch === sessionEpoch.current) updateUpload(current.task_id, id, patch); }, () => epoch === sessionEpoch.current);
    if (epoch !== sessionEpoch.current) return; applyResult(next); setRefresh(value => value + 1);
  }); };
  const reconcileUpload = async (item: UploadItem) => {
    if (!task) return; const current = task; const epoch = sessionEpoch.current;
    try { const result = item.upload_id ? await api.uploadStatus(current.task_id, item.upload_id) : await api.resolveUpload(current.task_id, item.id); if (epoch !== sessionEpoch.current) return;
      if (result.upload.status === 'linked') { updateUpload(current.task_id, item.id, { status: 'linked', reference_id: result.upload.reference_id, error: undefined }); if (!submittedAction.current) setUncertain(false); setRefresh(value => value + 1); }
      else if (result.upload.status === 'reserved' && !item.upload_id) { updateUpload(current.task_id, item.id, { status: 'staged', upload_id: result.upload.upload_id, error: undefined }); if (!submittedAction.current) setUncertain(false); setNotice('Đã tìm lại đúng lần đăng ký ảnh. Có thể tiếp tục tải, chưa gửi tệp trước đó.'); }
      else if (['rejected', 'cleaned'].includes(result.upload.status)) { updateUpload(current.task_id, item.id, { status: 'failed', error: 'Máy chủ xác nhận lần tải này không được đính kèm. Có thể chuẩn bị thử lại.' }); if (!submittedAction.current) setUncertain(false); }
      else setNotice('Máy chủ chưa xác nhận kết quả lần tải. Chưa gửi lại ảnh.');
    } catch (failure) { if (epoch === sessionEpoch.current) setError(failure instanceof Error ? failure.message : 'Chưa đối soát được ảnh.'); }
  };
  const removeReference = (referenceId: string) => { if (!task) return; const current = task; const epoch = sessionEpoch.current;
    void runMutation(async () => { await api.removeReference(current, referenceId); if (epoch !== sessionEpoch.current) return;
      setUploads(previous => ({ ...previous, [current.task_id]: (previous[current.task_id] || []).filter(item => item.reference_id !== referenceId) }));
      const response = await api.task(current.task_id); if (epoch !== sessionEpoch.current) return; verifyOwner(response.owner_id); applyResult(response.task);
      setDrafts(previous => { const d = previous[current.task_id]; return d ? { ...previous, [current.task_id]: { ...d, groups: d.groups.map(g => ({ ...g, reference_ids: g.reference_ids?.filter(id => id !== referenceId) })) } } : previous; });
      setContentDrafts(previous => { const d = previous[current.task_id]; return d ? { ...previous, [current.task_id]: { ...d, reference_ids: d.reference_ids?.filter(id => id !== referenceId) } } : previous; });
    });
  };
  const loadMore = async () => { if (!nextCursor || loadingMore) return; const cursor = nextCursor; const epoch = sessionEpoch.current; setLoadingMore(true);
    try { const response = await api.tasks(undefined, cursor); if (epoch !== sessionEpoch.current) return; verifyOwner(response.owner_id); setTasks(previous => mergeTaskPage(previous, response.tasks)); setNextCursor(response.next_cursor && response.next_cursor !== cursor ? response.next_cursor : null); }
    catch (failure) { if (epoch === sessionEpoch.current) setError(failure instanceof Error ? failure.message : 'Chưa tải được trang tiếp theo.'); }
    finally { setLoadingMore(false); }
  };
  const recoverTask = () => { if (!task?.recovery?.can_reconcile || !task.recovery.run_id) return; const current = task; const runId = task.recovery.run_id; const epoch = sessionEpoch.current;
    // Reconciliation is a server-authorized evidence lookup, never a browser retry of a provider call.
    void runMutation(async () => { const response = await api.reconcile(current, runId, newKey()); if (epoch !== sessionEpoch.current) return; verifyOwner(response.owner_id); applyResult(response.task); setRefresh(value => value + 1); }, true);
  };
  const visibleTasks = useMemo(() => tasks.filter(item => {
    const match = `${taskTitle(item)} ${item.brief.brand}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
    return match && (filter === 'all' || (filter === 'review' ? ['content_review', 'review'].includes(item.stage) : filter === 'running' ? ['research', 'content_authoring', 'assets', 'packaging'].includes(item.stage) : ['blocked', 'failed', 'unknown'].includes(item.stage)));
  }), [tasks, search, filter]);
  const validFeedback = !!(activeDraft && review && !feedbackError(activeDraft, review.manifest));
  const contentDraft = selectedId ? contentDrafts[selectedId] : undefined;
  const validContentFeedback = !!(contentDraft && task?.content && !contentFeedbackError(contentDraft, task.content));
  const actionType = historicalReview ? null : contentEditing ? 'content_feedback' : drawer ? 'feedback' : task?.stage === 'draft' ? 'start' : task?.stage === 'content_review' && !!task.content ? 'approve_content' : task?.stage === 'review' && !!review ? 'approve_artwork' : null;
  const actionLabel = actionType === 'feedback' || actionType === 'content_feedback' ? 'Áp dụng góp ý' : actionType === 'start' ? 'Bắt đầu tác vụ' : actionType === 'approve_artwork' ? 'Duyệt material & đóng gói' : 'Duyệt content & tạo material';
  const hasOpenAction = task?.actions.some(action => ['queued', 'running', 'unknown'].includes(action.status)) ?? false;
  const canAct = !!(task && authenticated && readiness?.execution.ready && !pending && !uncertain && !historicalReview && !(uploads[task.task_id] || []).some(item => item.status !== 'linked') && !task.pending_feedback && !hasOpenAction && actionType && (actionType !== 'feedback' || validFeedback) && (actionType !== 'content_feedback' || validContentFeedback));
  const selectedTargets = activeDraft?.groups.find(group => group.id === activeDraft.active_group_id)?.element_ids || [];
  const selectTarget = useCallback((id: string, width: number) => {
    if (!selectedId || !review || historicalReview || pending) return;
    setDrawer(true);
    setDrafts(previous => {
      const draft = previous[selectedId] || emptyFeedback(review.manifest);
      if (isStaleDraft(draft, review.manifest)) return previous;
      return { ...previous, [selectedId]: { ...draft, groups: draft.groups.map(group => group.id !== draft.active_group_id ? group : {
        ...group, viewport_width: width, element_ids: group.element_ids.includes(id) ? group.element_ids.filter(item => item !== id) : [...group.element_ids, id],
      }) } };
    });
  }, [selectedId, review, historicalReview, pending]);

  return <div className={`uw-app ${sidebar ? 'uw-nav-open' : ''} ${sidebarCompact ? 'uw-nav-collapsed' : ''} ${drawer && review ? 'uw-drawer-open' : ''}`}>
    {readiness?.login_supported && <LoginDialog open={loginOpen} api={api} onClose={() => setLoginOpen(false)} onSuccess={() => { setRefresh(value => value + 1); setNotice('Đã đăng nhập UID. Đang tải tác vụ của bạn.'); }} />}
    <a className="uw-skip" href="#uw-main">Đến nội dung chính</a>
    {sidebar && <button className="uw-nav-scrim" aria-label="Đóng danh sách tác vụ" onClick={() => setSidebar(false)} />}
    <aside className="uw-sidebar" aria-label="Danh sách tác vụ">
      <div className="uw-brand-row"><a className="uw-brand" href="/workspace" onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(null); setSidebar(false); } }}><span className="uw-brand-mark">U<span>•</span></span><div><strong>UID Brands</strong><small>CREATIVE WORKSPACE</small></div></a><button className="uw-icon-button uw-collapse" aria-label={sidebarCompact ? 'Mở rộng thanh tác vụ' : 'Thu gọn thanh tác vụ'} onClick={() => { if (window.matchMedia('(max-width: 900px)').matches) setSidebar(false); else setSidebarCompact(value => !value); }}><Menu size={17} /></button></div>
      <label className="uw-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm tác vụ…" aria-label="Tìm tác vụ" /></label>
      <PolarisButton className="uw-new-task" icon="plus" onClick={() => { navigate(null); setSidebar(false); }}>Tác vụ mới</PolarisButton>
      <div className="uw-nav-label">WORKSPACE <span>{tasks.length}</span></div>
      <div className="uw-task-filter"><select aria-label="Lọc trạng thái tác vụ" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="running">Đang thực hiện</option><option value="review">Cần review</option><option value="blocked">Cần xử lý</option></select></div>
      <nav className="uw-task-list">{visibleTasks.map(item => <button key={item.task_id} className={`uw-task-item ${selectedId === item.task_id ? 'is-active' : ''}`}
        title={taskTitle(item)} aria-current={selectedId === item.task_id ? 'page' : undefined} onClick={() => { navigate(item.task_id); setSidebar(false); }}><span className="uw-task-icon"><Layers size={17} /></span><div><strong>{taskTitle(item)}</strong><span>{item.brief.brand} · {stageLabels[item.stage]}</span></div></button>)}
        {!visibleTasks.length && <div className="uw-nav-empty"><FolderOpen size={23} /><p>{!authenticated ? 'Đăng nhập để mở các tác vụ của bạn.' : search ? 'Không có tác vụ phù hợp.' : 'Tác vụ đã lưu sẽ ở đây.'}</p></div>}{nextCursor && <div className="uw-load-more"><PolarisButton disabled={loadingMore} loading={loadingMore} onClick={() => void loadMore()}>Tải thêm tác vụ</PolarisButton><small>Tìm kiếm và bộ lọc áp dụng cho {tasks.length} tác vụ đã tải.</small></div>}</nav>
      <div className="uw-sidebar-bottom"><a href="/"><ArrowLeft size={15} />Luồng ChatGPT hiện tại</a><div><span className={`uw-connection-dot ${authenticated ? 'is-connected' : ''}`} /><span>{authenticated ? 'Phiên đăng nhập đã xác minh' : 'Chưa đăng nhập workspace'}</span></div>{authenticated && <button className="uw-text-button uw-logout" disabled={pending} onClick={() => void logout()}>Đăng xuất</button>}</div>
    </aside>
    <div className="uw-shell"><header className="uw-topbar"><div className="uw-breadcrumb"><button className="uw-icon-button uw-mobile-menu" aria-label="Mở danh sách tác vụ" onClick={() => setSidebar(true)}><Menu size={19} /></button><LayoutDashboard size={16} /><span>Workspace</span><ChevronRight size={14} /><strong>{task ? taskTitle(task) : selectedId ? 'Tác vụ' : 'Tác vụ mới'}</strong></div>
      <PolarisButton className="uw-refresh" disabled={booting || pending || loadingTask} icon="refresh" onClick={() => { setError(''); setRefresh(value => value + 1); }}>Tải trạng thái</PolarisButton></header>
      <main id="uw-main" className="uw-main"><s-page heading={task ? taskTitle(task) : selectedId ? 'Tác vụ' : 'Tác vụ mới'} inlineSize="large"><ReadinessNotice readiness={readiness} authenticated={authenticated} loading={booting} onLogin={() => setLoginOpen(true)} />
        {error && <div className="uw-notice uw-error" role="alert"><TriangleAlert size={18} /><div>{error}{uncertain && <p>Lần gửi có thể đã được tiếp nhận. Các thao tác mới tạm khóa; hãy kiểm tra hoạt động của tác vụ.</p>}</div></div>}
        {notice && <div className="uw-notice uw-info" role="status"><Check size={17} /><div>{notice}</div><button className="uw-icon-button" aria-label="Ẩn thông báo" onClick={() => setNotice('')}><X size={15} /></button></div>}
        {!selectedId ? <BriefForm value={brief} onChange={setBrief} readiness={readiness} authenticated={authenticated} pending={pending} uncertain={uncertain} onSubmit={createTask} uploads={uploads.new || []} onUploads={items => setUploads(previous => ({ ...previous, new: items }))} draftSaved={draftSaved} />
          : !task ? <div className="uw-card uw-empty uw-task-loading"><FolderOpen size={32} /><h2>{booting || loadingTask ? 'Đang tải tác vụ…' : !authenticated ? 'Cần đăng nhập để mở tác vụ' : 'Chưa mở được tác vụ'}</h2><p>{!authenticated ? 'Không có dữ liệu riêng tư nào được tải khi chưa xác minh phiên đăng nhập.' : 'Tải lại trạng thái để kiểm tra quyền truy cập và kết nối.'}</p></div>
          : <>
          <section className="uw-task-heading"><div><div className="uw-task-meta"><span>{task.brief.brand}</span><span>Onepage</span></div><p>Cập nhật {formatDate(task.updated_at)}</p></div><span className={`uw-status uw-status-${task.stage}`}><span />{stageLabels[task.stage]}</span></section>
          <ol className="uw-stepper" aria-label="Tiến độ tác vụ">{stages.map((label, index) => <li key={label} className={index === stageIndex(task.stage) ? 'is-current' : index < stageIndex(task.stage) ? 'is-done' : ''} aria-current={index === stageIndex(task.stage) ? 'step' : undefined}><span>{index < stageIndex(task.stage) ? <Check size={12} /> : index + 1}</span>{label}</li>)}</ol>
          {task.interruption && <div className="uw-banner"><s-banner tone="warning" heading={task.stage === 'unknown' ? 'Cần đối soát trước khi tiếp tục' : 'Tác vụ chưa thể tiếp tục'}><p>{interruptionMessage(task.interruption.reason, task.stage === 'unknown')}</p>{/^[A-Z][A-Z0-9_]{0,99}$/.test(task.interruption.reason) && <details><summary>Mã kiểm tra</summary><span>{task.interruption.reason}</span></details>}</s-banner></div>}
          {['draft', 'content_review', 'review', 'completed'].includes(task.stage) && !historicalReview && <ReferenceUploads purpose={task.stage === 'draft' ? 'brief' : 'feedback'} taskId={task.task_id} items={(uploads[task.task_id] || []).filter(item => item.status !== 'linked' || !(task.references || []).some(reference => reference.reference_id === item.reference_id))} references={(task.references || []).filter(reference => !reference.removed_at)} ready={readiness?.uploads} disabled={pending || !!task.pending_feedback || hasOpenAction} onChange={items => setUploads(previous => ({ ...previous, [task.task_id]: [...(previous[task.task_id] || []).filter(item => item.status === 'linked' && (task.references || []).some(reference => reference.reference_id === item.reference_id)), ...items] }))} onUpload={uploadToTask} onReconcile={reconcileUpload} onRemoveReference={removeReference} />}
          {task.recovery && task.recovery.status !== 'not_required' && <div className="uw-recovery"><s-banner tone="info" heading="Đối soát tác vụ"><p>{task.recovery.message}</p>{task.recovery.can_reconcile && task.recovery.run_id && <PolarisButton disabled={pending} onClick={recoverTask}>Đối soát với nhà cung cấp</PolarisButton>}</s-banner></div>}
          <div className="uw-work-area"><section className="uw-outcome"><div className="uw-result-tabs" role="tablist" aria-label="Nội dung tác vụ">
            {([['preview', 'Kết quả', Monitor], ['files', 'Tệp', FolderOpen], ['activity', 'Hoạt động', Clock3]] as const).map(([id, label, Icon]) => <button role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}{id === 'files' && <span>{task.artifacts.length}</span>}</button>)}</div>
            {tab === 'files' ? <FilesPanel task={task} /> : tab === 'activity' ? <Activity events={events} /> : <>
              {!review && task.content && contentDraft ? <ContentReview content={task.content} draft={contentDraft} onChange={draft => setContentDrafts(previous => ({ ...previous, [task.task_id]: draft }))} references={(task.references || []).filter(reference => reference.purpose === 'feedback' && !reference.removed_at && reference.content_revision === task.snapshot.content_revision)} disabled={pending} editing={contentEditing} onEdit={() => setContentEditing(true)} /> : review ? <><HistoryPanel api={api} task={task} selected={historicalReview} onSelect={setHistoricalReview} comparison={comparison} onComparison={setComparison} disabled={pending} /><div className="uw-preview-toolbar"><div className="uw-segmented" aria-label="Kích thước preview"><button aria-pressed={viewport === 1280} onClick={() => setViewport(1280)} title="Desktop 1280px"><Monitor size={15} /><span>Desktop</span></button><button aria-pressed={viewport === 390} onClick={() => setViewport(390)} title="Mobile 390px"><Smartphone size={15} /><span>Mobile</span></button></div><span className="uw-viewport-label">{viewport}px</span><select className="uw-zoom-select" aria-label="Thu phóng preview" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select><div className="uw-segmented uw-selection-mode" aria-label="Chế độ chọn"><button aria-pressed={selectionMode === 'element'} onClick={() => setSelectionMode('element')}>Ảnh / chữ</button><button aria-pressed={selectionMode === 'section'} onClick={() => setSelectionMode('section')}>Section</button></div></div>
                {historicalReview && comparison ? <div className="uw-comparison"><section><h3>Trước · {historicalReview.manifest.content_revision}</h3><Preview review={historicalReview} width={viewport} zoom={zoom} mode={selectionMode} selected={[]} onSelect={() => {}} readOnly /></section><section><h3>Hiện tại · {review.manifest.content_revision}</h3><Preview review={review} width={viewport} zoom={zoom} mode={selectionMode} selected={[]} onSelect={() => {}} readOnly /></section></div> : <Preview review={historicalReview || review} width={viewport} zoom={zoom} mode={selectionMode} selected={historicalReview ? [] : selectedTargets} onSelect={selectTarget} readOnly={!!historicalReview} />}
                <div className="uw-preview-caption"><ShieldCheck size={14} /><span>{historicalReview ? 'Bản lịch sử' : 'Bản hiện tại'} · {(historicalReview || review).manifest.content_revision} · {historicalReview ? 'Chỉ đọc' : `${selectedTargets.length} đối tượng đang chọn`} · Chưa thay thế đánh giá thị giác và EO.</span></div></>
                : <div className="uw-empty uw-outcome-empty"><div className="uw-empty-visual"><Layers size={28} /><span><FileText size={15} /></span></div><span className="uw-eyebrow">{task.stage === 'draft' ? 'BRIEF ĐÃ LƯU' : stageLabels[task.stage].toLocaleUpperCase()}</span><h2>{task.stage === 'draft' ? 'Sẵn sàng từ một brief rõ ràng.' : 'Chưa có preview được xác minh'}</h2><p>{task.stage === 'draft' ? 'Khi điều kiện thực thi sẵn sàng, tác vụ sẽ tự chạy research và viết content để bạn duyệt.' : 'Kết quả sẽ xuất hiện khi máy chủ lưu được bản render đúng phiên bản. Không hiển thị kết quả mẫu.'}</p><div className="uw-brief-summary"><strong>{task.brief.source_url}</strong>{task.brief.requirements && <p>{task.brief.requirements}</p>}</div></div>}
              {!!task.quality.length && <div className="uw-quality"><h3>Kiểm tra chất lượng</h3>{task.quality.map((check, index) => <div key={index}><ShieldCheck size={16} /><span>{check.name}</span><strong>{check.status}</strong>{check.detail && <p>{check.detail}</p>}</div>)}</div>}
              <div className="uw-action-bar"><div><strong>{historicalReview ? 'Bản lịch sử chỉ đọc' : drawer || contentEditing ? 'Áp dụng đúng nhóm đang chọn' : task.stage === 'content_review' ? 'Duyệt bản content hiện tại' : task.stage === 'review' ? 'Xác nhận chất lượng thị giác của bản hiện tại' : task.stage === 'draft' ? 'Tự động tiếp tục từ brief' : 'Tiến độ theo trạng thái máy chủ'}</strong><p>{task.pending_feedback || hasOpenAction ? 'Máy chủ đang giữ yêu cầu. Chưa thể gửi thêm cho đến khi đối soát xong.' : !readiness?.execution.ready ? 'Chưa thể thực thi. Xem điều kiện cần hoàn tất ở phía trên.' : drawer ? `${activeDraft?.groups.length || 0} nhóm góp ý · chỉ sửa đối tượng đã chọn` : 'Chỉ xác nhận những kết quả đã thực sự hoàn tất.'}</p></div>
                <div className="uw-action-buttons">{task.content && !review && !contentEditing && <PolarisButton onClick={() => setContentEditing(true)} icon="chat">Góp ý content</PolarisButton>}{contentEditing && <PolarisButton onClick={() => setContentEditing(false)}>Về duyệt content</PolarisButton>}{review && !historicalReview && !drawer && <PolarisButton onClick={() => setDrawer(true)} icon="chat">Góp ý</PolarisButton>}
                {actionType && <PolarisButton primary disabled={!canAct} loading={pending} onClick={() => performAction(actionType)}>{actionLabel}</PolarisButton>}</div></div>
            </>}
          </section>
          {review && !historicalReview && activeDraft && <div className={drawer ? 'uw-drawer-container' : 'uw-drawer-container is-hidden'}><FeedbackPanel references={(task.references || []).filter(reference => reference.purpose === 'feedback' && !reference.removed_at && reference.content_revision === task.snapshot.content_revision && reference.review_index_id === review.manifest.index_id)} draft={activeDraft} manifest={review.manifest} disabled={pending} onChange={updateDraft} onClose={() => setDrawer(false)} /></div>}
          </div>
          <div className="uw-task-footnote"><span><LockKeyhole size={13} />Tác vụ riêng tư · Phiên bản {task.state_version}</span><details><summary><MoreHorizontal size={17} /><span className="uw-sr-only">Tùy chọn tác vụ</span></summary><button disabled={pending || uncertain || ['cancelled', 'completed'].includes(task.stage)} onClick={() => performAction('cancel')}>Hủy tác vụ này</button></details></div>
        </>}
      </s-page></main><footer className="uw-footer"><span>UID Brands Workspace</span><span>Luồng ChatGPT hiện tại không thay đổi.</span></footer>
    </div>
  </div>;
}


export default function WorkspaceApp({ api = defaultApi }: { api?: WorkspaceApi }) {
  const [library, setLibrary] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => { let alive = true; loadPolaris().then(() => { if (alive) setLibrary('ready'); }, () => { if (alive) setLibrary('failed'); }); return () => { alive = false; }; }, []);
  if (library !== 'ready') return <div className="uw-app uw-library-state"><div className="uw-card uw-empty"><Layers size={30} /><h1>UID Brands Workspace</h1><p>{library === 'loading' ? 'Đang tải giao diện Polaris…' : 'Chưa tải được thư viện giao diện Shopify Polaris. Kiểm tra kết nối rồi tải lại. Không có thao tác tác vụ nào được gửi.'}</p>{library === 'failed' && <button className="uw-button" onClick={() => window.location.reload()}>Tải lại giao diện</button>}<a href="/">Về luồng ChatGPT hiện tại</a></div></div>;
  return <WorkspaceShell api={api} />;
}
