import { useEffect, useRef, useState } from "react";
import type { CandidateInput, FeedbackPreflight, FeedbackProposal, ReviewBaseline, ReviewEvaluation, ReviewTarget } from "./feedback-review";
import { affectedBrands, allReviewChecks, baselineBrand, baselineName, candidateRuns, currentEvaluation, emptyCandidateInput, emptyReviewChecks, meaningfulNote, missingBaselineBrands, proposalAddition, proposedLines, readableIssue, safeHttpUrl, searchCoveredCandidates, validatePreflight } from "./feedback-review";

export type FeedbackReviewPath = "covered" | "merge";
type Http = (url:string, init?:RequestInit)=>Promise<Response>;
const field = "w-full rounded-lg border border-slate-300 bg-white p-2 text-xs disabled:opacity-60";
const button = "rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const dateLabel = (date?:string|null) => date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString() : "Chưa có ngày xác nhận";

export function EvaluationDetails({ evaluation, issues = [], results, baselines = [], targets = [] }: {
  evaluation:ReviewEvaluation; issues?:string[]; results?:ReviewEvaluation["test_results"]; baselines?:ReviewBaseline[]; targets?:ReviewTarget[];
}) {
  const rows=results || evaluation.test_results || evaluation.results || [];
  const storedIssues=Array.isArray(evaluation.conflict_results)?evaluation.conflict_results.flatMap((item:any)=>Array.isArray(item?.issues)?item.issues:[]):[];
  const allIssues=[...new Set([...issues,...(Array.isArray(evaluation.issues)?evaluation.issues:[]),...storedIssues])];
  return <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs">
    <p className="font-semibold">Kết quả: {evaluation.evaluation_status} · {dateLabel(evaluation.completed_at||evaluation.created_at)}</p>
    {evaluation.critical_failures !== undefined && <p>Regression nghiêm trọng: {evaluation.critical_failures}</p>}
    {allIssues.length>0 && <ul className="list-disc pl-4 text-amber-800">{allIssues.map((issue,i)=><li key={i}>{readableIssue(issue,baselines,targets)}</li>)}</ul>}
    {!rows.length && <p className="text-slate-500">Chưa có kết quả từng baseline. Đây không phải bằng chứng chất lượng đã đạt.</p>}
    {rows.map((row,index)=>{ const base=baselines.find(b=>b.id===row.baseline_id); const link=safeHttpUrl(row.artifact_url); return <div key={row.baseline_id||index} className="border-t border-slate-100 pt-2 space-y-1">
      <p className="font-semibold">{base?`${baselineBrand(base,targets)} · ${baselineName(base)}`:row.case_key?.replace(/[_-]+/g," ")||row.brand_name||`Baseline ${index+1}`} · {row.status||"Chưa xác định"}</p>
      {(row.issues||[]).map((issue,i)=><p key={i} className="text-amber-800">{readableIssue(issue,baselines,targets)}</p>)}
      {link && <a className="text-indigo-700 underline" href={link} target="_blank" rel="noreferrer">Xem candidate artifact</a>}
      {!link && <p className="text-slate-500">Chưa có candidate artifact để đối chiếu.</p>}
    </div>;})}
  </div>;
}

