import { useEffect, useState } from "react";
import { EvaluationDetails } from "./FeedbackReviewPanel";

type Http = (url:string, init?:RequestInit)=>Promise<Response>;
export function GovernancePanel({request}:{request:Http}) {
 const [registry,setRegistry]=useState<any>(null);
 const [loading,setLoading]=useState(true);
 const [refreshing,setRefreshing]=useState(true);
 const [loadError,setLoadError]=useState("");
 const [message,setMessage]=useState("");
 const [latestEvaluation,setLatestEvaluation]=useState<any>(null);
 const [brand,setBrand]=useState("");
 const [branch,setBranch]=useState("onepage-system");
 const [caseKey,setCaseKey]=useState("");
 const [source,setSource]=useState("{}");
 const [expected,setExpected]=useState('{"required_text":[],"forbidden_text":[],"required_keys":[]}');
 const [approved,setApproved]=useState("{}");
 const [snapshotId,setSnapshotId]=useState("");
 const [rollbackProposalId,setRollbackProposalId]=useState("");
 const [proposalPreview,setProposalPreview]=useState<any>(null);
 const [rollbackPreview,setRollbackPreview]=useState<any>(null);
 const refresh=async()=>{
  setLoading(true);setRefreshing(true);
  try {
   const r=await request("/api/admin/governance/governance_list",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
   const data=await r.json();if(!r.ok)throw Error(data?.error||"Unable to load");
   if(!["baselines","evaluations","snapshots","brands"].every(key=>Array.isArray(data?.[key])))throw Error("Incomplete governance registry response");
   setRegistry(data);setLoadError("");if(!brand&&data.brands?.length)setBrand(data.brands[0].id);
  }catch(e:any){setLoadError(e?.message||"Unable to load governance data");}finally{setLoading(false);setRefreshing(false);}
 };
 useEffect(()=>{refresh();},[]);
 const act=async(mode:string,payload:object)=>{
  setLoading(true);setMessage("");
  try{
   const r=await request("/api/admin/governance/"+mode,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   const data=await r.json();
   if(data.evaluation)setLatestEvaluation({evaluation:data.evaluation,issues:data.issues||[],results:data.results||[]});
   if(!r.ok)throw Error([data.error||"Governance request failed",...(Array.isArray(data.issues)?data.issues:[])].join(" · "));
   if(data.current_md5)setRollbackPreview(data);
   setMessage(mode+" completed: "+(data.evaluation?.evaluation_status||"OK"));
   if(mode!=="governance_rollback_preview")await refresh();
  }catch(e:any){setMessage(e.message);}finally{setLoading(false);}
 };
 const parse=(s:string)=>JSON.parse(s);
 return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
  <div className="flex items-center justify-between">
   <div><h2 className="font-bold text-sm text-slate-900">Knowledge Governance</h2>
    <p className="text-xs text-slate-500">Baseline · Regression · Version & rollback</p></div>
   <button type="button" onClick={refresh} disabled={loading} className="text-xs border rounded-lg px-3 py-2">{refreshing?"Loading…":loadError?"Retry":"Refresh"}</button>
  </div>
  {refreshing&&<p role="status" className="text-xs text-slate-500">{registry?"Refreshing governance data… Previously loaded counts remain visible.":"Loading governance data… Counts are not yet available."}</p>}
  {!!loadError&&<p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{registry?"Refresh failed. Showing previously loaded governance data, which may be out of date.":"Unable to load governance data. Counts are unavailable."} {loadError}</p>}
  <div className="grid grid-cols-3 gap-2 text-center text-xs">
   <div className="bg-slate-50 p-2 rounded-lg">Baselines <strong className="block">{registry?.baselines?.length??"—"}</strong></div>
   <div className="bg-slate-50 p-2 rounded-lg">Evaluations <strong className="block">{registry?.evaluations?.length??"—"}</strong></div>
   <div className="bg-slate-50 p-2 rounded-lg">Snapshots <strong className="block">{registry?.snapshots?.length??"—"}</strong></div>
  </div>
  <details><summary className="cursor-pointer text-sm font-semibold">1. Register approved baseline</summary>
   <div className="mt-3 grid sm:grid-cols-2 gap-2">
    <select value={brand} onChange={e=>setBrand(e.target.value)} className="border p-2 rounded-lg text-sm"><option value="">Select brand</option>{(registry?.brands||[]).map((b:any)=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
    <input value={branch} onChange={e=>setBranch(e.target.value)} className="border p-2 rounded-lg text-sm" placeholder="Material / branch slug"/>
    <input value={caseKey} onChange={e=>setCaseKey(e.target.value)} className="border p-2 rounded-lg text-sm sm:col-span-2" placeholder="Stable baseline case key"/>
   </div>
   <label className="block text-xs mt-2">Approved brief JSON<textarea value={source} onChange={e=>setSource(e.target.value)} className="w-full border p-2 rounded-lg font-mono text-xs" rows={3}/></label>
   <label className="block text-xs mt-2">Expected assertions JSON<textarea value={expected} onChange={e=>setExpected(e.target.value)} className="w-full border p-2 rounded-lg font-mono text-xs" rows={3}/></label>
   <label className="block text-xs mt-2">Approved outcome JSON<textarea value={approved} onChange={e=>setApproved(e.target.value)} className="w-full border p-2 rounded-lg font-mono text-xs" rows={3}/></label>
   <button disabled={loading||!brand||!caseKey} onClick={()=>{try{act("governance_baseline_upsert",{baseline:{brand_id:brand,branch_slug:branch,case_key:caseKey,source_brief:parse(source),expected_assertions:parse(expected),approved_output:parse(approved)}})}catch{setMessage("Invalid JSON");}}} className="border rounded-lg px-3 py-2 text-sm mt-2">Save approved baseline</button>
  </details>
  <details><summary className="cursor-pointer text-sm font-semibold">2. Evaluation history · Kết quả chi tiết</summary>
   <div className="mt-3 space-y-3">
    <p className="text-xs text-slate-600">Dùng Review &amp; Merge ngay trên card feedback để xem canonical, chọn candidate thật và liên kết đúng phiên bản nội dung. Không cần sao chép evaluation ID.</p>
    {latestEvaluation&&<EvaluationDetails {...latestEvaluation} baselines={registry?.baselines||[]}/>}
    {(registry?.evaluations||[]).slice(0,10).map((evaluation:any)=><div key={evaluation.id} className="space-y-2"><EvaluationDetails evaluation={evaluation} baselines={(registry?.baselines||[]).map((baseline:any)=>({...baseline,brand_name:baseline.brand_name||registry?.brands?.find((brand:any)=>brand.id===baseline.brand_id)?.name}))}/><details><summary className="text-xs cursor-pointer">Advanced · Evaluation IDs và dữ liệu đầy đủ</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(evaluation,null,2)}</pre></details></div>)}
    {registry&&!registry.evaluations.length&&<p className="text-xs text-slate-500">Chưa có evaluation. Thiếu kết quả không có nghĩa là đã đạt.</p>}
   </div>
  </details>
  <details><summary className="cursor-pointer text-sm font-semibold">3. Rollback an earlier node snapshot</summary>
   <div className="mt-3 space-y-2 border-b pb-3">
    <p className="text-xs text-slate-500">Recommended: rollback an entire merged proposal across all affected brands as one transaction.</p>
    <input value={rollbackProposalId} onChange={e=>{setRollbackProposalId(e.target.value);setProposalPreview(null);}} placeholder="Merged proposal ID" className="border p-2 rounded-lg text-sm w-full"/>
    <button disabled={!rollbackProposalId||loading} onClick={async()=>{try{const r=await request("/api/admin/governance/governance_rollback_proposal_preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({proposal_id:rollbackProposalId})});const d=await r.json();if(!r.ok)throw Error(d.error);setProposalPreview(d);}catch(e:any){setMessage(e.message);}}} className="border rounded-lg px-3 py-2 text-sm">Preview all affected nodes</button>
    {proposalPreview&&<div className="text-xs space-y-2"><p>{proposalPreview.affected_nodes?.length||0} affected node(s)</p>
      <p>{proposalPreview.affected_nodes?.map((x:any)=>x.slug).join(", ")}</p>
      <button disabled={loading} className="border border-red-300 rounded-lg px-3 py-2" onClick={()=>{if(confirm("Restore ALL affected nodes to pre-merge state? This cannot overwrite newer changes."))act("governance_rollback_proposal",{proposal_id:rollbackProposalId});}}>Rollback entire proposal</button>
    </div>}
   </div>
   <div className="mt-3 space-y-2">
    <p className="text-xs text-slate-500">Rollback is guarded by current-node fingerprint. Inspect impact before confirming; newer changes must not be overwritten.</p>
    <input value={snapshotId} onChange={e=>{setSnapshotId(e.target.value);setRollbackPreview(null);}} placeholder="Before snapshot ID" className="border p-2 rounded-lg text-sm w-full"/>
    <button disabled={!snapshotId||loading} onClick={()=>act("governance_rollback_preview",{snapshot_id:snapshotId})} className="border rounded-lg px-3 py-2 text-sm">Preview rollback</button>
    {rollbackPreview&&<div className="text-xs space-y-2"><p>Node: {rollbackPreview.snapshot?.node_id}</p><button className="rounded-lg border border-red-300 px-3 py-2" disabled={loading} onClick={()=>{if(confirm("Restore this snapshot? This changes canonical content."))act("governance_rollback",{snapshot_id:snapshotId,expected_current_md5:rollbackPreview.current_md5})}}>Confirm restore</button></div>}
   </div>
  </details>
  {!!message&&<p role="status" className="text-xs text-slate-600">{message}</p>}
  <p className="text-[11px] text-slate-500">Mechanical assertions are evaluated automatically; visual quality remains explicitly human-reviewed. Unapproved or missing baselines cannot pass.</p>
 </section>;
}
