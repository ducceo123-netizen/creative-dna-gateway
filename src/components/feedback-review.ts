/** View models and fail-closed form checks for the in-card feedback review. */
export type FeedbackProposal = {
  id: string; status: string; brand_name?: string; branch_title?: string; branch_slug?: string;
  submitted_by_name?: string; raw_feedback?: string; proposed_content_md?: string;
  proposed_scope?: string; change_summary?: string; evidence_summary?: Record<string, unknown>;
  created_at?: string; reviewed_at?: string; review_note?: string; merged_at?: string;
  resolved_at?: string; resolution_kind?: string; resolution?: Record<string, unknown>;
  context_images?: Array<{ role:string; image_url?:string|null; reference_id?:string|null; caption?:string|null }>;
};
export type ReviewTarget = { id:string; brand_id:string; brand_name:string; slug:string; title:string; content_md:string; node_hash:string; version?:number|string };
export type ReviewBaseline = {
  id:string; brand_id:string; brand_name?:string; case_key:string; branch_slug:string; approved_at?:string|null;
  source_brief?:Record<string,unknown>; approved_output?:Record<string,unknown>; expected_assertions?:Record<string,unknown>; is_reference_only?:boolean;
  [key:string]:unknown;
};
export type EvaluationResult = { baseline_id?:string; case_key?:string; brand_name?:string; status?:string; issues?:string[]; source_run_id?:string|null; artifact_url?:string|null };
export type ReviewEvaluation = {
  id:string; candidate_hash?:string; evaluation_status:string; completed_at?:string|null; created_at?:string;
  critical_failures?:number; baseline_ids?:string[]; test_results?:EvaluationResult[]; results?:EvaluationResult[]; issues?:string[];
  [key:string]:unknown;
};
export type CoveredCandidate = { id:string; summary:string; text:string; merged_at:string; candidate_hash:string; brand_names?:string[] };
export type FeedbackPreflight = {
  proposal:FeedbackProposal; candidate_hash:string; targets:ReviewTarget[]; baselines:ReviewBaseline[];
  evaluations:ReviewEvaluation[]; covered_candidates:CoveredCandidate[]; issues:string[]; automatic_evaluation_id:string|null;
};
export type ReviewChecks = { scope:boolean; productTruth:boolean; visual:boolean; conflicts:boolean; zeroRegressions:boolean };
export const emptyReviewChecks = ():ReviewChecks => ({scope:false,productTruth:false,visual:false,conflicts:false,zeroRegressions:false});
export type CandidateInput = { source_run_id:string; artifact_url:string; output:string };
export type CandidateRun = { baseline_id:string; source_run_id:string; artifact_url:string; output:Record<string,unknown> };
export const emptyCandidateInput = ():CandidateInput => ({source_run_id:"",artifact_url:"",output:""});
export const meaningfulNote = (note:string) => note.trim().length >= 20;
export const allReviewChecks = (checks:ReviewChecks) => Object.values(checks).every(value => value === true);
export const safeHttpUrl = (value:unknown):string|null => typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
export const baselineName = (baseline:ReviewBaseline) => baseline.case_key?.replace(/[_-]+/g," ") || "Baseline chưa có tên";
export const baselineBrand = (baseline:ReviewBaseline, targets:ReviewTarget[]) => baseline.brand_name || targets.find(target => target.brand_id === baseline.brand_id)?.brand_name || "Brand chưa xác định";
export function validatePreflight(value:unknown, proposalId:string):FeedbackPreflight {
  const data=value as FeedbackPreflight;
  if (!data || data.proposal?.id!==proposalId || typeof data.proposal?.status!=="string" || !data.candidate_hash ||
    ![data.targets,data.baselines,data.evaluations,data.covered_candidates,data.issues].every(Array.isArray) ||
    data.targets.some(target=>!target?.id||!target.brand_id||typeof target.content_md!=="string") ||
    data.baselines.some(baseline=>!baseline?.id||!baseline.brand_id) ||
    data.evaluations.some(evaluation=>!evaluation?.id) ||
    data.covered_candidates.some(candidate=>!candidate?.id||typeof candidate.text!=="string"||!candidate.candidate_hash)) {
    throw Error("Preflight trả về chưa đầy đủ hoặc không đúng feedback. Hãy tải lại.");
  }
  return data;
}
export function currentEvaluation(data:FeedbackPreflight):ReviewEvaluation|null {
  const evaluation=data.evaluations.find(item=>item.id===data.automatic_evaluation_id);
  return evaluation && evaluation.evaluation_status==="passed" && evaluation.candidate_hash===data.candidate_hash &&
    evaluation.critical_failures===0 && !!evaluation.completed_at && !!evaluation.baseline_ids?.length ? evaluation : null;
}
export function affectedBrands(data:FeedbackPreflight):string[] {
  return [...new Set(data.targets.map(target=>target.brand_name || "Brand chưa xác định"))];
}
export function missingBaselineBrands(data:FeedbackPreflight):string[] {
  return [...new Set(data.targets.filter(target=>!data.baselines.some(baseline=>baseline.brand_id===target.brand_id && baseline.branch_slug===target.slug && !!baseline.approved_at && !baseline.is_reference_only)).map(target=>target.brand_name||"Brand chưa xác định"))];
}
export function candidateRuns(baselines:ReviewBaseline[], inputs:Record<string,CandidateInput>):{runs:CandidateRun[];issues:string[]} {
  const runs:CandidateRun[]=[]; const issues:string[]=[];
  for (const baseline of baselines) {
    const input=inputs[baseline.id] || emptyCandidateInput();
    const label=baselineName(baseline);
    if(!input.source_run_id.trim())issues.push(`${label}: thiếu mã lần chạy thật (source run).`);
    if(!/^https:\/\//i.test(input.artifact_url.trim()))issues.push(`${label}: thiếu URL HTTPS của candidate artifact.`);
    let output:Record<string,unknown>;
    try {
      output=JSON.parse(input.output);
      if(!output||typeof output!=="object"||Array.isArray(output)||!Object.keys(output).length)throw Error();
    } catch { issues.push(`${label}: thiếu output JSON object thực tế, không rỗng.`); continue; }
    runs.push({baseline_id:baseline.id,source_run_id:input.source_run_id.trim(),artifact_url:input.artifact_url.trim(),output});
  }
  if(!baselines.length)issues.push("Chưa có baseline được duyệt cho phạm vi này.");
  return {runs,issues};
}
export function proposalAddition(proposal:FeedbackProposal):string {
  return proposal.proposed_content_md?.trim() || proposal.raw_feedback?.trim() || "";
}
/** Exact line presence only; this deliberately makes no semantic duplicate claim. */
export function proposedLines(proposal:string, canonical:string):Array<{text:string;alreadyPresent:boolean}> {
  const lines=new Set(canonical.split(/\r?\n/).map(line=>line.trim()).filter(Boolean));
  return proposal.split(/\r?\n/).map(text=>({text,alreadyPresent:!!text.trim()&&lines.has(text.trim())}));
}
export function readableIssue(issue:string, baselines:ReviewBaseline[]=[], targets:ReviewTarget[]=[]):string {
  let result=String(issue);
  for(const baseline of baselines)result=result.replaceAll(baseline.id,baselineName(baseline));
  for(const target of targets)result=result.replaceAll(target.brand_id,target.brand_name||"Brand chưa xác định").replaceAll(target.id,`${target.brand_name} / ${target.title||target.slug}`);
  return result.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,"mục liên quan (xem Advanced)");
}

/** Literal, case-insensitive search only; never ranks or selects semantic duplicates. */
export function searchCoveredCandidates(candidates:CoveredCandidate[], query:string):CoveredCandidate[] {
  const terms=query.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return candidates.filter(candidate=>{
    const haystack=[candidate.summary,candidate.text,candidate.merged_at].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
    return terms.every(term=>haystack.includes(term));
  });
}
