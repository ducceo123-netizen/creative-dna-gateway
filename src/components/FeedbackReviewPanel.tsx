import { useEffect, useRef, useState } from "react";
import type { ReviewRequest, FeedbackPreflight, FeedbackProposal, ReviewBaseline, ReviewEvaluation, ReviewTarget } from "./feedback-review";
import { affectedBrands, baselineBrand, baselineName, meaningfulNote, proposalAddition, proposedLines, readableIssue, safeHttpUrl, searchCoveredCandidates, validateReviewRequest, validatePreflight } from "./feedback-review";

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
      <h5 className="bg-slate-100 px-3 py-2 text-xs font-bold">{target.brand_name} · {target.title||target.slug}{target.version!==undefined?` · Phiên bản ${target.version}`:""}{target.status&&target.status!=="active"?` · ${target.status}`:""}</h5>
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

export function FeedbackReviewPanel({proposal, path, request, onClose, onComplete, onBusyChange}:{
  proposal:FeedbackProposal; path:FeedbackReviewPath; request:Http; onClose:()=>void;
  onComplete:(message:string, result:Record<string,unknown>)=>void;
  onBusyChange?:(busy:boolean)=>void;
}) {
  const [data,setData]=useState<FeedbackPreflight|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<"covered"|"process"|"rule"|"cancel"|null>(null);
  const [error,setError]=useState("");
  const [errorIssues,setErrorIssues]=useState<string[]>([]);
  const [stale,setStale]=useState(false);
  const [selected,setSelected]=useState("");
  const [candidateSearch,setCandidateSearch]=useState("");
  const [coveredScope,setCoveredScope]=useState(false);
  const [safeguards,setSafeguards]=useState(false);
  const [note,setNote]=useState("");
  const [queueRequest,setQueueRequest]=useState<ReviewRequest|null|undefined>(undefined);
  const alive=useRef(false);
  const activeRead=useRef<AbortController|null>(null);
  const mutation=useRef(false);
  const requestRef=useRef(request); requestRef.current=request;
  const onCompleteRef=useRef(onComplete); onCompleteRef.current=onComplete;
  const onBusyChangeRef=useRef(onBusyChange); onBusyChangeRef.current=onBusyChange;
  const identity=useRef({id:proposal.id,path});
  // A changed proposal/path never renders the previous proposal's fetched data.
  const sameIdentity=identity.current.id===proposal.id&&identity.current.path===path;
  const visibleData=sameIdentity?data:null;

  const resetAttestations=()=>{setSelected("");setCoveredScope(false);setSafeguards(false);};
  const load=async(clearInputs=true)=>{
    activeRead.current?.abort();
    const controller=new AbortController();activeRead.current=controller;
    const current=()=>alive.current&&!controller.signal.aborted&&activeRead.current===controller;
    setLoading(true);setData(null);resetAttestations();setStale(false);
    if(clearInputs){setNote("");setQueueRequest(undefined);setCandidateSearch("");}
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
    alive.current=true;identity.current={id:proposal.id,path};setBusy(null);load();
    return ()=>{alive.current=false;activeRead.current?.abort();activeRead.current=null;};
  },[proposal.id,path]);

  const candidate=visibleData?.covered_candidates.find(item=>item.id===selected);
  const filteredCandidates=searchCoveredCandidates(visibleData?.covered_candidates||[],candidateSearch);
  const automatic=visibleData?.automatic_review;
  const currentRequest=queueRequest===undefined?visibleData?.review_request:queueRequest;
  const activeRequest=!!currentRequest&&["queued","leased","blocked"].includes(currentRequest.status);
  const canReview=!!visibleData&&visibleData.proposal.status==="pending"&&visibleData.targets.length>0&&!loading&&!busy&&!stale;
  const canResolve=canReview&&!!candidate&&coveredScope&&safeguards&&meaningfulNote(note);
  const canCancel=!!visibleData&&activeRequest&&!loading&&!busy&&!stale;
  const canAcceptRule=canReview&&visibleData?.direct_rule?.eligible===true&&visibleData.direct_rule_plan?.eligible===true;
  const canProcess=canReview&&visibleData?.queue_available!==false&&!!automatic&&!!visibleData?.review_intent_hash&&!activeRequest;

  const post=async(action:"covered"|"process"|"rule"|"cancel")=>{
    if(mutation.current||!visibleData||!(action==="covered"?canResolve:action==="rule"?canAcceptRule:action==="cancel"?canCancel:canProcess))return;
    mutation.current=true;onBusyChangeRef.current?.(true);setBusy(action);setError("");setErrorIssues([]);
    const currentId=proposal.id;
    const operationIdentity=identity.current;
    const current=()=>alive.current&&identity.current===operationIdentity;
    const url=`/api/admin/feedback/${encodeURIComponent(currentId)}/${action==="covered"?"resolve-covered":action==="rule"?"accept-rule":action==="cancel"?"cancel-review":"process"}`;
    const payload=action==="covered"?{candidate_hash:visibleData.candidate_hash,covered_proposal_id:candidate!.id,covered_hash:candidate!.candidate_hash,review_note:note.trim()}:
      action==="rule"?{approve_rule:true,candidate_hash:visibleData.candidate_hash,rule_hash:visibleData.direct_rule!.rule_hash,plan_hash:visibleData.direct_rule_plan!.plan_hash}:
      action==="cancel"?{request_id:currentRequest!.id}:{approve:true,review_intent_hash:visibleData.review_intent_hash};
    try {
      const response=await requestRef.current(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();
      if(!current())return;
      if(!response.ok){
        setError(result.error||"Chưa hoàn tất thao tác.");setErrorIssues(Array.isArray(result.issues)?result.issues:[]);
        setStale(true);resetAttestations();return;
      }
      if(action==="cancel"||(action==="process"&&result.status!=="merged")) {
        const request=validateReviewRequest(result.review_request,currentId);
        if(!request||result.canonical_changed!==false||
          (action==="cancel"?request.status!=="cancelled"||request.id!==currentRequest?.id:
            result.status!==request.status||result.approval_recorded!==true||!["queued","leased","blocked"].includes(request.status)))
          throw Error("Chưa xác nhận trạng thái hàng đợi. Tải lại để kiểm tra; không gửi lặp khi kết quả chưa rõ.");
        setQueueRequest(request);
      } else {
        if(action==="covered"&&result.status!=="resolved")throw Error("Chưa xác nhận trạng thái resolved. Tải lại để kiểm tra; không gửi lặp khi kết quả chưa rõ.");
        if((action==="process"||action==="rule")&&(result.proposal?.id!==currentId||result.proposal?.status!=="merged"||result.canonical_changed!==true))throw Error("Chưa xác nhận trạng thái merged cho feedback này. Tải lại để kiểm tra; không gửi lặp khi kết quả chưa rõ.");
        if(action==="process"&&(result.decision_kind==="owner_direct_rule"||result.rule_decision_id!==undefined))throw Error("Kết quả duyệt rule không phải kết quả review outcome. Hãy tải lại.");
        if(action==="rule"&&(result.status!=="merged"||result.decision_kind!=="owner_direct_rule"||result.visual_qc_performed!==false||typeof result.rule_decision_id!=="string"||!result.rule_decision_id||typeof result.proposal?.merged_at!=="string"||!Number.isFinite(Date.parse(result.proposal.merged_at))||result.candidate_hash!==visibleData.candidate_hash||result.rule_hash!==visibleData.direct_rule?.rule_hash||result.plan_hash!==visibleData.direct_rule_plan?.plan_hash))throw Error("Chưa xác nhận đúng quyết định duyệt rule. Hãy tải lại.");
        onCompleteRef.current(action==="rule"?"Đã merge rule do bạn duyệt trực tiếp. Đã lưu lịch sử và snapshot để rollback; đây không phải kết quả QC hình ảnh.":action==="covered"?"Đã đóng feedback: quy chuẩn hiện có đã bao phủ. Nội dung canonical không thay đổi.":"Đã merge: kiểm tra tự động và review đã lưu đều hợp lệ. Quy chuẩn đã được cập nhật.",result);
      }
    } catch(e:unknown){if(current()){setError(e instanceof Error?e.message:"Không nhận được kết quả. Tải lại để kiểm tra trạng thái.");setStale(true);resetAttestations();}}
    finally {mutation.current=false;if(current()){setBusy(null);onBusyChangeRef.current?.(false);}}
  };
  const close=()=>{if(mutation.current)return;activeRead.current?.abort();alive.current=false;onClose();};

  return <section aria-label={path==="covered"?"Đã có trong quy chuẩn":"Duyệt & xử lý"} aria-busy={loading||!!busy} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/20 p-4 space-y-4">
    <div className="flex flex-wrap justify-between gap-3 items-center"><h3 className="text-sm font-bold">{path==="covered"?"Đóng feedback đã được quy chuẩn bao phủ":"Duyệt & xử lý"}</h3><div className="flex gap-2"><button type="button" className={button} disabled={!!busy||loading} onClick={()=>load()}>Tải lại / Retry</button><button type="button" className={button} disabled={!!busy} onClick={close}>Đóng / Cancel</button></div></div>
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
        {!visibleData.covered_candidates.length&&<p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Chưa tìm thấy quy chuẩn đã merge có nguyên văn trong toàn bộ node bị ảnh hưởng. Không thể đóng theo nhánh này. Hãy dùng Xem & duyệt nếu đây là quy tắc mới.</p>}
        {!!visibleData.covered_candidates.length&&<label className="block text-xs font-semibold">Tìm quy chuẩn đã merge<input className={`${field} mt-1`} aria-label="Tìm quy chuẩn đã merge" type="search" value={candidateSearch} disabled={!canReview} onChange={event=>{setCandidateSearch(event.target.value);setSelected("");setCoveredScope(false);setSafeguards(false);}} placeholder="Tìm theo tóm tắt, nguyên văn quy tắc hoặc ngày YYYY-MM-DD…"/></label>}
        {!!visibleData.covered_candidates.length&&<p className="text-xs text-slate-600">{filteredCandidates.length} / {visibleData.covered_candidates.length} quy chuẩn khớp từ khóa. Hãy chọn một quy chuẩn để đối chiếu.</p>}
        <label className="block text-xs font-semibold">Quy chuẩn đã có<select className={`${field} mt-1`} aria-label="Quy chuẩn đã có" value={selected} disabled={!canReview} onChange={event=>{setSelected(event.target.value);setCoveredScope(false);setSafeguards(false);}}><option value="">Chọn theo tóm tắt và ngày merge…</option>{filteredCandidates.map(item=><option key={item.id} value={item.id}>{item.summary||"Quy chuẩn đã merge"} · {dateLabel(item.merged_at)}</option>)}</select></label>
        {candidate&&<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2"><p className="text-xs font-bold">Quy tắc nguyên văn đã có</p><p className="text-xs">{candidate.brand_names?.join(", ")||affectedBrands(visibleData).join(", ")} · {dateLabel(candidate.merged_at)}</p><div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{candidate.text}</div></div>}
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={coveredScope} disabled={!canReview||!candidate} onChange={event=>setCoveredScope(event.target.checked)}/><span>Tôi đã đối chiếu từng brand ({affectedBrands(visibleData).join(", ")}) và xác nhận quy tắc đã chọn bao phủ đúng toàn bộ phạm vi feedback.</span></label>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={safeguards} disabled={!canReview||!candidate} onChange={event=>setSafeguards(event.target.checked)}/><span>Tôi đã đọc nguyên văn và xác nhận các điều kiện bảo vệ hiện có được giữ nguyên; feedback không yêu cầu thêm hoặc thay đổi quy tắc.</span></label>
        <label className="block text-xs font-semibold">Lý do đóng feedback (ít nhất 20 ký tự)<textarea className={`${field} mt-1`} aria-label="Lý do đóng feedback" rows={3} value={note} disabled={!!busy} onChange={event=>setNote(event.target.value)} placeholder="Nêu quy tắc nào đã bao phủ feedback và vì sao phạm vi khớp…"/></label>
        <p className="text-xs text-slate-600">Thao tác chỉ ghi resolution/audit cho feedback; giữ nguyên canonical và không tạo evaluation đạt giả.</p>
        <button type="button" className={`${button} bg-indigo-700 text-white border-indigo-700`} disabled={!canResolve} onClick={()=>post("covered")}>{busy==="covered"?"Đang đóng feedback…":"Xác nhận đã có trong quy chuẩn"}</button>
      </section>:<section className="space-y-4 border-t border-indigo-100 pt-4" aria-label="Tự kiểm tra feedback">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-3" aria-label="Duyệt rule trực tiếp">
          <h4 className="text-sm font-bold">Duyệt rule trực tiếp</h4>
          <p className="text-xs">Áp dụng đúng rule và toàn bộ phạm vi đang hiển thị. Với phạm vi được hỗ trợ, hệ thống kiểm tra cấu trúc, phiên bản và các xung đột có thể phát hiện; lưu quyết định của bạn cùng lịch sử rollback.</p>
          <p className="text-xs text-slate-600">Luồng này không chứng nhận outcome hay QC hình ảnh. Bạn chịu quyết định về nội dung rule; kiểm tra tự động không bảo đảm phát hiện mọi xung đột ngữ nghĩa.</p>
          {!!visibleData.direct_rule_plan?.additions.length&&<div className="rounded-lg border border-emerald-200 bg-white p-3 space-y-2" aria-label="Hướng dẫn rule có hiệu lực">
            <p className="text-xs font-semibold">{visibleData.direct_rule_plan?.plan_kind==="canonical_append"?"Rule thêm nguyên văn vào nhánh đã chọn":"Hướng dẫn bổ sung do bạn duyệt"}</p>
            <p className="text-xs">Phạm vi đầy đủ: {affectedBrands(visibleData).join(", ")}. Giữ ưu tiên cho thông tin sản phẩm, Brand DNA và các ràng buộc bắt buộc hiện có.</p>
            <p className="text-xs text-slate-600">{visibleData.direct_rule_plan?.plan_kind==="canonical_append"
              ?"Nhánh này dùng rule dạng văn bản. Nội dung được thêm nguyên văn; không tạo quality catalog, không gắn nhãn đã biên dịch chất lượng hay QC hình ảnh."
              :"Nội dung dưới đây được đưa nguyên văn vào hướng dẫn có hiệu lực. Đây là quyết định của chủ sở hữu; hệ thống không gắn nhãn đã kiểm chứng ngữ nghĩa hay QC hình ảnh."}</p>
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{visibleData.direct_rule_plan.additions[0].canonical_text}</div>
          </div>}
          {!visibleData.direct_rule&&<p role="alert" className="text-xs text-amber-900">Máy chủ chưa cung cấp luồng duyệt rule trực tiếp. Hãy tải lại sau khi cập nhật.</p>}
          {visibleData.direct_rule?.blockers.map((issue,i)=><p key={i} role="alert" className="text-xs text-amber-900">{issue.message} {issue.next_action}</p>)}
          <button type="button" className={`${button} bg-emerald-700 text-white border-emerald-700`} disabled={!canAcceptRule} onClick={()=>post("rule")}>{busy==="rule"?"Đang merge rule…":"Duyệt rule & merge ngay"}</button>
        </div>
        <h4 className="text-sm font-semibold">Review outcome và bằng chứng</h4>
        <p className="text-xs text-slate-600">Duyệt một lần cho đúng thay đổi và phạm vi ở trên. Nếu review hợp lệ đã có đủ, hệ thống merge ngay; nếu còn cần review, yêu cầu được lưu vào hàng đợi của bạn để dot đối chiếu nguồn và ảnh thật.</p>
        {visibleData.queue_available===false&&<p className="text-xs text-slate-600">Hàng đợi review chỉ dành cho owner đã cấu hình. Bạn vẫn có thể xem feedback và đối chiếu quy chuẩn.</p>}
        {visibleData.queue_available!==false&&(!automatic||!visibleData.review_intent_hash)&&<p role="alert" className="text-xs text-amber-900">Máy chủ chưa cung cấp luồng tự kiểm tra. Hãy tải lại sau khi bản cập nhật hoàn tất.</p>}
        {automatic&&<>
          <div role="status" className="rounded-lg bg-slate-50 p-3 text-xs space-y-1">
            <p>Kiểm tra quy tắc: {automatic.checks.mechanical==="passed"?"Đã đạt":automatic.checks.mechanical==="failed"?"Có lỗi cần sửa":"Còn thiếu dữ liệu"}</p>
            <p>Review nguồn, ảnh thật và xung đột: {automatic.checks.actual_review==="verified"?"Đã có review hợp lệ":"Chưa có review hợp lệ"}</p>
            {automatic.status==="ready_to_merge"&&<p className="font-semibold text-emerald-700">Đủ điều kiện merge sau khi bạn duyệt.</p>}
          </div>
          {automatic.blockers.map((item,index)=><div key={index} role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><p className="font-semibold">{item.message}</p><p className="mt-1">{item.next_action}</p></div>)}
          {!!automatic.mechanical_results.length&&<details><summary className="cursor-pointer text-xs font-semibold">Kết quả kiểm tra tự động</summary><div className="space-y-2 mt-2">{automatic.mechanical_results.map((row,index)=><div key={row.baseline_id||index} className="text-xs"><p className="font-semibold">{readableIssue(row.case_key||row.baseline_id||"Mẫu kiểm tra",visibleData.baselines,visibleData.targets)} · {row.status}</p>{(row.issues||[]).map((issue,i)=><p key={i} className="text-amber-800">{readableIssue(issue,visibleData.baselines,visibleData.targets)}</p>)}</div>)}</div></details>}

        </>}
        {currentRequest&&<div role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs space-y-2">
          <p className="font-semibold">{{queued:"Đã lưu duyệt · Chờ dot review",leased:"dot đang review",blocked:"Đang chờ phần còn thiếu",merged:"Đã merge",cancelled:"Đã hủy yêu cầu",superseded:"Ý duyệt hoặc phạm vi đã thay đổi",expired:"Yêu cầu đã hết hạn"}[currentRequest.status]}</p>
          {activeRequest&&<><p>Yêu cầu nằm trong hàng đợi riêng của bạn. Lịch kiểm tra mỗi giờ áp dụng cho tài khoản đã bật xử lý; nút này không khởi chạy review tức thì.</p><p>Hiệu lực đến {dateLabel(currentRequest.expires_at)}. Bằng chứng mới sẽ được review lại; bạn không cần duyệt lại nếu ý thay đổi và phạm vi vẫn giữ nguyên.</p></>}
          {(currentRequest.blockers||[]).map((item,index)=><p key={index} className="text-amber-900">{typeof item==="string"?item:[item.message,item.next_action].filter(Boolean).join(" ")}</p>)}
          {activeRequest&&<button type="button" className={button} disabled={!canCancel} onClick={()=>post("cancel")}>{busy==="cancel"?"Đang hủy…":"Hủy yêu cầu"}</button>}
        </div>}
        <button type="button" className={`${button} bg-emerald-700 text-white border-emerald-700`} disabled={!canProcess} onClick={()=>post("process")}>{busy==="process"?"Đang tự kiểm tra…":automatic?.status==="ready_to_merge"?"Merge outcome đã review":"Duyệt & giao dot review"}</button>
        <p className="text-xs text-slate-500">Thiếu baseline hoặc ảnh thật sẽ dừng đúng bước cần bổ sung. Bạn không cần điền checklist, mã lần chạy, URL hay JSON. Dùng Tải lại để xem trạng thái mới nhất.</p>
      </section>}
      <details><summary className="cursor-pointer text-xs font-semibold">Advanced · IDs, hashes và dữ liệu đầy đủ</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify({preflight:visibleData,review_request:currentRequest,action_error:error,action_issues:errorIssues},null,2)}</pre></details>
    </>}
  </section>;
}
