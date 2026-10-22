/** View models and fail-closed form checks for the in-card feedback review. */
export type FeedbackProposal = {
  id: string; status: string; brand_name?: string; branch_title?: string; branch_slug?: string;
  submitted_by_name?: string; raw_feedback?: string; proposed_content_md?: string;
  proposed_scope?: string; change_summary?: string; evidence_summary?: Record<string, unknown>;
  created_at?: string; reviewed_at?: string; review_note?: string; merged_at?: string;
  resolved_at?: string; resolution_kind?: string; resolution?: Record<string, unknown>;
  context_images?: Array<{ role:string; image_url?:string|null; reference_id?:string|null; caption?:string|null }>;
};
/** Compare JSON values, not fresh inbox object identities. Preserve every field and array order. */
export function proposalReviewKey(proposal:FeedbackProposal):string {
  return JSON.stringify(proposal,(_key,value)=>value&&typeof value==="object"&&!Array.isArray(value)
    ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
}
export type ReviewTarget = { id:string; brand_id:string; brand_name:string; slug:string; title:string; content_md:string; node_hash:string; version?:number|string;status?:string };
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
export type AutomaticReview = {
  status:"ready_to_merge"|"needs_baseline"|"needs_candidate"|"needs_actual_review"|"checks_failed"|"blocked";
  candidate_hash:string; evaluation_id:string|null;
  checks:{mechanical:"passed"|"failed"|"blocked";actual_review:"verified"|"required"};
  blockers:Array<{code:string;message:string;next_action:string}>;
  evidence:Array<{kind:string;reference_id?:string|null;url?:string|null;caption?:string}>;
  candidate_runs:Array<{baseline_id:string;source_run_id?:string;artifact_url?:string;output?:Record<string,unknown>}>;
  mechanical_results:EvaluationResult[]; mechanical_issues:string[];
  host_review:{available:false;packet_version:string;instruction:string;required_capabilities:string[];packet:Record<string,unknown>};
};
export type OwnerRuleAddition = {
 schema_version:string;id:string;proposal_id:string;decision_kind:string;
 canonical_text:string;declared_scope:string;scope:{brands:string[];branches:string[]};
 rule_class:string;confidence:string;precedence:string;semantic_consistency:string;visual_qc_performed:false;
 source:{node:string;locator:string;canonical_text_hash:string};accepted_source_hashes?:{branch:string;brand_dna:string};
 target_node_ids:string[];affected_brands:string[];
};
export type DirectRulePlan = {
 plan_kind?:"compiled_supplement"|"canonical_append"|null;compiler_version?:string|null;compiled?:unknown[];
 eligible:boolean;plan_hash:string|null;blockers:Array<{code:string;message:string;next_action:string}>;
 additions:OwnerRuleAddition[];semantic_consistency:"NOT_PROVEN_BY_DETERMINISTIC_CHECKS";visual_qc_performed:false;
};
export function validateDirectRulePlan(value:unknown,data:{proposal:FeedbackProposal;targets:ReviewTarget[]}):DirectRulePlan {
 const plan=value as DirectRulePlan;
 if(!plan||typeof plan.eligible!=="boolean"||plan.visual_qc_performed!==false||plan.semantic_consistency!=="NOT_PROVEN_BY_DETERMINISTIC_CHECKS"||
  !Array.isArray(plan.blockers)||plan.blockers.some(b=>typeof b?.message!=="string"||typeof b?.next_action!=="string")||!Array.isArray(plan.additions)||
  (plan.eligible&&(typeof plan.plan_hash!=="string"||!plan.plan_hash||plan.blockers.length||!plan.additions.length))||
  plan.additions.some(a=>!a||a.proposal_id!==data.proposal.id||typeof a.canonical_text!=="string"||!a.canonical_text||
   a.canonical_text!==proposalAddition(data.proposal)||a.declared_scope!==data.proposal.proposed_scope||a.visual_qc_performed!==false||
   typeof a.precedence!=="string"||!a.precedence||!Array.isArray(a.target_node_ids)||!a.target_node_ids.length||
   a.target_node_ids.some(id=>!data.targets.some(t=>t.id===id))||!Array.isArray(a.affected_brands)||!a.affected_brands.length))
  throw Error("Bản hướng dẫn rule chưa đầy đủ hoặc không khớp thay đổi. Hãy tải lại.");
 if(plan.plan_kind!==undefined&&plan.plan_kind!==null&&!['compiled_supplement','canonical_append'].includes(plan.plan_kind))
  throw Error("Loại bản cập nhật rule chưa được hỗ trợ. Hãy tải lại.");
 if(plan.eligible&&plan.plan_kind==='canonical_append'&&(plan.compiler_version!==null||!Array.isArray(plan.compiled)||plan.compiled.length>0||
  plan.additions.some(a=>a.schema_version!=='uid.owner-canonical-append.v1'||a.decision_kind!=='owner_direct_rule'||Object.hasOwn(a,'accepted_source_hashes'))||
  data.targets.some(t=>['onepage-system','brand-dna'].includes(t.slug))))
  throw Error("Bản thêm rule thuần văn bản không được nhận là đã biên dịch chất lượng. Hãy tải lại.");
 if(plan.eligible&&plan.plan_kind==='compiled_supplement'&&plan.additions.some(a=>a.schema_version!=='uid.owner-supplemental-rule.v1'))
  throw Error("Hướng dẫn rule đã biên dịch không đúng định dạng. Hãy tải lại.");
 if(plan.eligible&&data.targets.some(t=>!plan.additions.some(a=>a.target_node_ids.includes(t.id))))
  throw Error("Bản hướng dẫn rule chưa bao phủ toàn bộ phạm vi. Hãy tải lại.");
 return plan;
}
export type DirectRuleReview = {
 schema_version:"uid.owner-rule-eligibility.v1";eligible:boolean;rule_hash:string;rule_class:string|null;
 blockers:Array<{code:string;message:string;next_action:string}>;owner_authorized:boolean;
 check_scope:"STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY";visual_qc_performed:false;
};
export function validateDirectRule(value:unknown):DirectRuleReview {
 const rule=value as DirectRuleReview;
 if(!rule||rule.schema_version!=="uid.owner-rule-eligibility.v1"||typeof rule.eligible!=="boolean"||typeof rule.rule_hash!=="string"||!rule.rule_hash||
  typeof rule.owner_authorized!=="boolean"||rule.visual_qc_performed!==false||rule.check_scope!=="STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY"||
  !Array.isArray(rule.blockers)||rule.blockers.some(b=>typeof b?.message!=="string"||typeof b?.next_action!=="string")||
  (rule.eligible&&(!rule.owner_authorized||rule.blockers.length)))throw Error("Kết quả kiểm tra rule chưa đầy đủ. Hãy tải lại.");
 return rule;
}
export type ReviewRequest = {
 id:string; proposal_id:string;
 status:"queued"|"leased"|"blocked"|"merged"|"cancelled"|"superseded"|"expired";
 created_at:string;updated_at:string;expires_at:string;
 blockers?:Array<{code?:string;message?:string;next_action?:string}|string>;outcome?:Record<string,unknown>|null;
};
export function validateReviewRequest(value:unknown,proposalId:string):ReviewRequest|null {
 if(value===null)return null;
 const request=value as ReviewRequest;
 if(!request||typeof request.id!=="string"||!request.id.trim()||request.proposal_id!==proposalId||
  !["queued","leased","blocked","merged","cancelled","superseded","expired"].includes(request.status)||
  ![request.created_at,request.updated_at,request.expires_at].every(x=>typeof x==="string"&&Number.isFinite(Date.parse(x)))||
   (request.blockers!==undefined&&(!Array.isArray(request.blockers)||request.blockers.some(b=>typeof b!=="string"&&
    (!b||typeof b!=="object"||Array.isArray(b)||[b.code,b.message,b.next_action].some(value=>value!==undefined&&typeof value!=="string"))))))
  throw Error("Trạng thái hàng đợi không đầy đủ hoặc không đúng feedback. Hãy tải lại.");
 return request;
}
export type FeedbackPreflight = {
  preview_kind?:"owner_rule";
  proposal:FeedbackProposal; candidate_hash:string; targets:ReviewTarget[]; baselines:ReviewBaseline[];
  evaluations:ReviewEvaluation[]; covered_candidates:CoveredCandidate[]; issues:string[]; automatic_evaluation_id:string|null; automatic_review?:AutomaticReview; direct_rule?:DirectRuleReview; direct_rule_plan?:DirectRulePlan; review_request?:ReviewRequest|null; review_intent_hash?:string|null; queue_available?:boolean;
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
  if(data.automatic_review)validateAutomaticReview(data.automatic_review,data.candidate_hash);
  if(data.direct_rule)validateDirectRule(data.direct_rule);
  if(data.direct_rule_plan)validateDirectRulePlan(data.direct_rule_plan,data);
  if(data.direct_rule?.eligible&&!data.direct_rule_plan?.eligible)throw Error("Chưa có bản hướng dẫn rule hợp lệ. Hãy tải lại.");
  if(data.review_request!==undefined)validateReviewRequest(data.review_request,proposalId);
  if(data.queue_available!==undefined&&typeof data.queue_available!=="boolean")throw Error("Trạng thái quyền review không hợp lệ.");
  if(data.queue_available===false&&(data.review_intent_hash!==null||data.review_request!==null))throw Error("Dữ liệu hàng đợi không khớp quyền truy cập.");
  if(data.review_intent_hash!==undefined&&!(data.queue_available===false&&data.review_intent_hash===null)&&(typeof data.review_intent_hash!=="string"||!data.review_intent_hash.trim()))throw Error("Ý duyệt hiện tại chưa xác định. Hãy tải lại.");
  return data;
}
/** Owner preview is selected explicitly, never accepted as a queue fallback. */
export function validateOwnerPreflight(value:unknown, proposalId:string):FeedbackPreflight {
  const data=validatePreflight(value,proposalId);
  if(data.preview_kind!=="owner_rule"||data.queue_available!==false||data.review_intent_hash!==null||
     data.review_request!==null||data.automatic_review!==undefined||data.direct_rule?.owner_authorized!==true||!data.direct_rule_plan)
    throw Error("Chưa xác minh được bản duyệt riêng của owner. Hãy tải lại.");
  return data;
}
export function validateAutomaticReview(value:unknown, candidateHash:string):AutomaticReview {
  const review=value as AutomaticReview;
  if(!review || review.candidate_hash!==candidateHash ||
    !["ready_to_merge","needs_baseline","needs_candidate","needs_actual_review","checks_failed","blocked"].includes(review.status) ||
    !Array.isArray(review.blockers) || !Array.isArray(review.mechanical_results) || !Array.isArray(review.mechanical_issues) ||
    !Array.isArray(review.evidence) || !Array.isArray(review.candidate_runs) ||
    !["passed","failed","blocked"].includes(review.checks?.mechanical) || !["verified","required"].includes(review.checks?.actual_review) ||
    review.blockers.some(item=>typeof item?.message!=="string"||typeof item?.next_action!=="string") ||
    (review.status==="ready_to_merge"&&(!review.evaluation_id||review.checks.mechanical!=="passed"||review.checks.actual_review!=="verified"||review.blockers.length)))
    throw Error("Kết quả tự kiểm tra không đầy đủ hoặc đã cũ. Hãy tải lại.");
  return review;
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
