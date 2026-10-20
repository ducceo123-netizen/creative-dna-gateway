import { boundedFetch, reviewLockKey, getReviewLock, setReviewLock, clearReviewLock } from "../request-recovery";
import { feedbackStatuses, sourceBrand, feedbackTitle, materialKey, materialLabel, filterFeedback, groupFeedback, feedbackDate } from "./feedback-inbox";
import { RuleReviewHandoff } from "./RuleReviewHandoff";
import { GovernancePanel } from "./GovernancePanel";
import { FeedbackReviewPanel, ResolvedFeedbackAudit, type FeedbackReviewPath } from "./FeedbackReviewPanel";
import type { FeedbackProposal as Proposal } from "./feedback-review";
import { PrivateReferencePanel } from "./PrivateReferencePanel";
import { assessProposal } from "../knowledge-governance";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Clock3, Eye, ImagePlus, LogIn, LogOut, RefreshCw, ShieldCheck, Sparkles, XCircle, X, Search, ChevronRight, SlidersHorizontal, Layers3, Paperclip } from "lucide-react";


export function AdminFeedback({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState(() => sessionStorage.getItem("creative_dna_admin_token") || "");
  const [refreshToken, setRefreshToken] = useState(() => sessionStorage.getItem("creative_dna_admin_refresh_token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const authSession=useRef(new AbortController());
  const signingIn=useRef(false);
  useEffect(()=>{if(authSession.current.signal.aborted)authSession.current=new AbortController();return()=>authSession.current.abort();},[]);
  const [authLoading, setAuthLoading] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [queueError, setQueueError] = useState("");
  const queueRequest = useRef<AbortController | null>(null);
  const [advancedLoaded, setAdvancedLoaded] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [activeAction, setActiveAction] = useState<{ id:string; type:"reject" } | null>(null);
  const [message, setMessage] = useState("");
  const [detailNotice, setDetailNotice] = useState<{id:string;message:string} | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string,string>>({});
  const [reviewing, setReviewing] = useState<{id:string;path:FeedbackReviewPath}|null>(null);
  const actionBusy = useRef(false);
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [filter, setFilter] = useState("pending");
  const [brandFilter, setBrandFilter] = useState("all");
  const [materialFilter, setMaterialFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedBrands, setCollapsedBrands] = useState<Record<string, boolean>>({});
  const [referencesLoaded, setReferencesLoaded] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [busyProposal, setBusyProposal] = useState<Proposal | null>(null);
  const reviewBusyRef = useRef(false);
  const drawerRef = useRef<HTMLDialogElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [expanded, setExpanded] = useState<Record<string,boolean>>({});
  const [adminEmail, setAdminEmail] = useState("");
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  const filtered = useMemo(() => filterFeedback(proposals, { status: filter, brand: brandFilter, material: materialFilter, search }), [proposals, filter, brandFilter, materialFilter, search]);
  const groups = useMemo(() => groupFeedback(filtered), [filtered]);
  const brands = useMemo(() => groupFeedback(proposals), [proposals]);
  const materials = useMemo(() => [...new Map(proposals.map(p => [materialKey(p), materialLabel(p)])).entries()].sort((a,b) => a[1].localeCompare(b[1])), [proposals]);
  const selected = busyProposal?.id === selectedId ? busyProposal : proposals.find(p => p.id === selectedId);
  const rejectedCount = proposals.filter(p => p.status === "rejected").length;
  const changeReviewBusy = (busy:boolean) => {
    reviewBusyRef.current = busy; setReviewBusy(busy);
    // Polls may update the inbox, but must not remount an in-flight guarded mutation.
    setBusyProposal(busy ? selected || null : null);
  };
  const closeDrawer = () => {
    changeReviewBusy(false);
    setReviewing(null); setSelectedId(null);
  };
  const openFeedback = (id:string, opener?:HTMLButtonElement) => {
    if (actionBusy.current || reviewBusyRef.current) return;
    if (opener) openerRef.current = opener;
    setReviewing(null); setSelectedId(id);
  };
  useEffect(() => {
    const dialog = drawerRef.current;
    if (!selectedId || !token || !dialog) return;
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; openerRef.current?.focus(); };
  }, [selectedId, token]);

  const parseTrainingSpec = (raw = "") => {
    const marker = "--- AI INTERPRETED TRAINING SPEC ---";
    const idx = raw.indexOf(marker);
    if (idx < 0) return { memberFeedback: raw.trim(), spec: null as null | Record<string,string|string[]> };
    const memberFeedback = raw.slice(0, idx).trim();
    const block = raw.slice(idx + marker.length).trim();
    const lines = block.split("\n");
    const spec: Record<string,string|string[]> = {};
    let current = "";
    for (const line of lines) {
      const m = line.match(/^([A-Za-z _]+):\s*(.*)$/);
      if (m) { current = m[1].trim().toLowerCase().replaceAll(" ","_"); spec[current] = m[2].trim(); }
      else if (current && line.trim()) spec[current] = String(spec[current] || "") + " " + line.trim();
    }
    if (typeof spec.reject_conditions === "string") spec.reject_conditions = String(spec.reject_conditions).split(/\s*[;•]\s*/).filter(Boolean);
    return { memberFeedback, spec };
  };

  const previewImages = (p:Proposal) => (p.context_images || []).filter(x => x.image_url);
  const outcomeImages = (p:Proposal) => previewImages(p).filter(x => x.role === "OUTPUT_BEING_REVIEWED");
  const referenceImages = (p:Proposal) => previewImages(p).filter(x => x.role !== "OUTPUT_BEING_REVIEWED");

  const legacyOverviewVi = (p:Proposal) => {
    if (p.id === "43e89303-c790-4ee5-abe9-3c6fcb80682d") return {
      summary: "Case Gardening LDP / Plants & Pets / Niche Product Combo theo style Studio Soft Shadow, tỉ lệ 1:1. Tumbler 20oz bị dựng quá cao và quá ốm vì assistant tự suy đoán kích thước thay vì bám silhouette thật của SKU trên PDP.",
      why_it_matters: "User đã reject trực tiếp vì hình dáng tumbler sai thực tế. Lỗi gốc là biến capacity 20oz thành dimension cụ thể và generic slim silhouette dù PDP không hề xác nhận.",
      proposed_change: "Không tự suy đoán height/width từ capacity. Khi thiếu dimension, phải bám shape, taper, lid, base và tỷ lệ height-to-width từ product reference thực tế."
    };
    if (p.id === "11bfba25-7092-4b2e-ad3d-32626ff03068") return {
      summary: "Đây là proposal CORRECTION cho wisdom về word count của 4 Occasion cards. Bản trước đếm sai và kết luận nhầm một số body không đạt brief 8–10 từ.",
      why_it_matters: "Nếu giữ số đếm sai, database sẽ học một lỗi QA. Sau khi recount đúng, cả 4 Occasion bodies đều nằm trong brief 8–10 từ.",
      proposed_change: "Supersede numerical claim cũ. Giữ wisdom tổng quát: luôn recount thực tế và kiểm tra đúng slot/constraint trước khi kết luận vi phạm word limit."
    };
    if (p.id === "aeca3d6e-9079-404b-a47e-e1c98d0f613e") return {
      summary: "Case follow-up cho Squishy Dumpling Advent Calendar / PawfectHouse Onepage. Bản copy mới rõ hơn về experience arc, WYL, Occasion và Good To Know nhưng vẫn còn claim cần verify.",
      why_it_matters: "Case cho thấy copy có thể tốt hơn về specificity và section differentiation nhưng vẫn dễ trượt sang unverified construction, recipient narrowing, personalization assumption hoặc word-count QA sai.",
      proposed_change: "Giữ flow product truth → distinct section roles → experience continuity → occasion fit → Good To Know. Mọi claim về construction, personalization, care, recipient và word count phải verify riêng."
    };
    return null;
  };

  const login = async () => {
    if(signingIn.current)return;
    if (!email.trim() || !password) return setMessage("Enter your admin email and password.");
    signingIn.current=true;const session=authSession.current;
    setAuthLoading(true); setMessage("");
    try {
      const res = await boundedFetch("/api/admin/login", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ email:email.trim(), password }),signal:session.signal });
      const data = await res.json();
      if(session.signal.aborted||authSession.current!==session)return;
      if (!res.ok || !data.access_token) throw new Error(data.error || "Unable to sign in");
      sessionStorage.setItem("creative_dna_admin_token", data.access_token);
      if (data.refresh_token) sessionStorage.setItem("creative_dna_admin_refresh_token", data.refresh_token);
      setToken(data.access_token);
      if (data.refresh_token) setRefreshToken(data.refresh_token);
      setPassword("");
      // The authenticated-session effect loads the queue and team once.
    } catch(e:any) { if(!session.signal.aborted)setMessage(e.message); } finally { signingIn.current=false;if(!session.signal.aborted)setAuthLoading(false); }
  };

  const logout = () => {
    authSession.current.abort();authSession.current=new AbortController();
    queueRequest.current?.abort();
    queueRequest.current = null;
    setQueueLoading(false);
    setQueueLoaded(false);
    setQueueError("");
    setAdvancedLoaded(false);
    setReferencesLoaded(false);
    setSelectedId(null);
    setDetailNotice(null);
    changeReviewBusy(false);
    setActionErrors({});
    setReviewing(null);
    sessionStorage.removeItem("creative_dna_admin_token");
    sessionStorage.removeItem("creative_dna_admin_refresh_token");
    setToken("");
    setRefreshToken("");
    setProposals([]);
    setTeamMembers([]);
    setMessage("Signed out.");
  };

  const refreshSession = async (signal: AbortSignal | null = authSession.current.signal) => {
    const currentRefresh = sessionStorage.getItem("creative_dna_admin_refresh_token");
    if (!currentRefresh || signal?.aborted) return "";
    const res = await boundedFetch("/api/admin/refresh", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ refresh_token:currentRefresh }), signal:signal || undefined
    });
    const data = await res.json();
    // A completed refresh must never restore a session after logout/unmount or another session change.
    if (signal?.aborted || sessionStorage.getItem("creative_dna_admin_refresh_token") !== currentRefresh) return "";
    if (!res.ok || !data.access_token) {
      logout();
      setMessage(data.error || "Phiên admin đã hết hạn. Vui lòng đăng nhập lại.");
      return "";
    }
    sessionStorage.setItem("creative_dna_admin_token", data.access_token);
    if (data.refresh_token) sessionStorage.setItem("creative_dna_admin_refresh_token", data.refresh_token);
    setToken(data.access_token);
    if (data.refresh_token) setRefreshToken(data.refresh_token);
    return data.access_token as string;
  };

  const authFetch = async (url:string, init:RequestInit = {}, explicitToken?:string) => {
    init={...init,signal:init.signal||authSession.current.signal};
    let access = explicitToken || sessionStorage.getItem("creative_dna_admin_token") || token;
    const run = (t:string) => boundedFetch(url, {
      ...init,
      headers:{ ...(init.headers || {}), Authorization:`Bearer ${t}` }
    });
    let res = await run(access);
    if (res.status === 401 && !init.signal?.aborted) {
      const fresh = await refreshSession(init.signal);
      if (fresh && !init.signal?.aborted) res = await run(fresh);
    }
    return res;
  };

  const loadTeam = async (authToken = sessionStorage.getItem("creative_dna_admin_token") || token) => {
    if (!authToken.trim()) return;
    const session=authSession.current;
    setTeamLoading(true);
    try {
      const res = await authFetch("/api/admin/team", {}, authToken.trim());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load admin team");
      if(!session.signal.aborted)setTeamMembers(data.members || []);
    } catch (e:any) { if(!session.signal.aborted)setMessage(e.message); }
    finally { if(!session.signal.aborted)setTeamLoading(false); }
  };

  const grantAdmin = async () => {
    if (!adminEmail.trim()) return setMessage("Enter an email address.");
    setTeamLoading(true); setMessage("");
    try {
      const res = await authFetch("/api/admin/team/grant", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ email:adminEmail.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to grant admin access");
      const grantedEmail = adminEmail.trim();
      setAdminEmail("");
      setMessage(data.invited ? `Admin access granted to ${grantedEmail}; invitation requested.` : `Admin access granted to ${grantedEmail}.`);
      await loadTeam();
    } catch(e:any){ setMessage(e.message); }
    finally { setTeamLoading(false); }
  };

  const load = async (authToken = sessionStorage.getItem("creative_dna_admin_token") || token, silent = false, force = false) => {
    if (!authToken.trim() || (queueRequest.current && !force)) return;
    if (force) queueRequest.current?.abort();
    const controller = new AbortController();
    queueRequest.current = controller;
    const current = () => !controller.signal.aborted && queueRequest.current === controller;
    setQueueLoading(true);
    if (!silent) setMessage("");
    try {
      const res = await authFetch("/api/admin/feedback", { signal: controller.signal }, authToken.trim());
      const data = await res.json();
      if (!current()) return;
      if (!res.ok) throw new Error(res.status === 401 ? "Phiên admin đã hết hạn. Vui lòng đăng nhập lại." : res.status === 403 ? "Tài khoản chưa có quyền admin đang hoạt động." : data?.error || "Không tải được danh sách feedback.");
      if (!Array.isArray(data?.proposals) || data.proposals.some((p:any) => !p || typeof p.id !== "string" || typeof p.status !== "string")) {
        throw new Error("Dữ liệu feedback trả về không hợp lệ. Vui lòng thử lại.");
      }
      for(const proposal of data.proposals){const key=reviewLockKey(proposal.id);const lock=getReviewLock(key);if(lock&&["merged","resolved","rejected"].includes(proposal.status))clearReviewLock(key);}
      setProposals(data.proposals);
      setQueueLoaded(true);
      setQueueError("");
    } catch (e:any) {
      if (current()) setQueueError(e.message || "Không tải được danh sách feedback.");
    } finally {
      if (current()) { queueRequest.current = null; setQueueLoading(false); }
    }
  };

  const reject = async (id:string) => {
    if (actionBusy.current || getReviewLock(reviewLockKey(id))) {setActionErrors(previous=>({...previous,[id]:"Kết quả thao tác trước chưa rõ. Đang kiểm tra trạng thái; không gửi lại."}));return;}
    actionBusy.current = true;
    setReviewLock(reviewLockKey(id),{action:"reject"});
    setLoading(true); setActiveAction({ id, type:"reject" }); setMessage("");
    setActionErrors(previous => ({ ...previous, [id]: "" }));
    try {
      const res = await authFetch(`/api/admin/feedback/${id}/review`, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ decision:"reject", review_note:notes[id] || "" })
      });
      const data = await res.json();
      if (!res.ok) {if(res.status<500&&res.status!==408)clearReviewLock(reviewLockKey(id));throw new Error([data.error || "Review failed", ...(Array.isArray(data.issues) ? data.issues : [])].join(" · "));}
      if(data.proposal?.id!==id||data.proposal?.status!=="rejected")throw new Error("Chưa xác nhận kết quả từ chối. Đang kiểm tra trạng thái; không gửi lại.");
      clearReviewLock(reviewLockKey(id));
      setMessage("Rejected. Canonical DNA was not changed.");
      setDetailNotice({id, message:"Rejected. Canonical DNA was not changed."});
      await load(undefined, true, true);
    } catch(e:any){ setMessage(e.message); setActionErrors(previous => ({ ...previous, [id]: e.message })); }
    finally { actionBusy.current = false; setLoading(false); setActiveAction(null); }
  };

  const deleteAllRejected = async () => {
    const rejectedCount = proposals.filter(p => p.status === "rejected").length;
    if (!rejectedCount) return;
    if (!confirm(`Delete all ${rejectedCount} rejected feedback proposal${rejectedCount===1?"":"s"}? This only removes rejected proposal history and does not change canonical Creative DNA.`)) return;

    setBulkDeleting(true); setMessage("");
    try {
      const res = await authFetch("/api/admin/feedback/delete-all", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ status:"rejected" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to delete rejected proposals");
      const deleted = Number(data.deleted_count ?? data.deleted ?? rejectedCount);
      setMessage(`Deleted ${deleted} rejected feedback proposal${deleted===1?"":"s"}. Canonical Creative DNA was not changed.`);
      await load(undefined, true, true);
    } catch(e:any) {
      setMessage(e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  useEffect(() => {
    if (!token) return;

    load(undefined, true);
    loadTeam();

    const sync = () => {
      if (document.visibilityState === "visible") load(undefined, true);
    };
    const onFocus = sync;

    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") load(undefined, true);
    }, 10000);

    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshSession().catch(()=>{});
    }, 45 * 60 * 1000);

    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", onFocus);

    return () => {
      queueRequest.current?.abort();
      queueRequest.current = null;
      window.clearInterval(poll);
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", onFocus);
    };
  }, [token]);

  return <main className="feedback-admin max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-5">
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4"/>Back to Creative DNA</button>
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-600"/><h1 className="text-2xl font-extrabold text-slate-900">Feedback inbox</h1></div>
          <p className="text-sm text-slate-500 mt-1">Quét nhanh theo brand. Mở một feedback để xem context và xử lý.</p>
          {token && <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-[10px] font-bold text-emerald-700"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 "/>Đồng bộ mỗi 10 giây</div>}
        </div>
        <button onClick={() => load()} disabled={!token || loading || queueLoading} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${queueLoading?"animate-spin":""}`}/>Refresh</button>
      </div>
      {!token ? <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3">
        <input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Admin email" className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
        <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") login();}} placeholder="Password" className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
        <button onClick={login} disabled={authLoading} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"><LogIn className="w-4 h-4"/>{authLoading?"Signing in...":"Sign in"}</button>
      </div> : <div className="flex flex-col gap-3">
        <div className="feedback-status-tabs" aria-label="Lọc trạng thái">
          {feedbackStatuses.map(status => <button key={status.value} type="button" data-status-filter={status.value} aria-pressed={filter === status.value} onClick={() => { setReviewing(null); setSelectedId(null); setFilter(status.value); }} className={filter === status.value ? "is-active" : ""}>
            {status.label}<span>{proposals.filter(p => status.value === "all" || p.status === status.value).length}</span>
          </button>)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="feedback-search flex-1 min-w-48"><Search className="w-4 h-4" aria-hidden="true"/><input type="search" aria-label="Tìm feedback" placeholder="Tìm feedback, người gửi, nội dung…" value={search} onChange={event => setSearch(event.target.value)}/></label>
          <label className="flex items-center gap-2 text-xs text-slate-500"><SlidersHorizontal className="w-4 h-4" aria-hidden="true"/><span className="sr-only">Lọc material</span><select aria-label="Lọc material" value={materialFilter} onChange={event => setMaterialFilter(event.target.value)} className="max-w-56 border border-slate-200 px-3 py-2 text-xs"><option value="all">Tất cả material</option>{materials.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <button onClick={logout} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600"><LogOut className="w-3.5 h-3.5"/>Sign out</button>
        </div>
      </div>}

      {message && <div role="status" className="text-xs p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">{message}</div>}

    </section>
    <section className="space-y-3" aria-label="Feedback proposals" aria-busy={queueLoading}>
      {token && queueLoaded && <>
        <div className="feedback-brands" aria-label="Lọc brand nguồn">
          <button type="button" aria-pressed={brandFilter === "all"} onClick={() => setBrandFilter("all")} className={brandFilter === "all" ? "is-active" : ""}><Layers3 className="w-4 h-4"/>Tất cả brand<span>{proposals.length}</span></button>
          {brands.map(brand => <button key={brand.key} type="button" aria-pressed={brandFilter === brand.key} onClick={() => setBrandFilter(brand.key)} className={brandFilter === brand.key ? "is-active" : ""}><span className={`feedback-brand-dot brand-${brand.key}`}/>{brand.label}<span>{brand.proposals.length}</span></button>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{filtered.length} feedback · Nhóm theo brand nguồn</span><span>Phạm vi áp dụng được kiểm tra riêng khi duyệt</span></div>
        {(search || materialFilter !== "all" || brandFilter !== "all") && <button type="button" className="text-xs font-semibold text-emerald-700" onClick={() => { setSearch(""); setMaterialFilter("all"); setBrandFilter("all"); }}>Xóa bộ lọc tìm kiếm / brand / material</button>}
      </>}
      {!token && <p className="text-sm text-slate-500">Đăng nhập bằng tài khoản admin để xem feedback.</p>}
      {token && !queueLoaded && !queueError && <div role="status" className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Đang tải feedback…</div>}
      {token && queueLoaded && queueLoading && <p role="status" className="text-xs text-slate-500">Đang cập nhật feedback…</p>}
      {token && queueError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">{queueLoaded ? "Chưa cập nhật được feedback. Đang giữ kết quả lần tải thành công gần nhất." : "Chưa tải được feedback. Chưa thể xác nhận danh sách có trống hay không."}</p>
        <p className="mt-1 text-xs">{queueError}</p>
        <button onClick={() => load()} disabled={queueLoading} className="mt-3 rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">{queueLoading ? "Đang thử lại…" : "Thử lại"}</button>
      </div>}
      {token && queueLoaded && !queueError && !queueLoading && filtered.length===0 && <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">Không có feedback phù hợp. {search || brandFilter !== "all" || materialFilter !== "all" ? "Thử đổi hoặc xóa bộ lọc." : "Bạn đã xem hết mục này."}</div>}
      {groups.map(group => <div key={group.key} className="feedback-group">
        <button type="button" className="feedback-group-heading" aria-expanded={!collapsedBrands[group.key]} aria-controls={`brand-group-${encodeURIComponent(group.key)}`} onClick={() => setCollapsedBrands(previous => ({ ...previous, [group.key]: !previous[group.key] }))}>
          <ChevronDown className={`w-4 h-4 ${collapsedBrands[group.key] ? "-rotate-90" : ""}`} aria-hidden="true"/><span className={`feedback-brand-dot brand-${group.key}`}/><span>{group.label}</span><span className="feedback-count">{group.proposals.length}</span><span className="ml-auto text-[11px] font-normal text-slate-500">Brand nguồn</span>
        </button>
        {!collapsedBrands[group.key] && <div id={`brand-group-${encodeURIComponent(group.key)}`}>
          <div className="feedback-row-columns" aria-hidden="true"><span>Feedback</span><span>Material</span><span>Trạng thái</span><span>Ngày gửi</span><span/></div>
          {group.proposals.map(p => <article key={p.id} className="feedback-row">
            <button type="button" onClick={event => openFeedback(p.id, event.currentTarget)} aria-label={`Mở feedback: ${feedbackTitle(p)}`} aria-haspopup="dialog" className="feedback-row-button">
              <span className="feedback-row-copy"><span className="feedback-row-title">{feedbackTitle(p)}</span><span className="feedback-row-meta"><span>{p.submitted_by_name || "Chưa có tên người gửi"}</span>{!!p.context_images?.length && <span className="inline-flex items-center gap-1"><Paperclip className="w-3 h-3" aria-hidden="true"/>{p.context_images.length} ảnh / reference</span>}{p.proposed_scope && p.proposed_scope !== "brand_branch" && <span className="feedback-scope" title={p.proposed_scope}>Scope: {p.proposed_scope}</span>}</span></span>
              <span className="feedback-row-material">{materialLabel(p)}</span>
              <span className={`feedback-status status-${p.status}`}>{feedbackStatuses.find(status => status.value === p.status)?.label || p.status}</span>
              <time className="feedback-row-date" dateTime={p.created_at} title={p.created_at}>{feedbackDate(p.created_at)}</time><ChevronRight className="feedback-row-arrow w-4 h-4" aria-hidden="true"/>
            </button>
          </article>)}
        </div>}
      </div>)}
    </section>
    {token && <details className="rounded-xl border border-slate-200 bg-white p-4" onToggle={event => { if (event.currentTarget.open) setReferencesLoaded(true); }}><summary className="cursor-pointer text-sm font-semibold">Reference Library <span className="ml-2 text-xs font-normal text-slate-500">Ảnh mẫu & context riêng</span></summary>{referencesLoaded && <div className="mt-4"><PrivateReferencePanel request={authFetch}/></div>}</details>}
    {token && <details className="rounded-2xl border border-slate-200 bg-white p-4" onToggle={event => { if (event.currentTarget.open) setAdvancedLoaded(true); }}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">Nâng cao · Knowledge Governance</summary>
      <p className="mt-2 text-xs text-slate-500">Feedback của thành viên nằm trong danh sách phía trên. Không cần điền các biểu mẫu này để nhận hoặc xem feedback. Bạn có thể review ngay trong phần chi tiết. Phần nâng cao dành cho quản lý baseline và lịch sử governance.</p>
      {advancedLoaded && <div className="mt-4"><GovernancePanel request={authFetch}/></div>}
      {!!rejectedCount && <div className="mt-5 border-t border-slate-100 pt-4"><p className="mb-2 text-xs text-slate-500">Dọn toàn bộ lịch sử từ chối của mọi brand, không theo bộ lọc hiện tại.</p><button onClick={deleteAllRejected} disabled={bulkDeleting || loading} className="px-3 py-2 text-xs font-semibold rounded-lg border border-rose-200 text-rose-700 disabled:opacity-50">{bulkDeleting ? "Deleting..." : `Delete all rejected (${rejectedCount})`}</button></div>}
    </details>}
    {token && <details data-admin-tool="access" className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">Admin access <span className="ml-2 text-xs font-normal text-slate-500">Quản lý quyền duyệt</span></summary><div className="mt-4">
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700">Admin access</div>
            <div className="text-xs text-slate-500 mt-1">Add an email that can sign in and review Creative DNA feedback.</div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
            <input
              type="email"
              value={adminEmail}
              onChange={e=>setAdminEmail(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter") grantAdmin();}}
              placeholder="admin@company.com"
              className="w-full sm:w-72 px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <button
              onClick={grantAdmin}
              disabled={teamLoading || !adminEmail.trim()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {teamLoading ? <RefreshCw className="w-4 h-4 animate-spin"/> : <ShieldCheck className="w-4 h-4"/>}
              {teamLoading ? "Adding..." : "Add admin"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {teamMembers.filter((m:any)=>m.role==="admin" && m.is_active).map((m:any)=><span key={m.user_id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-[11px] font-semibold text-indigo-700">
            <ShieldCheck className="w-3 h-3"/>
            {m.email || m.display_name || m.user_id}
          </span>)}
          {!teamLoading && teamMembers.filter((m:any)=>m.role==="admin" && m.is_active).length===0 && <span className="text-xs text-slate-400">No active admins found.</span>}
        </div>

      </div>
    </div></details>}
    {token && selectedId && <dialog ref={drawerRef} className="feedback-drawer" aria-labelledby="feedback-detail-title" onCancel={event => { event.preventDefault(); closeDrawer(); }}>
      <div className="feedback-drawer-header"><div><div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Chi tiết feedback</div><h2 id="feedback-detail-title" className="text-sm font-bold mt-1">{selected ? `${sourceBrand(selected).label} / ${materialLabel(selected)}` : "Feedback không còn trong danh sách"}</h2></div><button type="button" onClick={closeDrawer} aria-label="Đóng chi tiết feedback" className="feedback-close"><X className="w-5 h-5"/></button></div>
      <div className="feedback-drawer-body">
      {detailNotice?.id === selectedId && <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">{detailNotice.message}</p>}
      {!selected && <p className="p-5 text-sm text-slate-500">Feedback có thể đã bị xóa hoặc không còn được trả về. Đóng để quay lại danh sách.</p>}
      {[selected].filter((p):p is Proposal => !!p).map(p=>{ const governance=assessProposal(p,proposals); const parsed=parseTrainingSpec(p.raw_feedback || ""); const spec=parsed.spec; const outs=outcomeImages(p); const refs=referenceImages(p); const overview=legacyOverviewVi(p) || (p.evidence_summary as any)?.admin_overview || null; const isOpen=!!expanded[p.id]; return <div key={p.id} className="feedback-detail space-y-4">
<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><div className="text-base font-extrabold text-slate-900">{p.brand_name || "Brand"} <span className="text-slate-300">/</span> {p.branch_title || "Branch"}</div>{spec?.rule_class && <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold">{String(spec.rule_class).replaceAll("_"," ")}</span>}{spec?.confidence && <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">{String(spec.confidence)} CONFIDENCE</span>}</div><div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2"><span><span className="font-bold text-slate-700">Submitted by:</span> {p.submitted_by_name || "Missing member name"} · {p.created_at ? new Date(p.created_at).toLocaleString() : ""}</span>{(p.context_images?.length || 0) > 0 && <span className="px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 font-bold">{p.context_images?.length} visual context</span>}</div></div>
          <span className={`inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${p.status==="pending"?"bg-amber-50 text-amber-700":p.status==="accepted"||p.status==="merged"||p.status==="resolved"?"bg-emerald-50 text-emerald-700":"bg-rose-50 text-rose-700"}`}>{p.status==="pending"?<Clock3 className="w-3 h-3"/>:p.status==="accepted"||p.status==="merged"||p.status==="resolved"?<CheckCircle2 className="w-3 h-3"/>:<XCircle className="w-3 h-3"/>}{p.status}</span>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700">Tóm tắt cho Admin</div>
              <div className="text-xs text-slate-500 mt-0.5">Nhìn nhanh để hiểu case trước khi duyệt phần nạp vào database.</div>
            </div>
            <span className="px-2 py-1 rounded-full bg-white border border-indigo-100 text-[10px] font-bold text-indigo-700">{String(overview?.rule_class || spec?.rule_class || "TRAINING").replaceAll("_"," ")}</span>
          </div>
          <div className="grid gap-2.5">
            <div className="rounded-lg bg-white border border-slate-200 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Case này là gì?</div>
              <div className="text-xs text-slate-800 leading-relaxed">{String(overview?.summary || spec?.observed_issue || p.change_summary || parsed.memberFeedback || "—")}</div>
            </div>
            <div className="rounded-lg bg-white border border-slate-200 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Vì sao rút ra wisdom này?</div>
              <div className="text-xs text-slate-800 leading-relaxed">{String(overview?.why_it_matters || spec?.evidence_summary || "Chưa có tóm tắt bằng chứng bổ sung.")}</div>
            </div>
            <div className="rounded-lg bg-white border border-slate-200 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Sau này cần làm khác thế nào?</div>
              <div className="text-xs font-semibold text-slate-900 leading-relaxed">{String(overview?.proposed_change || spec?.generalized_rule || spec?.expected_behavior || p.proposed_content_md || "—")}</div>
            </div>
          </div>
          {(outs.length>0 || refs.length>0) && <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-rose-100 bg-rose-50/50 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-rose-700 mb-2">Before / Bản có vấn đề</div>
              {outs.length ? <div className="grid grid-cols-2 gap-2">{outs.slice(0,4).map((img,i)=><a key={i} href={img.image_url!} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-rose-100 bg-white"><img src={img.image_url!} alt={img.caption || "Before"} className="w-full aspect-[4/3] object-cover"/><div className="p-2 text-[10px] text-slate-600 line-clamp-2">{img.caption || "Problem output"}</div></a>)}</div> : <div className="text-xs text-slate-400">No before/problem image attached.</div>}
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-700 mb-2">After / Bản đúng / Reference</div>
              {refs.length ? <div className="grid grid-cols-2 gap-2">{refs.slice(0,4).map((img,i)=><a key={i} href={img.image_url!} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-emerald-100 bg-white"><img src={img.image_url!} alt={img.caption || "After or target"} className="w-full aspect-[4/3] object-cover"/><div className="p-2 text-[10px] text-slate-600 line-clamp-2">{img.caption || "Target/reference"}</div></a>)}</div> : <div className="text-xs text-slate-400">No after/target image attached.</div>}
            </div>
          </div>}
        </div>
        {previewImages(p).length>0 && <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">Case context</div>
            <div className="text-[10px] text-slate-400">Problem → reference/product truth → generation context</div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {previewImages(p).slice(0,12).map((img,i)=><a key={i} href={img.image_url!} target="_blank" rel="noreferrer" className="shrink-0 w-32 rounded-lg overflow-hidden border border-slate-200 bg-white">
              <div className="relative">
                <img src={img.image_url!} alt={img.caption || img.role || "Context"} className="w-full aspect-[4/3] object-cover"/>
                <span className="absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded bg-slate-950/75 text-white text-[8px] font-bold uppercase tracking-wide">{String(img.role || "context").replaceAll("_"," ")}</span>
              </div>
              <div className="p-2">
                <div className="text-[10px] font-semibold text-slate-700 line-clamp-2">{img.caption || "Context image"}</div>

              </div>
            </a>)}
          </div>
        </div>}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Database Payload</div>
              <div className="text-xs text-slate-500 mt-0.5">Nội dung đề xuất. Chỉ cập nhật Creative DNA sau khi hoàn tất đúng luồng duyệt.</div>
            </div>
            <span className="px-2 py-1 rounded-full bg-white border border-emerald-100 text-[10px] font-bold text-emerald-700">{String(spec?.scope || p.proposed_scope || "brand_branch")}</span>
          </div>
          <div className="rounded-lg bg-white border border-emerald-100 p-3 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{p.proposed_content_md || String(spec?.generalized_rule || spec?.expected_behavior || parsed.memberFeedback || "—")}</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs text-slate-500"><span>Scope:</span><span className="font-bold text-slate-700">{String(spec?.scope || p.proposed_scope || "brand_branch")}</span></div><button onClick={()=>setExpanded({...expanded,[p.id]:!isOpen})} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white"><Eye className="w-3 h-3"/>{isOpen?"Ẩn feedback gốc":"Xem feedback gốc"}{isOpen?<ChevronUp className="w-3 h-3"/>:<ChevronDown className="w-3 h-3"/>}</button></div>
        {isOpen && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3"><div><div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Original member feedback</div><div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{parsed.memberFeedback || p.raw_feedback}</div></div>{Array.isArray(spec?.reject_conditions) && spec.reject_conditions.length>0 && <div><div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600 mb-1">Reject when</div><div className="flex flex-wrap gap-1.5">{spec.reject_conditions.map((x:any,i:number)=><span key={i} className="px-2 py-1 rounded-md bg-white border border-rose-100 text-[11px] text-rose-700">{String(x)}</span>)}</div></div>}{!!p.context_images?.filter(x=>!x.image_url).length && <div><div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Unrendered image references</div><div className="text-[10px] text-slate-400 break-all">{p.context_images?.filter(x=>!x.image_url).length} private reference(s); xem metadata đầy đủ trong Advanced của review.</div></div>}</div>}
        {actionErrors[p.id] && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Chưa hoàn tất thao tác: {actionErrors[p.id]}</p>}
        {p.status==="pending" && <div className="space-y-3 border-t border-slate-100 pt-4">
          <RuleReviewHandoff key={`ai-${p.id}`} proposalId={p.id} disabled={!!reviewing||loading||!!activeAction} request={authFetch} onBusyChange={changeReviewBusy} onMerged={()=>{setDetailNotice({id:p.id,message:"AI đã merge feedback sau khi xem xét quy chuẩn và phạm vi."});void load(undefined,true,true);}}/>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2" aria-label="Owner tự duyệt rule">
            <button type="button" onClick={()=>setReviewing({id:p.id,path:"owner"})} disabled={loading||reviewBusy||!!reviewing||!!activeAction} className="rounded-lg bg-indigo-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Hard merge · Tự duyệt rule</button>
            <p className="text-xs text-slate-600">Mở bản so sánh và phạm vi để bạn xác nhận. Chưa merge khi bấm nút này; vẫn kiểm tra quyền, phiên bản và xung đột.</p>
          </div>
          <details><summary className="cursor-pointer text-xs text-slate-500">Xử lý thủ công / Đối chiếu quy chuẩn</summary>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={()=>setReviewing({id:p.id,path:"covered"})} disabled={loading||reviewBusy||!!reviewing} className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-bold text-indigo-700 disabled:opacity-50">Đã có trong quy chuẩn</button>
            <button type="button" onClick={()=>setReviewing({id:p.id,path:"merge"})} disabled={loading||reviewBusy||!!reviewing} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Sparkles className="w-3.5 h-3.5"/>Xem & duyệt</button>
          </div>
          </details>
          {reviewing?.id===p.id && <FeedbackReviewPanel key={`${reviewing.path}-${p.id}`} proposal={p} path={reviewing.path} request={authFetch} onBusyChange={changeReviewBusy} onClose={()=>setReviewing(null)} onComplete={(resultMessage)=>{setMessage(resultMessage);setDetailNotice({id:p.id,message:resultMessage});changeReviewBusy(false);setReviewing(null);void load(undefined,true,true);}}/>}
          {!reviewing && <div className="flex flex-col sm:flex-row gap-2 items-end"><textarea aria-label="Ghi chú từ chối" value={notes[p.id]||""} onChange={e=>setNotes({...notes,[p.id]:e.target.value})} placeholder="Optional admin note..." className="w-full min-h-16 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"/><button type="button" onClick={()=>reject(p.id)} disabled={loading||reviewBusy} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-lg border border-rose-200 text-rose-700 bg-rose-50 disabled:opacity-50">{activeAction?.id===p.id && <RefreshCw className="w-3.5 h-3.5 animate-spin"/>}{activeAction?.id===p.id?"Rejecting...":"Reject"}</button></div>}
        </div>}
        {p.status==="accepted" && <p className="border-t border-slate-100 pt-4 text-xs text-amber-900">Legacy accepted · Chỉ xem. Luồng merge cũ đã bị chặn; trạng thái này không chứng minh canonical đã cập nhật. Cần kiểm tra lịch sử và tạo review hợp lệ trước khi thay đổi quy chuẩn.</p>}
        {p.status==="resolved" && <ResolvedFeedbackAudit proposal={p}/>}
        {p.merged_at && <div className="text-xs text-emerald-700 font-semibold">Merged {new Date(p.merged_at).toLocaleString()}</div>}{p.review_note && <div className="text-xs text-slate-500">Admin note: {p.review_note}</div>}
        <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-semibold">Phân tích governance · Tham khảo</summary><div className="mt-3">        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
 <div className="flex flex-wrap items-center justify-between gap-2">
  <span className="text-xs font-semibold text-slate-800">Knowledge Governance · Advisory</span>
  <span className="text-xs font-semibold text-slate-700">Evidence priority {governance.total}/100 · {governance.recommendation}</span>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] text-slate-600">
  <span>Evidence {governance.scores.evidence}/30</span>
  <span>Product Truth {governance.scores.productTruth}/25</span>
  <span>Reusability {governance.scores.reusability}/20</span>
  <span>Consistency {governance.scores.consistency}/15</span>
  <span>Impact {governance.scores.outcomeImpact}/10</span>
 </div>
 {governance.issues.length>0 && <p className="text-xs text-slate-600">{governance.issues.join(" · ")}</p>}
 {governance.similar.length>0 && <p className="text-xs text-slate-600">Có {governance.similar.length} feedback gần nhau về từ ngữ; cần đọc đối chiếu, chưa phải kết luận trùng lặp.</p>}
 <p className="text-[11px] text-slate-500">{governance.note}</p>
 </div>
</div></details>
      </div>})}
      </div>
    </dialog>}
  </main>;
}
