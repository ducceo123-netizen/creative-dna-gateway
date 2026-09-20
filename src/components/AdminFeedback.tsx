import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, LogIn, LogOut, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type Proposal = {
  id: string;
  status: string;
  brand_name?: string;
  branch_title?: string;
  submitted_by_name?: string;
  raw_feedback?: string;
  proposed_scope?: string;
  created_at?: string;
  reviewed_at?: string;
  review_note?: string;
};

export function AdminFeedback({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState(() => sessionStorage.getItem("creative_dna_admin_token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [filter, setFilter] = useState("pending");

  const filtered = useMemo(() => filter === "all" ? proposals : proposals.filter(p => p.status === filter), [proposals, filter]);

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
    } catch(e:any) { setMessage(e.message); } finally { setAuthLoading(false); }
  };

  const logout = () => { sessionStorage.removeItem("creative_dna_admin_token"); setToken(""); setProposals([]); setMessage("Signed out."); };

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

  const decide = async (id:string, decision:"accept"|"reject") => {
    setLoading(true); setMessage("");
    try {
      const res = await fetch(`/api/admin/feedback/${id}/review`, {
        method:"POST",
        headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token.trim()}` },
        body:JSON.stringify({ decision, review_note:notes[id] || "" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setMessage(decision === "accept" ? "Accepted. Canonical DNA is still unchanged until explicit merge." : "Rejected. Canonical DNA was not changed.");
      await load();
    } catch(e:any){ setMessage(e.message); setLoading(false); }
  };

  useEffect(() => { if (token) load(); }, []);

  return <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4"/>Back to Creative DNA</button>
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-600"/><h1 className="text-2xl font-extrabold text-slate-900">Admin Feedback Queue</h1></div>
          <p className="text-sm text-slate-500 mt-1">Review member Train submissions. Accept does not mutate canonical DNA; merge remains a separate admin step.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading?"animate-spin":""}`}/>Refresh</button>
      </div>
      {!token ? <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3">
        <input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Admin email" className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
        <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") login();}} placeholder="Password" className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
        <button onClick={login} disabled={authLoading} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"><LogIn className="w-4 h-4"/>{authLoading?"Signing in...":"Sign in"}</button>
      </div> : <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex gap-1">{["pending","accepted","rejected","all"].map(x=><button key={x} onClick={()=>setFilter(x)} className={`px-3 py-2 text-xs font-semibold rounded-lg border ${filter===x?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-200"}`}>{x}</button>)}</div>
        <button onClick={logout} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600"><LogOut className="w-3.5 h-3.5"/>Sign out</button>
      </div>}
      {message && <div className="text-xs p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">{message}</div>}
    </section>
    <section className="space-y-3">
      {!loading && filtered.length===0 && <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">No {filter==="all"?"":filter} feedback proposals.</div>}
      {filtered.map(p=><article key={p.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div><div className="text-sm font-bold text-slate-900">{p.brand_name || "Brand"} <span className="text-slate-300">/</span> {p.branch_title || "Branch"}</div><div className="text-xs text-slate-500 mt-1">{p.submitted_by_name || "Member"} · {p.created_at ? new Date(p.created_at).toLocaleString() : ""}</div></div>
          <span className={`inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${p.status==="pending"?"bg-amber-50 text-amber-700":p.status==="accepted"?"bg-emerald-50 text-emerald-700":"bg-rose-50 text-rose-700"}`}>{p.status==="pending"?<Clock3 className="w-3 h-3"/>:p.status==="accepted"?<CheckCircle2 className="w-3 h-3"/>:<XCircle className="w-3 h-3"/>}{p.status}</span>
        </div>
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 text-sm leading-relaxed whitespace-pre-wrap">{p.raw_feedback}</div>
        <div className="text-xs text-slate-500">Proposed scope: <span className="font-semibold text-slate-700">{p.proposed_scope || "brand_branch"}</span></div>
        {p.status==="pending" && <div className="space-y-2">
          <textarea value={notes[p.id]||""} onChange={e=>setNotes({...notes,[p.id]:e.target.value})} placeholder="Optional admin review note..." className="w-full min-h-20 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"/>
          <div className="flex gap-2 justify-end"><button onClick={()=>decide(p.id,"reject")} disabled={loading} className="px-3 py-2 text-xs font-semibold rounded-lg border border-rose-200 text-rose-700 bg-rose-50">Reject</button><button onClick={()=>decide(p.id,"accept")} disabled={loading} className="px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white">Accept for Merge</button></div>
        </div>}
        {p.review_note && <div className="text-xs text-slate-500">Admin note: {p.review_note}</div>}
      </article>)}
    </section>
  </main>;
}
