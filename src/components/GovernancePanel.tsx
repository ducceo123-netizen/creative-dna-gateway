import { useEffect, useState } from "react";

type Http = (url:string, init?:RequestInit)=>Promise<Response>;
export function GovernancePanel({request}:{request:Http}) {
 const [registry,setRegistry]=useState<any>({});
 const [loading,setLoading]=useState(false);
 const [message,setMessage]=useState("");
 const [brand,setBrand]=useState("");
 const [branch,setBranch]=useState("onepage-system");
 const [caseKey,setCaseKey]=useState("");
 const [source,setSource]=useState("{}");
 const [expected,setExpected]=useState('{"required_text":[],"forbidden_text":[],"required_keys":[]}');
 const [approved,setApproved]=useState("{}");
 const [proposalId,setProposalId]=useState("");
 const [runs,setRuns]=useState("[]");
 const [evaluationId,setEvaluationId]=useState("");
 const [reviewNotes,setReviewNotes]=useState("");
 const [confirmReview,setConfirmReview]=useState(false);
 const [snapshotId,setSnapshotId]=useState("");
 const [rollbackPreview,setRollbackPreview]=useState<any>(null);
 const refresh=async()=>{
  setLoading(true);
  try {
   const r=await request("/api/admin/governance/governance_list",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
   const data=await r.json();if(!r.ok)throw Error(data.error||"Unable to load");
   setRegistry(data);if(!brand&&data.brands?.length)setBrand(data.brands[0].id);
  }catch(e:any){setMessage(e.message);}finally{setLoading(false);}
 };
 useEffect(()=>{refresh();},[]);
 const act=async(mode:string,payload:object)=>{
  setLoading(true);setMessage("");
  try{
   const r=await request("/api/admin/governance/"+mode,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   const data=await r.json();if(!r.ok)throw Error(data.error||"Governance request failed");
   if(data.evaluation?.id)setEvaluationId(data.evaluation.id);
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
   <button type="button" onClick={refresh} disabled={loading} className="text-xs border rounded-lg px-3 py-2">Refresh</button>
  </div>
  <div className="grid grid-cols-3 gap-2 text-center text-xs">
   <div className="bg-slate-50 p-2 rounded-lg">Baselines <strong className="block">{registry.baselines?.length||0}</strong></div>
   <div className="bg-slate-50 p-2 rounded-lg">Evaluations <strong className="block">{registry.evaluations?.length||0}</strong></div>
   <div className="bg-slate-50 p-2 rounded-lg">Snapshots <strong className="block">{registry.snapshots?.length||0}</strong></div>
  </div>
  <details><summary className="cursor-pointer text-sm font-semibold">1. Register approved baseline</summary>
   <div className="mt-3 grid sm:grid-cols-2 gap-2">
    <select value={brand} onChange={e=>setBrand(e.target.value)} className="border p-2 rounded-lg text-sm"><option value="">Select brand</option>{(registry.brands||[]).map((b:any)=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
    <input value={branch} onChange={e=>setBranch(e.target.value)} className="border p-2 rounded-lg text-sm" placeholder="Material / branch slug"/>
    <input value={caseKey} onChange={e=>setCaseKey(e.target.value)} className="border p-2 rounded-lg text-sm sm:col-span-2" placeholder="Stable baseline case key"/>
   </div>
   <label className="block text-xs mt-2">Approved brief JSON<textarea value={source} onChange={e=>setSource(e.target.value)} className="w-full border p-2 rounded-lg font-mono text-xs" rows={3}/></label>
   <label className="block text-xs mt-2">Expected assertions JSON<textarea value={expected} onChange={e=>setExpected(e.target.value)} className="w-full border p-2 rounded-lg font-mono text-xs" rows={3}/></label>
   <label className="block text-xs mt-2">Approved outcome JSON<textarea value={approved} onChange={e=>setApproved(e.target.value)} className="w-full border p-2 rounded-lg font-mono text-xs" rows={3}/></label>
   <button disabled={loading||!brand||!caseKey} onClick={()=>{try{act("governance_baseline_upsert",{baseline:{brand_id:brand,branch_slug:branch,case_key:caseKey,source_brief:parse(source),expected_assertions:parse(expected),approved_output:parse(approved)}})}catch{setMessage("Invalid JSON");}}} className="border rounded-lg px-3 py-2 text-sm mt-2">Save approved baseline</button>
  </details>
  <details><summary className="cursor-pointer text-sm font-semibold">2. Evaluate proposal against baselines</summary>
   <div className="mt-3 space-y-2">
    <input value={proposalId} onChange={e=>setProposalId(e.target.value)} placeholder="Pending proposal ID" className="border p-2 rounded-lg w-full text-sm"/>
    <p className="text-xs text-slate-500">Provide generated candidate_runs JSON with baseline_id, output, source_run_id and artifact_url. Cases without traceable output are blocked.</p>
    <textarea value={runs} onChange={e=>setRuns(e.target.value)} rows={4} className="border p-2 rounded-lg font-mono text-xs w-full"/>
    <textarea value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)} rows={2} placeholder="Explain product fidelity, visual quality and canonical conflict findings" className="border p-2 rounded-lg text-sm w-full"/>
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmReview} onChange={e=>setConfirmReview(e.target.checked)}/>I verified Product Truth, visual quality, conflicts and zero severe regressions against the supplied output</label>
    <button disabled={loading||!proposalId} className="border rounded-lg px-3 py-2 text-sm" onClick={()=>{try{act("governance_evaluate",{proposal_id:proposalId,candidate_runs:parse(runs),review:{product_truth_verified:confirmReview,visual_reviewed:confirmReview,conflicts_reviewed:confirmReview,critical_regressions:confirmReview?0:-1,review_note:reviewNotes}})}catch{setMessage("Invalid candidate JSON");}}}>Run regression assessment</button>
    {evaluationId&&<p className="text-xs break-all">Latest evaluation ID: <strong>{evaluationId}</strong></p>}
   </div>
  </details>
  <details><summary className="cursor-pointer text-sm font-semibold">3. Rollback an earlier node snapshot</summary>
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
