import { GovernancePanel } from "./GovernancePanel";
import { assessProposal } from "../knowledge-governance";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Clock3, Eye, ImagePlus, LogIn, LogOut, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";

type Proposal = {
  id: string;
  status: string;
  brand_name?: string;
  branch_title?: string;
  branch_slug?: string;
  submitted_by_name?: string;
  raw_feedback?: string;
  proposed_content_md?: string;
  proposed_scope?: string;
  change_summary?: string;
  evidence_summary?: Record<string, unknown>;
  created_at?: string;
  reviewed_at?: string;
  review_note?: string;
  merged_at?: string;
  context_images?: Array<{ role:string; image_url?:string|null; reference_id?:string|null; caption?:string|null }>;
};

export function AdminFeedback({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState(() => sessionStorage.getItem("creative_dna_admin_token") || "");
  const [refreshToken, setRefreshToken] = useState(() => sessionStorage.getItem("creative_dna_admin_refresh_token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [activeAction, setActiveAction] = useState<{ id:string; type:"accept"|"reject"|"merge" } | null>(null);
  const [message, setMessage] = useState("");
  const [gateInputs, setGateInputs] = useState<Record<string,{evidence:string;baselines:string;note:string;checks:boolean}>>({});
  const [evaluationIds,setEvaluationIds] = useState<Record<string,string>>({});
  const gateFor=(id:string)=>{const v=gateInputs[id]||{evidence:"",baselines:"",note:"",checks:false};return {evidence_urls:v.evidence.split("\n").map(x=>x.trim()).filter(Boolean),baseline_ids:v.baselines.split("\n").map(x=>x.trim()).filter(Boolean),scope_checked:v.checks,canonical_conflicts_checked:v.checks,product_truth_verified:v.checks,before_after_reviewed:v.checks,severe_regressions:v.checks?0:-1,review_note:v.note};};
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [filter, setFilter] = useState("pending");
  const [expanded, setExpanded] = useState<Record<string,boolean>>({});
  const [adminEmail, setAdminEmail] = useState("");
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [guideRoutes, setGuideRoutes] = useState<Array<{brand:string;branch:string;title:string}>>([]);
  const [guideBrand, setGuideBrand] = useState("giftsoul");
  const [guideBranch, setGuideBranch] = useState("home-hero");
  const [guideForm, setGuideForm] = useState({ title_vi:"", description_vi:"", usage_badge:"", ratio_note:"", output_note:"", image_url:"", image_caption:"", page_url:"", css_selector:"", preview_mode:"selector" });
  const [guideLoading, setGuideLoading] = useState(false);

  const filtered = useMemo(() => filter === "all" ? proposals : proposals.filter(p => p.status === filter), [proposals, filter]);

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
    if (!email.trim() || !password) return setMessage("Enter your admin email and password.");
    setAuthLoading(true); setMessage("");
    try {
      const res = await fetch("/api/admin/login", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ email:email.trim(), password }) });
      const data = await res.json();
      if (!res.ok || !data.access_token) throw new Error(data.error || "Unable to sign in");
      sessionStorage.setItem("creative_dna_admin_token", data.access_token);
      if (data.refresh_token) sessionStorage.setItem("creative_dna_admin_refresh_token", data.refresh_token);
      setToken(data.access_token);
      if (data.refresh_token) setRefreshToken(data.refresh_token);
      setPassword("");
      await load(data.access_token);
      await loadTeam(data.access_token);
    } catch(e:any) { setMessage(e.message); } finally { setAuthLoading(false); }
  };

  const logout = () => {
    sessionStorage.removeItem("creative_dna_admin_token");
    sessionStorage.removeItem("creative_dna_admin_refresh_token");
    setToken("");
    setRefreshToken("");
    setProposals([]);
    setTeamMembers([]);
    setMessage("Signed out.");
  };

  const refreshSession = async () => {
    const currentRefresh = sessionStorage.getItem("creative_dna_admin_refresh_token") || refreshToken;
    if (!currentRefresh) return "";
    const res = await fetch("/api/admin/refresh", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ refresh_token:currentRefresh })
    });
    const data = await res.json();
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
    let access = explicitToken || sessionStorage.getItem("creative_dna_admin_token") || token;
    const run = (t:string) => fetch(url, {
      ...init,
      headers:{ ...(init.headers || {}), Authorization:`Bearer ${t}` }
    });
    let res = await run(access);
    if (res.status === 401) {
      const fresh = await refreshSession();
      if (fresh) res = await run(fresh);
    }
    return res;
  };

  const loadGuideRoutes = async () => {
    try {
      const [routesRes, guidesRes] = await Promise.all([fetch("/api/routes", { method:"POST" }), fetch("/api/branch-guides")]);
      const routesData = await routesRes.json();
      const guidesData = await guidesRes.json();
      const routes = Array.isArray(routesData?.routes) ? routesData.routes : [];
      setGuideRoutes(routes);

      const current = Array.isArray(guidesData?.guides)
        ? guidesData.guides.find((g:any)=>g.brand_slug===guideBrand && g.branch_slug===guideBranch)
        : null;
      if (current) {
        setGuideForm({
          title_vi:current.title_vi || "",
          description_vi:current.description_vi || "",
          usage_badge:current.usage_badge || "",
          ratio_note:current.ratio_note || "",
          output_note:current.output_note || "",
          image_url:current.image_url || "",
          image_caption:current.image_caption || "",
          page_url:current.page_url || "",
          css_selector:current.css_selector || "",
          preview_mode:current.preview_mode || "selector",
        });
      }
    } catch {
      // Visual guide management is optional; keep feedback queue usable if this fails.
    }
  };

  const loadSelectedGuide = async (brandSlug:string, branchSlug:string) => {
    setGuideLoading(true);
    try {
      const res = await fetch("/api/branch-guides");
      const data = await res.json();
      const current = Array.isArray(data?.guides)
        ? data.guides.find((g:any)=>g.brand_slug===brandSlug && g.branch_slug===branchSlug)
        : null;
      setGuideForm(current ? {
        title_vi:current.title_vi || "",
        description_vi:current.description_vi || "",
        usage_badge:current.usage_badge || "",
        ratio_note:current.ratio_note || "",
        output_note:current.output_note || "",
        image_url:current.image_url || "",
        image_caption:current.image_caption || "",
        page_url:current.page_url || "",
        css_selector:current.css_selector || "",
        preview_mode:current.preview_mode || "selector",
      } : { title_vi:"", description_vi:"", usage_badge:"", ratio_note:"", output_note:"", image_url:"", image_caption:"", page_url:"", css_selector:"", preview_mode:"selector" });
    } finally {
      setGuideLoading(false);
    }
  };

  const saveBranchGuide = async () => {
    if (!guideForm.page_url.trim() || !guideForm.css_selector.trim()) {
      return setMessage("Nhập Page URL và CSS selector trước khi lưu.");
    }
    setGuideLoading(true); setMessage("");
    try {
      const res = await authFetch("/api/admin/branch-guides/upsert", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({
          brand_slug:guideBrand,
          branch_slug:guideBranch,
          ...guideForm,
          preview_mode:"selector",
          image_url:"",
          image_caption:"",
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to save branch live preview");
      setGuideForm(prev=>({
        ...prev,
        page_url:data?.guide?.page_url || prev.page_url,
        css_selector:data?.guide?.css_selector || prev.css_selector,
        image_url:"",
        image_caption:"",
        preview_mode:"selector",
      }));
      setMessage("Đã lưu Live UI selector cho branch này.");
      await loadSelectedGuide(guideBrand, guideBranch);
    } catch(e:any) {
      setMessage(e.message);
    } finally {
      setGuideLoading(false);
    }
  };

  const loadTeam = async (authToken = sessionStorage.getItem("creative_dna_admin_token") || token) => {
    if (!authToken.trim()) return;
    setTeamLoading(true);
    try {
      const res = await authFetch("/api/admin/team", {}, authToken.trim());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load admin team");
      setTeamMembers(data.members || []);
    } catch (e:any) { setMessage(e.message); }
    finally { setTeamLoading(false); }
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

  const load = async (authToken = sessionStorage.getItem("creative_dna_admin_token") || token, silent = false) => {
    if (!authToken.trim()) return;
    if (!silent) { setLoading(true); setMessage(""); }
    try {
      const res = await authFetch("/api/admin/feedback", {}, authToken.trim());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load feedback queue");
      setProposals(data.proposals || []);
    } catch (e:any) { if (!silent) setMessage(e.message); }
    finally { if (!silent) setLoading(false); }
  };

  const merge = async (id:string) => {
    if (!confirm("Confirm the evidence and regression checks are complete. Merge into canonical?")) return;
    setLoading(true); setActiveAction({ id, type:"merge" }); setMessage("");
    try {
      const res = await authFetch(`/api/admin/feedback/${id}/merge`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({regression:gateFor(id),evaluation_id:evaluationIds[id]||""}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge failed");
      setMessage(`Merged into canonical DNA (${data.merged_nodes || 1} node${data.merged_nodes===1?"":"s"}${data.cross_brand_sync?", cross-brand synced":""}).`);
      await load();
    } catch(e:any){ setMessage(e.message); setLoading(false); }
    finally { setActiveAction(null); }
  };

  const decide = async (id:string, decision:"accept"|"reject") => {
    setLoading(true); setActiveAction({ id, type:decision }); setMessage("");
    try {
      const res = await authFetch(`/api/admin/feedback/${id}/review`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ decision, review_note:notes[id] || "", ...(decision==="accept"?{regression:gateFor(id),evaluation_id:evaluationIds[id]||""}:{}) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setMessage(decision === "accept" ? `Accepted (upstream response): canonical change reported (${data.merged_nodes || 1} node${data.merged_nodes===1?"":"s"}${data.cross_brand_sync?", cross-brand synced":""}).` : "Rejected. Canonical DNA was not changed.");
      await load();
    } catch(e:any){ setMessage(e.message); setLoading(false); }
    finally { setActiveAction(null); }
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
      await load();
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
    loadGuideRoutes();

    const sync = () => {
      if (document.visibilityState === "visible") load(undefined, true);
    };
    const onFocus = () => load(undefined, true);

    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") load(undefined, true);
    }, 10000);

    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshSession();
    }, 45 * 60 * 1000);

    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(poll);
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", onFocus);
    };
  }, [token]);

  return <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4"/>Back to Creative DNA</button>
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-600"/><h1 className="text-2xl font-extrabold text-slate-900">Admin Feedback Queue</h1></div>
          <p className="text-sm text-slate-500 mt-1">Visual-first review: scan context, problem, reusable rule and scope. Accept now merges directly into canonical DNA in one action.</p>
          {token && <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-[10px] font-bold text-emerald-700"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>Auto-sync mỗi 10 giây · tự refresh session</div>}
        </div>
        <button onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading?"animate-spin":""}`}/>Refresh</button>
      </div>
      {!token ? <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3">
        <input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Admin email" className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
        <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") login();}} placeholder="Password" className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
        <button onClick={login} disabled={authLoading} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"><LogIn className="w-4 h-4"/>{authLoading?"Signing in...":"Sign in"}</button>
      </div> : <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex gap-1">{["pending","merged","rejected","accepted","all"].map(x=><button key={x} onClick={()=>setFilter(x)} className={`px-3 py-2 text-xs font-semibold rounded-lg border ${filter===x?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-200"}`}>{x==="accepted"?"accepted (legacy)":x}</button>)}</div>
        <div className="flex items-center gap-2">
          {filter==="rejected" && filtered.length>0 && <button onClick={deleteAllRejected} disabled={bulkDeleting || loading} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border border-rose-200 bg-rose-50 text-rose-700 disabled:opacity-50">
            {bulkDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <XCircle className="w-3.5 h-3.5"/>}
            {bulkDeleting ? "Deleting..." : `Delete all rejected (${filtered.length})`}
          </button>}
          <button onClick={logout} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600"><LogOut className="w-3.5 h-3.5"/>Sign out</button>
        </div>
      </div>}
      {message && <div className="text-xs p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">{message}</div>}
      {token && <div className="border-t border-slate-100 pt-4 space-y-3">
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

        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <ImagePlus className="w-4 h-4 text-indigo-600"/>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700">Branch Visual Guide</div>
              <div className="text-xs text-slate-500 mt-0.5">Chọn branch, nhập URL trang thật và CSS selector của đúng section. Preview sẽ render live theo web hiện tại.</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-[220px_1fr] gap-3">
            <select
              value={guideBrand}
              onChange={e=>{
                const next=e.target.value;
                setGuideBrand(next);
                const first=guideRoutes.find(r=>r.brand===next)?.branch || "";
                setGuideBranch(first);
                if(first) loadSelectedGuide(next,first);
              }}
              className="px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg"
            >
              {[...new Set(guideRoutes.map(r=>r.brand))].map(b=><option key={b} value={b}>{b}</option>)}
            </select>

            <select
              value={guideBranch}
              onChange={e=>{setGuideBranch(e.target.value); loadSelectedGuide(guideBrand,e.target.value);}}
              className="px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg"
            >
              {guideRoutes.filter(r=>r.brand===guideBrand).map(r=><option key={r.branch} value={r.branch}>{r.title || r.branch}</option>)}
            </select>
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-bold text-slate-900">{guideForm.title_vi || guideBranch}</div>
            <div className="text-xs text-slate-500 mt-1">{guideForm.description_vi || "Metadata tự lấy từ database."}</div>
          </div>

          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Page URL</div>
              <input
                value={guideForm.page_url}
                onChange={e=>setGuideForm({...guideForm,page_url:e.target.value})}
                placeholder="https://giftsoul.co/pages/..."
                className="w-full px-3 py-3 text-sm bg-white border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">CSS selector</div>
              <input
                value={guideForm.css_selector}
                onChange={e=>setGuideForm({...guideForm,css_selector:e.target.value})}
                placeholder="#shopify-section-template--...__hero"
                className="w-full px-3 py-3 text-sm font-mono bg-white border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button onClick={saveBranchGuide} disabled={guideLoading || !guideBrand || !guideBranch || !guideForm.page_url.trim() || !guideForm.css_selector.trim()} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">
              {guideLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin"/>}
              {guideLoading ? "Saving..." : "Save Live UI"}
            </button>
          </div>
        </div>
      </div>}
    </section>
    <GovernancePanel request={authFetch}/>
    <section className="space-y-3">
      {!loading && filtered.length===0 && <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">No {filter==="all"?"":filter} feedback proposals.</div>}
      {filtered.map(p=>{ const governance=assessProposal(p,proposals); const parsed=parseTrainingSpec(p.raw_feedback || ""); const spec=parsed.spec; const outs=outcomeImages(p); const refs=referenceImages(p); const overview=legacyOverviewVi(p) || (p.evidence_summary as any)?.admin_overview || null; const isOpen=!!expanded[p.id]; return <article key={p.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
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
 {governance.similar.length>0 && <p className="text-xs text-slate-600">Potential duplicates: {governance.similar.map(x=>x.id.slice(0,8)).join(", ")}</p>}
 <p className="text-[11px] text-slate-500">{governance.note}</p>
 </div>
 <div className="rounded-xl border border-slate-200 p-3 space-y-2">
 <p className="text-xs font-semibold text-slate-800">Regression gate · Bắt buộc trước Accept / Merge</p>
 <input className="w-full border border-slate-300 rounded-lg p-2 text-xs" placeholder="Passed evaluation ID (from Knowledge Governance)" value={evaluationIds[p.id]||""} onChange={e=>setEvaluationIds(x=>({...x,[p.id]:e.target.value}))}/>
 <div className="grid sm:grid-cols-2 gap-2">
  <textarea aria-label="Evidence links or IDs" placeholder="Evidence URLs / IDs · mỗi dòng một mục" rows={2} className="border border-slate-300 rounded-lg p-2 text-xs" value={gateInputs[p.id]?.evidence||""} onChange={e=>setGateInputs(x=>({...x,[p.id]:{...(x[p.id]||{baselines:"",note:"",checks:false}),evidence:e.target.value}}))}/>
  <textarea aria-label="Regression baseline IDs" placeholder="Baseline case IDs · mỗi dòng một mục" rows={2} className="border border-slate-300 rounded-lg p-2 text-xs" value={gateInputs[p.id]?.baselines||""} onChange={e=>setGateInputs(x=>({...x,[p.id]:{...(x[p.id]||{evidence:"",note:"",checks:false}),baselines:e.target.value}}))}/>
 </div>
 <textarea aria-label="Regression review notes" placeholder="Kết quả so sánh before/after, xung đột và kiểm tra fidelity..." rows={2} className="border border-slate-300 rounded-lg p-2 text-xs w-full" value={gateInputs[p.id]?.note||""} onChange={e=>setGateInputs(x=>({...x,[p.id]:{...(x[p.id]||{evidence:"",baselines:"",checks:false}),note:e.target.value}}))}/>
 <label className="flex gap-2 items-start text-xs text-slate-700"><input type="checkbox" checked={!!gateInputs[p.id]?.checks} onChange={e=>setGateInputs(x=>({...x,[p.id]:{...(x[p.id]||{evidence:"",baselines:"",note:""}),checks:e.target.checked}}))}/><span>Tôi đã kiểm tra Product Truth, scope, xung đột canonical và so sánh before/after trên baseline; không có regression nghiêm trọng</span></label>
 <p className="text-[11px] text-slate-500">Xác nhận thủ công có dẫn chứng; hệ thống chưa tự chạy generator regression. Gate chặn khi thiếu thông tin.</p>
 </div>
<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><div className="text-base font-extrabold text-slate-900">{p.brand_name || "Brand"} <span className="text-slate-300">/</span> {p.branch_title || "Branch"}</div>{spec?.rule_class && <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold">{String(spec.rule_class).replaceAll("_"," ")}</span>}{spec?.confidence && <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">{String(spec.confidence)} CONFIDENCE</span>}</div><div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2"><span><span className="font-bold text-slate-700">Submitted by:</span> {p.submitted_by_name || "Missing member name"} · {p.created_at ? new Date(p.created_at).toLocaleString() : ""}</span>{(p.context_images?.length || 0) > 0 && <span className="px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 font-bold">{p.context_images?.length} visual context</span>}</div></div>
          <span className={`inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${p.status==="pending"?"bg-amber-50 text-amber-700":p.status==="accepted"||p.status==="merged"?"bg-emerald-50 text-emerald-700":"bg-rose-50 text-rose-700"}`}>{p.status==="pending"?<Clock3 className="w-3 h-3"/>:p.status==="accepted"||p.status==="merged"?<CheckCircle2 className="w-3 h-3"/>:<XCircle className="w-3 h-3"/>}{p.status}</span>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700">Tóm tắt cho Admin</div>
              <div className="text-xs text-slate-500 mt-0.5">Nhìn nhanh để hiểu case trước khi duyệt phần nạp vào database.</div>
            </div>
            <span className="px-2 py-1 rounded-full bg-white border border-indigo-100 text-[10px] font-bold text-indigo-700">{String(overview?.rule_class || spec?.rule_class || "TRAINING").replaceAll("_"," ")}</span>
          </div>
          <div className="grid md:grid-cols-3 gap-2.5">
            <div className="rounded-lg bg-white border border-slate-200 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Case này là gì?</div>
              <div className="text-xs text-slate-800 leading-relaxed">{String(overview?.summary || spec?.observed_issue || p.change_summary || parsed.memberFeedback || "—")}</div>
            </div>
            <div className="rounded-lg bg-white border border-slate-200 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Vì sao rút ra wisdom này?</div>
              <div className="text-xs text-slate-800 leading-relaxed">{String(overview?.why_it_matters || spec?.evidence_summary || "No additional evidence summary.")}</div>
            </div>
            <div className="rounded-lg bg-white border border-slate-200 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Sau này cần làm khác thế nào?</div>
              <div className="text-xs font-semibold text-slate-900 leading-relaxed">{String(overview?.proposed_change || spec?.generalized_rule || spec?.expected_behavior || p.proposed_content_md || "—")}</div>
            </div>
          </div>
          {(outs.length>0 || refs.length>0) && <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-rose-100 bg-rose-50/50 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-rose-700 mb-2">Before / Bản có vấn đề</div>
              {outs.length ? <div className="grid grid-cols-2 gap-2">{outs.slice(0,4).map((img,i)=><a key={i} href={img.image_url!} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-rose-100 bg-white"><img src={img.image_url!} alt={img.caption || "Before"} className="w-full aspect-[4/3] object-cover"/><div className="p-2 text-[10px] text-slate-600 line-clamp-2">{img.caption || img.reference_id || "Problem output"}</div></a>)}</div> : <div className="text-xs text-slate-400">No before/problem image attached.</div>}
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-700 mb-2">After / Bản đúng / Reference</div>
              {refs.length ? <div className="grid grid-cols-2 gap-2">{refs.slice(0,4).map((img,i)=><a key={i} href={img.image_url!} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-emerald-100 bg-white"><img src={img.image_url!} alt={img.caption || "After or target"} className="w-full aspect-[4/3] object-cover"/><div className="p-2 text-[10px] text-slate-600 line-clamp-2">{img.caption || img.reference_id || "Target/reference"}</div></a>)}</div> : <div className="text-xs text-slate-400">No after/target image attached.</div>}
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
                {img.reference_id && <div className="text-[9px] text-slate-400 truncate mt-1">{img.reference_id}</div>}
              </div>
            </a>)}
          </div>
        </div>}
        {(outs.length>0 || refs.length>0) && <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3"><div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-700 mb-2">Outcome / Problem</div>{outs.length ? <div className="grid grid-cols-2 gap-2">{outs.slice(0,4).map((img,i)=><a key={i} href={img.image_url!} target="_blank" rel="noreferrer" className="relative overflow-hidden rounded-lg border border-rose-100 bg-white"><img src={img.image_url!} alt={img.caption || "Outcome"} className="w-full aspect-[4/3] object-cover"/>{img.caption && <div className="absolute inset-x-0 bottom-0 bg-slate-950/75 text-white text-[10px] p-2 line-clamp-2">{img.caption}</div>}</a>)}</div> : <div className="text-xs text-slate-400">No persisted outcome image</div>}</div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3"><div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 mb-2">Target / Reference</div>{refs.length ? <div className="grid grid-cols-2 gap-2">{refs.slice(0,4).map((img,i)=><a key={i} href={img.image_url!} target="_blank" rel="noreferrer" className="relative overflow-hidden rounded-lg border border-emerald-100 bg-white"><img src={img.image_url!} alt={img.caption || "Reference"} className="w-full aspect-[4/3] object-cover"/>{img.caption && <div className="absolute inset-x-0 bottom-0 bg-slate-950/75 text-white text-[10px] p-2 line-clamp-2">{img.caption}</div>}</a>)}</div> : <div className="text-xs text-slate-400">No persisted target/reference image</div>}</div>
        </div>}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Database Payload</div>
              <div className="text-xs text-slate-500 mt-0.5">Phần này giữ nguyên nội dung canonical và sẽ được nạp vào Creative DNA khi duyệt.</div>
            </div>
            <span className="px-2 py-1 rounded-full bg-white border border-emerald-100 text-[10px] font-bold text-emerald-700">{String(spec?.scope || p.proposed_scope || "brand_branch")}</span>
          </div>
          <div className="rounded-lg bg-white border border-emerald-100 p-3 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{p.proposed_content_md || String(spec?.generalized_rule || spec?.expected_behavior || parsed.memberFeedback || "—")}</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs text-slate-500"><span>Scope:</span><span className="font-bold text-slate-700">{String(spec?.scope || p.proposed_scope || "brand_branch")}</span></div><button onClick={()=>setExpanded({...expanded,[p.id]:!isOpen})} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white"><Eye className="w-3 h-3"/>{isOpen?"Hide details":"View details"}{isOpen?<ChevronUp className="w-3 h-3"/>:<ChevronDown className="w-3 h-3"/>}</button></div>
        {isOpen && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3"><div><div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Original member feedback</div><div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{parsed.memberFeedback || p.raw_feedback}</div></div>{Array.isArray(spec?.reject_conditions) && spec.reject_conditions.length>0 && <div><div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600 mb-1">Reject when</div><div className="flex flex-wrap gap-1.5">{spec.reject_conditions.map((x:any,i:number)=><span key={i} className="px-2 py-1 rounded-md bg-white border border-rose-100 text-[11px] text-rose-700">{String(x)}</span>)}</div></div>}{!!p.context_images?.filter(x=>!x.image_url).length && <div><div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Unrendered image references</div><div className="text-[10px] text-slate-400 break-all">{p.context_images?.filter(x=>!x.image_url).map(x=>x.reference_id).filter(Boolean).join(" · ")}</div></div>}</div>}
        {p.status==="pending" && <div className="grid lg:grid-cols-[1fr_auto] gap-3 items-end border-t border-slate-100 pt-4"><textarea value={notes[p.id]||""} onChange={e=>setNotes({...notes,[p.id]:e.target.value})} placeholder="Optional admin note..." className="w-full min-h-16 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/><div className="flex gap-2"><button onClick={()=>decide(p.id,"reject")} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-lg border border-rose-200 text-rose-700 bg-rose-50 disabled:opacity-50">{activeAction?.id===p.id && activeAction.type==="reject" && <RefreshCw className="w-3.5 h-3.5 animate-spin"/>}{activeAction?.id===p.id && activeAction.type==="reject" ? "Rejecting..." : "Reject"}</button><button onClick={()=>decide(p.id,"accept")} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-50">{activeAction?.id===p.id && activeAction.type==="accept" ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <Sparkles className="w-3.5 h-3.5"/>}{activeAction?.id===p.id && activeAction.type==="accept" ? "Accepting & Merging..." : "Accept & Merge"}</button></div></div>}
        {p.status==="accepted" && <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><div className="text-xs text-indigo-700">Legacy accepted proposal from the old flow. New Accept actions merge automatically.</div><button onClick={()=>merge(p.id)} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-50">{activeAction?.id===p.id && activeAction.type==="merge" && <RefreshCw className="w-3.5 h-3.5 animate-spin"/>}{activeAction?.id===p.id && activeAction.type==="merge" ? "Merging..." : "Finish legacy merge"}</button></div>}
        {p.merged_at && <div className="text-xs text-emerald-700 font-semibold">Merged {new Date(p.merged_at).toLocaleString()}</div>}{p.review_note && <div className="text-xs text-slate-500">Admin note: {p.review_note}</div>}
      </article>})}
    </section>
  </main>;
}