export function CanonicalComparison({data}:{data:FeedbackPreflight}) {
  const addition=proposalAddition(data.proposal);
  return <section className="space-y-3" aria-label="So sánh với quy chuẩn hiện tại">
    <h4 className="font-semibold text-sm">Phạm vi: {affectedBrands(data).join(", ") || "Chưa xác định"}</h4>
    <p className="text-xs text-slate-600">{data.proposal.branch_title||data.proposal.branch_slug||data.targets[0]?.title||data.targets[0]?.slug||"Branch chưa xác định"} · {data.proposal.proposed_scope||"Scope chưa xác định"}. Màu xanh đánh dấu dòng chưa xuất hiện nguyên văn; đây không phải kết luận trùng nghĩa.</p>
    {data.targets.map(target=><div key={target.id} className="rounded-xl border border-slate-200 overflow-hidden">
      <h5 className="bg-slate-100 px-3 py-2 text-xs font-bold">{target.brand_name} · {target.title||target.slug}{target.version!==undefined?` · Phiên bản ${target.version}`:""}</h5>
      <div className="grid lg:grid-cols-2">
        <div className="p-3 border-b lg:border-b-0 lg:border-r border-slate-200"><p className="text-xs font-semibold mb-2">Quy chuẩn hiện tại</p><div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{target.content_md||"Quy chuẩn đang trống."}</div></div>
        <div className="p-3"><p className="text-xs font-semibold mb-2">Nội dung đề xuất bổ sung</p><div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{proposedLines(addition,target.content_md).map((line,index)=><div key={index} className={line.alreadyPresent?"text-slate-500":"bg-emerald-50 text-emerald-900"}><span aria-hidden="true">{line.alreadyPresent?"= ":"+ "}</span>{line.text||" "}</div>)}</div></div>
      </div>
    </div>)}
    {!data.targets.length&&<p role="alert" className="text-xs text-amber-800">Chưa xác định được node canonical bị ảnh hưởng. Không thể hoàn tất review.</p>}
  </section>;
}

export function ResolvedFeedbackAudit({proposal}:{proposal:FeedbackProposal}) {
  const audit=proposal.resolution||{};
  const targets=Array.isArray(audit.targets)?audit.targets:[];
  const brands=[...new Set(targets.map((target:any)=>typeof target.brand_name==="string"?target.brand_name:"").filter(Boolean))];
  const resolvedAt=typeof audit.resolved_at==="string"?audit.resolved_at:proposal.resolved_at;
  const coveredAt=typeof audit.covered_merged_at==="string"?audit.covered_merged_at:null;
  const coveredProposal=audit.covered_proposal&&typeof audit.covered_proposal==="object"?audit.covered_proposal as Record<string,unknown>:{};
  const summary=typeof coveredProposal.change_summary==="string"?coveredProposal.change_summary:"Quy chuẩn đã merge trước đó";
  return <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 space-y-2 text-xs text-indigo-800">
    <p className="font-semibold">Đã có trong quy chuẩn · Feedback đã đóng, canonical không thay đổi.</p>
    <p>Đã đóng: {dateLabel(resolvedAt)}</p>
    {!!brands.length&&<p>Phạm vi đã đối chiếu: {brands.join(", ")}</p>}
    <p>Quy chuẩn đối chiếu: {summary}{coveredAt?` · Đã merge ${dateLabel(coveredAt)}`:""}</p>
    <p>{typeof audit.review_note==="string"?audit.review_note:proposal.review_note||"Đã lưu resolution và audit đối chiếu."}</p>
    {typeof audit.covered_text==="string"&&<details><summary className="cursor-pointer font-semibold">Xem quy tắc nguyên văn đã bao phủ</summary><div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">{audit.covered_text}</div></details>}
    <details><summary className="cursor-pointer font-semibold">Advanced · Resolution audit đầy đủ</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(audit,null,2)}</pre></details>
  </div>;
}

