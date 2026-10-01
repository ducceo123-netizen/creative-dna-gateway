import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Clock3, Eye, LogIn, LogOut, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<{ id:string; type:"accept"|"reject"|"merge" } | null>(null);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [filter, setFilter] = useState("pending");
  const [expanded, setExpanded] = useState<Record<string,boolean>>({});
  const [adminEmail, setAdminEmail] = useState("");
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

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

  const login = async () => {
    if (!email.trim() || !password) return setMessage("Enter your admin email and password.");
    setAuthLoading(true); setMessage("");
    try {
      const res = await fetch("/api/admin/login", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ email:email.trim(), password }) });
      const data = await res.json();
      if (!res.ok || !data.access_token) throw new Error(data.error || "Unable to sign in");
      sessionStorage.setItem("creative_dna_admin_token", data.access_token);
      setToken(data.access_token); setPassword("");
      await load(data.access_token);
      await loadTeam(data.access_token);
    } catch(e:any) { setMessage(e.message); } finally { setAuthLoading(false); }
  };

  const logout = () => { sessionStorage.removeItem("creative_dna_admin_token"); setToken(""); setProposals([]); setMessage("Signed out."); };

  const loadTeam = async (authToken = token) => {
    if (!authToken.trim()) return;
    setTeamLoading(true);
    try {
      const res = await fetch("/api/admin/team", { headers: { Authorization: `Bearer ${authToken.trim()}` } });
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
      const res = await fetch("/api/admin/team/grant", {
        method:"POST",
        headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token.trim()}` },
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

  const load = async (authToken = token) => {
    if (!authToken.trim()) return setMessage("Sign in with your admin account first.");
    setLoading(true); setMessage("");
    try {
      const res = await fetch("/api/admin/feedback", { headers: { Authorization: `Bearer ${authToken.trim()}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load feedback queue");
      setProposals(data.proposals || []);
      sessionStorage.setItem("creative_dna_admin_token", authToken.trim());
    } catch (e:any) { setMessage(e.message); } finally { setLoading(false); }
  };

  const merge = async (id:string) => {
    if (!confirm("Merge this accepted feedback into canonical Creative DNA? Structural Onepage feedback will sync across brands.")) return;
    setLoading(true); setActiveAction({ id, type:"merge" }); setMessage("");
    try {
      const res = await fetch(`/api/admin/feedback/${id}/merge`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token.trim()}` } });
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
      const res = await fetch(`/api/admin/feedback/${id}/review`, {
        method:"POST",
        headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token.trim()}` },
        body:JSON.stringify({ decision, review_note:notes[id] || "" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setMessage(decision === "accept" ? `Accepted & merged into canonical DNA (${data.merged_nodes || 1} node${data.merged_nodes===1?"":"s"}${data.cross_brand_sync?", cross-brand synced":""}).` : "Rejected. Canonical DNA was not changed.");
      await load();
    } catch(e:any){ setMessage(e.message); setLoading(false); }
    finally { setActiveAction(null); }
  };

  useEffect(() => { if (token) { load(); loadTeam(); } }, []);

  return <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4"/>Back to Creative DNA</button>
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-600"/><h1 className="text-2xl font-extrabold text-slate-900">Admin Feedback Queue</h1></div>
          <p className="text-sm text-slate-500 mt-1">Visual-first review: scan context, problem, reusable rule and scope. Accept now merges directly into canonical DNA in one action.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading?"animate-spin":""}`}/>Refresh</button>
      </div>
      {!token ? <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3">
        <input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Admin email" className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
        <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") login();}} placeholder="Password" className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
        <button onClick={login} disabled={authLoading} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"><LogIn className="w-4 h-4"/>{authLoading?"Signing in...":"Sign in"}</button>
      </div> : <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex gap-1">{["pending","merged","rejected","accepted","all"].map(x=><button key={x} onClick={()=>setFilter(x)} className={`px-3 py-2 text-xs font-semibold rounded-lg border ${filter===x?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-200"}`}>{x==="accepted"?"accepted (legacy)":x}</button>)}</div>
        <button onClick={logout} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600"><LogOut className="w-3.5 h-3.5"/>Sign out</button>
      </div>}
      {message && <div className="text-xs p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">{message}</div>}
    </section>
    <section className="space-y-3">
      {!loading && filtered.length===0 && <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">No {filter==="all"?"":filter} feedback proposals.</div>}
      {filtered.map(p=>{ const parsed=parseTrainingSpec(p.raw_feedback || ""); const spec=parsed.spec; const outs=outcomeImages(p); const refs=referenceImages(p); const isOpen=!!expanded[p.id]; return <article key={p.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><div className="text-base font-extrabold text-slate-900">{p.brand_name || "Brand"} <span className="text-slate-300">/</span> {p.branch_title || "Branch"}</div>{spec?.rule_class && <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold">{String(spec.rule_class).replaceAll("_"," ")}</span>}{spec?.confidence && <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">{String(spec.confidence)} CONFIDENCE</span>}</div><div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2"><span>{p.submitted_by_name || "Member"} · {p.created_at ? new Date(p.created_at).toLocaleString() : ""}</span>{(p.context_images?.length || 0) > 0 && <span className="px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 font-bold">{p.context_images?.length} visual context</span>}</div></div>
          <span className={`inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${p.status==="pending"?"bg-amber-50 text-amber-700":p.status==="accepted"||p.status==="merged"?"bg-emerald-50 text-emerald-700":"bg-rose-50 text-rose-700"}`}>{p.status==="pending"?<Clock3 className="w-3 h-3"/>:p.status==="accepted"||p.status==="merged"?<CheckCircle2 className="w-3 h-3"/>:<XCircle className="w-3 h-3"/>}{p.status}</span>
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
        {spec ? <div className="grid md:grid-cols-2 gap-3">
          <div className="p-4 rounded-xl border border-rose-100 bg-rose-50/50"><div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-700 mb-1">What went wrong</div><div className="text-sm font-medium text-slate-800 leading-relaxed">{String(spec.observed_issue || p.change_summary || parsed.memberFeedback || "—")}</div></div>
          <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/50"><div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 mb-1">Rule to learn</div><div className="text-sm font-semibold text-slate-900 leading-relaxed">{String(spec.generalized_rule || spec.expected_behavior || "—")}</div></div>
          {spec.expected_behavior && <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/40"><div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 mb-1">Expected behavior</div><div className="text-sm text-slate-700 leading-relaxed">{String(spec.expected_behavior)}</div></div>}
          {spec.evidence_summary && <div className="p-4 rounded-xl border border-slate-200 bg-slate-50"><div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Visual evidence</div><div className="text-sm text-slate-700 leading-relaxed">{String(spec.evidence_summary)}</div></div>}
        </div> : <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-sm leading-relaxed whitespace-pre-wrap">{parsed.memberFeedback}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs text-slate-500"><span>Scope:</span><span className="font-bold text-slate-700">{String(spec?.scope || p.proposed_scope || "brand_branch")}</span></div><button onClick={()=>setExpanded({...expanded,[p.id]:!isOpen})} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white"><Eye className="w-3 h-3"/>{isOpen?"Hide details":"View details"}{isOpen?<ChevronUp className="w-3 h-3"/>:<ChevronDown className="w-3 h-3"/>}</button></div>
        {isOpen && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3"><div><div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Original member feedback</div><div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{parsed.memberFeedback || p.raw_feedback}</div></div>{Array.isArray(spec?.reject_conditions) && spec.reject_conditions.length>0 && <div><div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600 mb-1">Reject when</div><div className="flex flex-wrap gap-1.5">{spec.reject_conditions.map((x:any,i:number)=><span key={i} className="px-2 py-1 rounded-md bg-white border border-rose-100 text-[11px] text-rose-700">{String(x)}</span>)}</div></div>}{!!p.context_images?.filter(x=>!x.image_url).length && <div><div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Unrendered image references</div><div className="text-[10px] text-slate-400 break-all">{p.context_images?.filter(x=>!x.image_url).map(x=>x.reference_id).filter(Boolean).join(" · ")}</div></div>}</div>}
        {p.status==="pending" && <div className="grid lg:grid-cols-[1fr_auto] gap-3 items-end border-t border-slate-100 pt-4"><textarea value={notes[p.id]||""} onChange={e=>setNotes({...notes,[p.id]:e.target.value})} placeholder="Optional admin note..." className="w-full min-h-16 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/><div className="flex gap-2"><button onClick={()=>decide(p.id,"reject")} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-lg border border-rose-200 text-rose-700 bg-rose-50 disabled:opacity-50">{activeAction?.id===p.id && activeAction.type==="reject" && <RefreshCw className="w-3.5 h-3.5 animate-spin"/>}{activeAction?.id===p.id && activeAction.type==="reject" ? "Rejecting..." : "Reject"}</button><button onClick={()=>decide(p.id,"accept")} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-50">{activeAction?.id===p.id && activeAction.type==="accept" ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <Sparkles className="w-3.5 h-3.5"/>}{activeAction?.id===p.id && activeAction.type==="accept" ? "Accepting & Merging..." : "Accept & Merge"}</button></div></div>}
        {p.status==="accepted" && <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><div className="text-xs text-indigo-700">Legacy accepted proposal from the old flow. New Accept actions merge automatically.</div><button onClick={()=>merge(p.id)} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-50">{activeAction?.id===p.id && activeAction.type==="merge" && <RefreshCw className="w-3.5 h-3.5 animate-spin"/>}{activeAction?.id===p.id && activeAction.type==="merge" ? "Merging..." : "Finish legacy merge"}</button></div>}
        {p.merged_at && <div className="text-xs text-emerald-700 font-semibold">Merged {new Date(p.merged_at).toLocaleString()}</div>}{p.review_note && <div className="text-xs text-slate-500">Admin note: {p.review_note}</div>}
      </article>})}
    </section>
  </main>;
}