export function FeedbackReviewPanel({proposal, path, request, onClose, onComplete}:{
  proposal:FeedbackProposal; path:FeedbackReviewPath; request:Http; onClose:()=>void;
  onComplete:(message:string, result:Record<string,unknown>)=>void;
}) {
  const [data,setData]=useState<FeedbackPreflight|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<"evaluate"|"covered"|"merge"|null>(null);
  const [error,setError]=useState("");
  const [errorIssues,setErrorIssues]=useState<string[]>([]);
  const [stale,setStale]=useState(false);
  const [selected,setSelected]=useState("");
  const [candidateSearch,setCandidateSearch]=useState("");
  const [coveredScope,setCoveredScope]=useState(false);
  const [safeguards,setSafeguards]=useState(false);
  const [checks,setChecks]=useState(emptyReviewChecks);
  const [note,setNote]=useState("");
  const [evidence,setEvidence]=useState("");
  const [inputs,setInputs]=useState<Record<string,CandidateInput>>({});
  const [latest,setLatest]=useState<{evaluation:ReviewEvaluation;issues:string[];results:ReviewEvaluation["test_results"]}|null>(null);
  const alive=useRef(false);
  const activeRead=useRef<AbortController|null>(null);
  const mutation=useRef(false);
  const requestRef=useRef(request); requestRef.current=request;
  const onCompleteRef=useRef(onComplete); onCompleteRef.current=onComplete;
  const identity=useRef({id:proposal.id,path});
  // A changed proposal/path never renders the previous proposal's fetched data.
  const sameIdentity=identity.current.id===proposal.id&&identity.current.path===path;
  const visibleData=sameIdentity?data:null;

  const resetAttestations=()=>{setSelected("");setCoveredScope(false);setSafeguards(false);setChecks(emptyReviewChecks());};
  const load=async(clearInputs=true)=>{
    activeRead.current?.abort();
    const controller=new AbortController();activeRead.current=controller;
    const current=()=>alive.current&&!controller.signal.aborted&&activeRead.current===controller;
    setLoading(true);setData(null);resetAttestations();setStale(false);
    if(clearInputs){setInputs({});setNote("");setEvidence("");setLatest(null);setCandidateSearch("");}
    try {
      const response=await requestRef.current(`/api/admin/feedback/${encodeURIComponent(proposal.id)}/preflight`,{signal:controller.signal});
      const result=await response.json();
      if(!current())return;
      if(!response.ok)throw Error([result.error||"Không tải được preflight.",...(Array.isArray(result.issues)?result.issues:[])].join(" · "));
      setData(validatePreflight(result,proposal.id));setError("");setErrorIssues([]);
    } catch(e:unknown){if(current())setError(e instanceof Error?e.message:"Không tải được preflight.");}
    finally {if(current()){activeRead.current=null;setLoading(false);}}
  };
  useEffect(()=>{
    alive.current=true;identity.current={id:proposal.id,path};load();
    return ()=>{alive.current=false;activeRead.current?.abort();activeRead.current=null;};
  },[proposal.id,path]);

  const relevantBaselines=(visibleData?.baselines||[]).filter(base=>visibleData?.targets.some(target=>target.brand_id===base.brand_id&&target.slug===base.branch_slug));
  const approvedBaselines=relevantBaselines.filter(base=>!!base.approved_at&&!base.is_reference_only);
  const candidate=visibleData?.covered_candidates.find(item=>item.id===selected);
  const filteredCandidates=searchCoveredCandidates(visibleData?.covered_candidates||[],candidateSearch);
  const evaluation=visibleData&&!stale?currentEvaluation(visibleData):null;
  const missingBrands=visibleData?missingBaselineBrands({...visibleData,baselines:relevantBaselines}):[];
  const runInputs=candidateRuns(approvedBaselines,inputs);
  const evidenceUrls=[...new Set(evidence.split("\n").map(x=>x.trim()).filter(Boolean))];
  const canReview=!!visibleData&&visibleData.proposal.status==="pending"&&visibleData.targets.length>0&&!loading&&!busy&&!stale;
  const canResolve=canReview&&!!candidate&&coveredScope&&safeguards&&meaningfulNote(note);
  const canEvaluate=canReview&&allReviewChecks(checks)&&meaningfulNote(note)&&runInputs.issues.length===0;
  const canMerge=canReview&&!!evaluation&&!visibleData?.issues.length&&!missingBrands.length&&allReviewChecks(checks)&&meaningfulNote(note)&&evidenceUrls.length>0;

  const post=async(action:"covered"|"merge"|"evaluate")=>{
    if(mutation.current||!visibleData||!(action==="covered"?canResolve:action==="merge"?canMerge:canEvaluate))return;
    mutation.current=true;setBusy(action);setError("");setErrorIssues([]);
    const currentId=proposal.id;
    const current=()=>alive.current&&identity.current.id===currentId&&identity.current.path===path;
    const url=action==="evaluate"?"/api/admin/governance/governance_evaluate":`/api/admin/feedback/${encodeURIComponent(currentId)}/${action==="covered"?"resolve-covered":"review"}`;
    const review={product_truth_verified:checks.productTruth,visual_reviewed:checks.visual,conflicts_reviewed:checks.conflicts,critical_regressions:checks.zeroRegressions?0:-1,review_note:note.trim()};
    const payload=action==="covered"?{candidate_hash:visibleData.candidate_hash,covered_proposal_id:candidate!.id,covered_hash:candidate!.candidate_hash,review_note:note.trim()}:
      action==="evaluate"?{proposal_id:currentId,candidate_hash:visibleData.candidate_hash,candidate_runs:runInputs.runs,review}:
      {decision:"accept",candidate_hash:visibleData.candidate_hash,evaluation_id:evaluation!.id,review_note:note.trim(),regression:{evidence_urls:evidenceUrls,baseline_ids:evaluation!.baseline_ids,scope_checked:checks.scope,canonical_conflicts_checked:checks.conflicts,product_truth_verified:checks.productTruth,before_after_reviewed:checks.visual,severe_regressions:checks.zeroRegressions?0:-1,review_note:note.trim()}};
    try {
      const response=await requestRef.current(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();
      if(!current())return;
      if(result.evaluation)setLatest({evaluation:result.evaluation,issues:Array.isArray(result.issues)?result.issues:[],results:result.results||[]});
      if(!response.ok){
        setError(result.error||"Chưa hoàn tất thao tác.");setErrorIssues(Array.isArray(result.issues)?result.issues:[]);
        setStale(true);resetAttestations();return;
      }
      if(action==="evaluate"){
        if(!result.evaluation)throw Error("Chưa nhận được evaluation; cần tải lại trạng thái trước khi thử tiếp.");
        await load(false);
      } else {
        if(action==="covered"&&result.status!=="resolved")throw Error("Chưa xác nhận trạng thái resolved. Tải lại để kiểm tra; không gửi lặp khi kết quả chưa rõ.");
        if(action==="merge"&&(result.proposal?.id!==currentId||result.proposal?.status!=="merged"))throw Error("Chưa xác nhận trạng thái merged cho feedback này. Tải lại để kiểm tra; không gửi lặp khi kết quả chưa rõ.");
        onCompleteRef.current(action==="covered"?"Đã đóng feedback: quy chuẩn hiện có đã bao phủ. Nội dung canonical không thay đổi.":"Đã merge sau review và regression gate. Quy chuẩn đã được cập nhật.",result);
      }
    } catch(e:unknown){if(current()){setError(e instanceof Error?e.message:"Không nhận được kết quả. Tải lại để kiểm tra trạng thái.");setStale(true);resetAttestations();}}
    finally {mutation.current=false;if(current())setBusy(null);}
  };
  const close=()=>{if(mutation.current)return;activeRead.current?.abort();alive.current=false;onClose();};
  const setInput=(id:string,key:keyof CandidateInput,value:string)=>setInputs(previous=>({...previous,[id]:{...(previous[id]||emptyCandidateInput()),[key]:value}}));

  return <section aria-label={path==="covered"?"Đã có trong quy chuẩn":"Review & Merge"} aria-busy={loading||!!busy} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/20 p-4 space-y-4">
    <div className="flex flex-wrap justify-between gap-3 items-center"><h3 className="text-sm font-bold">{path==="covered"?"Đóng feedback đã được quy chuẩn bao phủ":"Review & Merge"}</h3><div className="flex gap-2"><button type="button" className={button} disabled={!!busy||loading} onClick={()=>load()}>Tải lại / Retry</button><button type="button" className={button} disabled={!!busy} onClick={close}>Đóng / Cancel</button></div></div>
    {loading&&<p role="status" className="text-xs text-slate-600">Đang tải quy chuẩn, baseline và kết quả kiểm tra hiện tại…</p>}
    {error&&<div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p className="font-semibold">Chưa hoàn tất thao tác: {readableIssue(error,visibleData?.baselines,visibleData?.targets)}</p>{errorIssues.map((issue,i)=><p key={i}>{readableIssue(issue,visibleData?.baselines,visibleData?.targets)}</p>)}{stale&&<p className="mt-2">Dữ liệu hoặc kết quả thao tác cần được kiểm tra lại. Tải lại / Retry sẽ bỏ lựa chọn và xác nhận cũ trước khi review tiếp.</p>}</div>}
    {visibleData&&<>
      {visibleData.proposal.status!=="pending"&&<p role="alert" className="text-xs text-amber-900">Feedback hiện có trạng thái {visibleData.proposal.status}. Chỉ xem; không thể gửi review mới.</p>}
      <CanonicalComparison data={visibleData}/>
      <section className="space-y-2"><h4 className="text-sm font-semibold">Evidence cần đối chiếu</h4>
        {visibleData.proposal.context_images?.map((item,index)=>{const url=safeHttpUrl(item.image_url);return <div key={index} className="text-xs">{url?<a className="text-indigo-700 underline" href={url} target="_blank" rel="noreferrer">{item.caption||item.role?.replaceAll("_"," ")||`Evidence ${index+1}`}</a>:<span>{item.caption||item.role?.replaceAll("_"," ")||`Evidence ${index+1}`} · Private reference, xem trong phần context</span>}</div>;})}
        {!visibleData.proposal.context_images?.length&&<p className="text-xs text-slate-500">Chưa có ảnh evidence đính kèm.</p>}
        {Object.entries(visibleData.proposal.evidence_summary||{}).filter(([,value])=>typeof value==="string").map(([key,value])=><p key={key} className="text-xs whitespace-pre-wrap"><strong>{key.replaceAll("_"," ")}: </strong>{readableIssue(String(value),visibleData.baselines,visibleData.targets)}</p>)}
      </section>
      {path==="covered"?<section className="space-y-3 border-t border-indigo-100 pt-4">
        <h4 className="font-semibold text-sm">Chọn quy chuẩn đã merge để đối chiếu</h4>
        <p className="text-xs text-slate-600">Chỉ đóng feedback sau khi bạn kiểm tra nội dung và toàn bộ phạm vi. Hệ thống không tự kết luận hai feedback tương đương về nghĩa.</p>
        {!visibleData.covered_candidates.length&&<p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Chưa tìm thấy quy chuẩn đã merge có nguyên văn trong toàn bộ node bị ảnh hưởng. Không thể đóng theo nhánh này. Hãy dùng Review & Merge nếu đây là quy tắc mới.</p>}
        {!!visibleData.covered_candidates.length&&<label className="block text-xs font-semibold">Tìm quy chuẩn đã merge<input className={`${field} mt-1`} aria-label="Tìm quy chuẩn đã merge" type="search" value={candidateSearch} disabled={!canReview} onChange={event=>{setCandidateSearch(event.target.value);setSelected("");setCoveredScope(false);setSafeguards(false);}} placeholder="Tìm theo tóm tắt, nguyên văn quy tắc hoặc ngày YYYY-MM-DD…"/></label>}
        {!!visibleData.covered_candidates.length&&<p className="text-xs text-slate-600">{filteredCandidates.length} / {visibleData.covered_candidates.length} quy chuẩn khớp từ khóa. Hãy chọn một quy chuẩn để đối chiếu.</p>}
        <label className="block text-xs font-semibold">Quy chuẩn đã có<select className={`${field} mt-1`} aria-label="Quy chuẩn đã có" value={selected} disabled={!canReview} onChange={event=>{setSelected(event.target.value);setCoveredScope(false);setSafeguards(false);}}><option value="">Chọn theo tóm tắt và ngày merge…</option>{filteredCandidates.map(item=><option key={item.id} value={item.id}>{item.summary||"Quy chuẩn đã merge"} · {dateLabel(item.merged_at)}</option>)}</select></label>
        {candidate&&<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2"><p className="text-xs font-bold">Quy tắc nguyên văn đã có</p><p className="text-xs">{candidate.brand_names?.join(", ")||affectedBrands(visibleData).join(", ")} · {dateLabel(candidate.merged_at)}</p><div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{candidate.text}</div></div>}
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={coveredScope} disabled={!canReview||!candidate} onChange={event=>setCoveredScope(event.target.checked)}/><span>Tôi đã đối chiếu từng brand ({affectedBrands(visibleData).join(", ")}) và xác nhận quy tắc đã chọn bao phủ đúng toàn bộ phạm vi feedback.</span></label>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={safeguards} disabled={!canReview||!candidate} onChange={event=>setSafeguards(event.target.checked)}/><span>Tôi đã đọc nguyên văn và xác nhận các điều kiện bảo vệ hiện có được giữ nguyên; feedback không yêu cầu thêm hoặc thay đổi quy tắc.</span></label>
        <label className="block text-xs font-semibold">Lý do đóng feedback (ít nhất 20 ký tự)<textarea className={`${field} mt-1`} aria-label="Lý do đóng feedback" rows={3} value={note} disabled={!!busy} onChange={event=>setNote(event.target.value)} placeholder="Nêu quy tắc nào đã bao phủ feedback và vì sao phạm vi khớp…"/></label>
        <p className="text-xs text-slate-600">Thao tác chỉ ghi resolution/audit cho feedback; giữ nguyên canonical và không tạo evaluation đạt giả.</p>
        <button type="button" className={`${button} bg-indigo-700 text-white border-indigo-700`} disabled={!canResolve} onClick={()=>post("covered")}>{busy==="covered"?"Đang đóng feedback…":"Xác nhận đã có trong quy chuẩn"}</button>
      </section>:<section className="space-y-4 border-t border-indigo-100 pt-4">
        <h4 className="text-sm font-semibold">Baseline và công việc còn thiếu</h4>
        <p className="text-xs text-amber-900">Các baseline reference corpus PawfectHouse và GiftSoul chỉ kiểm tra tài liệu tham chiếu/cấu trúc. Chúng không chứng minh toàn bộ chất lượng creative, product fidelity hay visual đã đạt. Cần candidate artifact thật và review của Admin.</p>
        {missingBrands.length>0&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Blocked: chưa có baseline được duyệt cho {missingBrands.join(", ")}. Cần đăng ký baseline phù hợp và chạy candidate thật trước khi merge.</p>}
        {visibleData.issues.length>0&&<ul className="list-disc pl-4 text-xs text-amber-900">{visibleData.issues.map((issue,i)=><li key={i}>{readableIssue(issue,visibleData.baselines,visibleData.targets)}</li>)}</ul>}
        {!relevantBaselines.length&&<p className="text-xs text-amber-900">Chưa có baseline trong phạm vi hiện tại.</p>}
        {relevantBaselines.map(base=>{const input=inputs[base.id]||emptyCandidateInput();return <div key={base.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          <p className="text-xs font-bold">{baselineBrand(base,visibleData.targets)} · {baselineName(base)}</p>
          <p className="text-xs text-slate-500">{base.approved_at?`Đã duyệt ${dateLabel(base.approved_at)}`:"Chưa được duyệt; không đủ điều kiện chạy/merge"}</p>
          {base.is_reference_only&&<p className="text-xs text-amber-800">Reference corpus / chỉ tham chiếu. Cần baseline chất lượng candidate riêng; reference này không đủ điều kiện merge.</p>}
          {base.approved_at&&!base.is_reference_only&&<>
            <div className="grid sm:grid-cols-2 gap-2"><label className="text-xs">Mã lần chạy candidate thật<input className={`${field} mt-1`} value={input.source_run_id} disabled={!canReview} onChange={event=>setInput(base.id,"source_run_id",event.target.value)} placeholder="Source run ID từ công cụ tạo output"/></label><label className="text-xs">Candidate artifact URL<input className={`${field} mt-1`} type="url" value={input.artifact_url} disabled={!canReview} onChange={event=>setInput(base.id,"artifact_url",event.target.value)} placeholder="https://…"/></label></div>
            <details><summary className="cursor-pointer text-xs font-semibold">Advanced · Output JSON và baseline reference</summary><div className="mt-2 space-y-2"><label className="text-xs">Output JSON thực tế của lần chạy này<textarea className={`${field} mt-1 font-mono`} rows={5} value={input.output} disabled={!canReview} onChange={event=>setInput(base.id,"output",event.target.value)} placeholder="Dán output JSON object từ lần chạy thật"/></label><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify({baseline_id:base.id,source_brief:base.source_brief,approved_output:base.approved_output,expected_assertions:base.expected_assertions},null,2)}</pre></div></details>
          </>}
        </div>;})}
        {!evaluation&&<div className="text-xs text-amber-900"><p className="font-semibold">Chưa có evaluation đạt còn hiệu lực để tự động liên kết.</p>{runInputs.issues.map((issue,i)=><p key={i}>{issue}</p>)}</div>}
        {evaluation&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">Đã tự động liên kết evaluation đạt, khớp nội dung và phạm vi hiện tại. Hãy hoàn tất xác nhận review trước khi merge.</p>}
        {latest&&<div><h5 className="text-xs font-bold mb-2">Lần kiểm tra vừa chạy</h5><EvaluationDetails {...latest} baselines={visibleData.baselines} targets={visibleData.targets}/></div>}
        {visibleData.evaluations.length>0&&<div className="space-y-2"><h5 className="text-xs font-bold">Các lần kiểm tra gần đây</h5>{visibleData.evaluations.slice(0,5).map(item=><div key={item.id}>{item.candidate_hash!==visibleData.candidate_hash&&<p className="text-xs text-amber-800">Evaluation đã cũ: nội dung hoặc phạm vi hiện tại không còn khớp.</p>}<EvaluationDetails evaluation={item} baselines={visibleData.baselines} targets={visibleData.targets}/></div>)}</div>}
        <div className="space-y-2">{([
          ["scope",`Tôi đã kiểm tra phạm vi của tất cả brand: ${affectedBrands(visibleData).join(", ")}.`],
          ["productTruth","Tôi đã xác minh Product Truth từ nguồn sản phẩm thật."],
          ["visual","Tôi đã xem candidate artifact và so sánh before/after với từng baseline."],
          ["conflicts","Tôi đã đọc và kiểm tra xung đột với canonical hiện tại."],
          ["zeroRegressions","Tôi xác nhận không có regression nghiêm trọng (0 critical regressions)."],
        ] as const).map(([key,label])=><label key={key} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={checks[key]} disabled={!canReview} onChange={event=>setChecks(previous=>({...previous,[key]:event.target.checked}))}/><span>{label}</span></label>)}</div>
        <label className="block text-xs font-semibold">Ghi chú review (ít nhất 20 ký tự)<textarea className={`${field} mt-1`} aria-label="Ghi chú review" rows={3} value={note} disabled={!!busy} onChange={event=>setNote(event.target.value)} placeholder="Nêu kết quả product fidelity, visual, phạm vi và xung đột đã kiểm tra…"/></label>
        <label className="block text-xs font-semibold">Evidence đã đối chiếu (mỗi dòng một URL hoặc reference ID)<textarea className={`${field} mt-1`} aria-label="Evidence đã đối chiếu" rows={2} value={evidence} disabled={!!busy} onChange={event=>setEvidence(event.target.value)} placeholder="Nguồn sản phẩm, reference và candidate artifact đã xem…"/></label>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!canEvaluate} onClick={()=>post("evaluate")}>{busy==="evaluate"?"Đang kiểm tra…":"Chạy kiểm tra candidate thật"}</button><button type="button" className={`${button} bg-emerald-700 text-white border-emerald-700`} disabled={!canMerge} onClick={()=>post("merge")}>{busy==="merge"?"Đang merge…":"Xác nhận Review & Merge"}</button></div>
        {!canMerge&&<p className="text-xs text-slate-600">Merge chỉ mở khi có evaluation đạt còn hiệu lực, đủ baseline của mọi brand, evidence, ghi chú và từng xác nhận review. Tải lại hoặc chạy evaluation sẽ xóa các xác nhận cũ.</p>}
      </section>}
      <details><summary className="cursor-pointer text-xs font-semibold">Advanced · IDs, hashes và dữ liệu đầy đủ</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify({preflight:visibleData,latest_evaluation:latest,action_error:error,action_issues:errorIssues},null,2)}</pre></details>
    </>}
  </section>;
}
