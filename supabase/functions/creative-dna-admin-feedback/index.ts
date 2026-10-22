import { installHomeIcon } from "../_shared/home-icon-install.ts";
import { HOME_ICON_CONTENT, HOME_ICON_REVISION } from "../_shared/home-icon.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCompatibleOwnerRulePlan as buildOwnerRulePlan } from "../_shared/owner-rule-compatible-plan.ts";
import { assessReviewCandidates, reviewReadiness, prepareAutomaticReview, prepareGuidedOutcomeReview, REVIEW_EVALUATOR_VERSION } from "../_shared/feedback-review.ts";

function validReviewContext(value:any):boolean {
  return !!value&&typeof value.proposal?.id==="string"&&typeof value.proposal?.status==="string"&&
    typeof value.candidate_hash==="string"&&!!value.candidate_hash.trim()&&
    [value.targets,value.baselines,value.evaluations,value.covered_candidates].every(Array.isArray)&&
    value.targets.every((n:any)=>n&&typeof n.id==="string"&&typeof n.brand_id==="string"&&typeof n.content_md==="string")&&
    value.baselines.every((b:any)=>b&&typeof b.id==="string"&&typeof b.brand_id==="string")&&
    value.evaluations.every((e:any)=>e&&typeof e.id==="string")&&
    value.covered_candidates.every((c:any)=>c&&typeof c.id==="string")&&
    (value.direct_rule===undefined||(value.direct_rule&&Array.isArray(value.direct_rule.blockers)));
}

/** Allowlisted public projection; worker capabilities and raw nested payloads never leave the edge. */
function publicRuleReviewRequest(value:any,proposalId:string) {
  if(value===null)return null;
  if(!value||typeof value.idempotency_key!=="string"||!/^[a-f0-9-]{36}$/i.test(value.idempotency_key)||value.proposal_id!==proposalId||value.review_mode!=="agent_rule_review"||!/^sha256:[a-f0-9]{64}$/.test(value.intent_hash||"")||
    !["queued","leased","blocked","merged","cancelled","superseded","expired"].includes(value.status)||
    ![value.created_at,value.expires_at].every(v=>typeof v==="string"&&Number.isFinite(Date.parse(v)))||!Array.isArray(value.blockers))throw Error("Invalid rule review status");
  const messages:Record<string,string>={intent_expired:"Bàn giao đã hết hạn.",authority_changed:"Quyền bàn giao đã thay đổi.",intent_changed:"Nội dung hoặc phạm vi feedback đã thay đổi.",rule_snapshot_blocked:"AI chưa đọc được quy chuẩn hiện tại.",new_explicit_delegation:"Đã có lượt bàn giao mới."};
  const blockers=value.blockers.map((item:any)=>({code:typeof item?.code==="string"&&/^[a-z_]{1,80}$/.test(item.code)?item.code:"review_blocked",message:messages[item?.code]||"AI chưa thể hoàn tất; cần kiểm tra nội dung hoặc cấu hình review."}));
  let outcome=null;
  if(value.status==="merged"){
    if(value.outcome?.canonical_changed!==true||value.outcome?.visual_qc_performed!==false||value.outcome?.review_scope!=="RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC")throw Error("Invalid merge outcome");
    outcome={canonical_changed:true,visual_qc_performed:false,review_scope:"RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC"};
  }
  return {proposal_id:proposalId,review_mode:"agent_rule_review",intent_hash:value.intent_hash,idempotency_key:value.idempotency_key,status:value.status,created_at:value.created_at,expires_at:value.expires_at,blockers,outcome};
}

export default {
  fetch: async (req: Request) => {
    if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });

    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData } = await authClient.auth.getUser();
    const user = authData?.user;
    if (!user) return Response.json({ error: "Authenticated user required" }, { status: 401 });

    const adminDb = createClient(supabaseUrl, serviceKey);
    const { data: member } = await adminDb
      .from("creative_dna_team_members")
      .select("role,is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member?.is_active || member.role !== "admin") {
      return Response.json({ error: "Admin required" }, { status: 403 });
    }

    const body = await req.json();
    if (body.mode === "home_icon_preview") return Response.json({ revision: HOME_ICON_REVISION, content_md: HOME_ICON_CONTENT, output_owner_approved: false }, { headers: { "Cache-Control": "no-store" } });
    if (body.mode === "home_icon_install") {
      const result = await installHomeIcon(adminDb, body);
      return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
    }
    // v3 is an explicit owner-delegated semantic rule review. Never route to
    // outcome-QC v2, create synthetic evidence, or enqueue on a read.
    if (["rule_review_preflight","rule_review_handoff","rule_review_status","rule_review_cancel"].includes(body.mode)) {
      const headers={"Cache-Control":"no-store"};
      const unavailable=()=>Response.json({error:"Bàn giao AI chưa khả dụng: backend rule-review v3 chưa được kích hoạt hoặc chưa cấp quyền.",code:"rule_review_unavailable"},{status:503,headers});
      if(typeof body.proposal_id!=="string"||!body.proposal_id)return Response.json({error:"proposal_id required"},{status:422,headers});
      if(["rule_review_preflight","rule_review_handoff"].includes(body.mode)&&Deno.env.get("UID_RULE_REVIEW_V3_ENABLED")!=="true")return unavailable();
      const args:Record<string,unknown>={p_proposal_id:body.proposal_id,p_owner_user_id:user.id};
      let rpc="uid_rule_review_v3_get";
      if(body.mode==="rule_review_preflight")rpc="uid_rule_review_v3_preview";
      if(body.mode==="rule_review_handoff"||body.mode==="rule_review_cancel"){
        if(typeof body.intent_hash!=="string"||!/^sha256:[a-f0-9]{64}$/.test(body.intent_hash))return Response.json({error:"Current exact rule intent required"},{status:422,headers});
        args.p_expected_intent_hash=body.intent_hash;
        if(typeof body.idempotency_key!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.idempotency_key))return Response.json({error:"Exact delegation idempotency key required"},{status:422,headers});
        if(body.mode==="rule_review_cancel")args.p_expected_idempotency_key=body.idempotency_key;
        rpc=body.mode==="rule_review_handoff"?"uid_rule_review_v3_handoff":"uid_rule_review_v3_cancel";
        if(body.mode==="rule_review_handoff"){
          if(body.delegate!==true||typeof body.idempotency_key!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.idempotency_key))return Response.json({error:"Explicit delegation and stable idempotency key required"},{status:422,headers});
          args.p_idempotency_key=body.idempotency_key;
        }
      }
      const {data,error}=await adminDb.rpc(rpc,args);
      if(error){
        if(["42501","42883","PGRST202"].includes(error.code)||/not activated|not enabled|compiler release|permission denied/i.test(error.message||""))return unavailable();
        // Only translate this exact, server-owned eligibility failure. Never expose
        // arbitrary SQL messages/details or imply that an owner/auth check passed.
        if(error.code==="P0001"&&error.message==="Rule structure/scope/compiler blocked")return Response.json({error:"Rule chưa đáp ứng cấu trúc, phạm vi hoặc khả năng biên dịch của luồng AI. Xem lý do cụ thể trong phần duyệt trực tiếp; đây không phải kết luận rằng quyền của bạn đã thay đổi.",code:"rule_review_eligibility_blocked"},{status:409,headers});
        return Response.json({error:"Chưa thể bàn giao: nội dung, phạm vi hoặc quyền đã thay đổi, hoặc còn lượt review khác. Hãy kiểm tra trạng thái và tải lại.",code:"rule_review_conflict"},{status:409,headers});
      }
      try {
        if(body.mode==="rule_review_preflight"){
          if(data?.proposal_id!==body.proposal_id||data.review_mode!=="agent_rule_review"||!/^sha256:[a-f0-9]{64}$/.test(data.intent_hash)||typeof data.proposed_content_md!=="string"||!data.scope||typeof data.scope!=="object"||Array.isArray(data.scope))throw Error("Invalid preview");
          // Scope is display-only; the SQL intent hash binds the actual scope.
          const scope=Object.fromEntries(["branch_slug","cross_brand","structural","proposed_scope"].filter(key=>["string","boolean"].includes(typeof data.scope[key])).map(key=>[key,data.scope[key]]));
          return Response.json({proposal_id:body.proposal_id,review_mode:"agent_rule_review",available:true,eligible:true,intent_hash:data.intent_hash,proposed_content_md:data.proposed_content_md,scope,blockers:[],review_request:publicRuleReviewRequest(data.review_request??null,body.proposal_id)},{headers});
        }
        const review_request=publicRuleReviewRequest(data,body.proposal_id);
        if(body.mode==="rule_review_handoff"&&review_request?.intent_hash===body.intent_hash&&review_request.idempotency_key!==body.idempotency_key)return Response.json({error:"Feedback đã có lượt bàn giao khác. Kiểm tra trạng thái trước khi thao tác.",code:"rule_review_existing_request"},{status:409,headers});
        if(body.mode!=="rule_review_status"&&(!review_request||review_request.intent_hash!==body.intent_hash||review_request.idempotency_key!==body.idempotency_key||(body.mode==="rule_review_cancel"&&review_request.status!=="cancelled")))throw Error("Invalid request receipt");
        return Response.json({review_request,canonical_changed:false},{headers});
      }catch{
        return Response.json({error:"Chưa xác minh được kết quả bàn giao AI. Kiểm tra trạng thái trước khi gửi lại.",code:"rule_review_invalid_receipt"},{status:502,headers});
      }
    }


    // Explicit owner surface, selected before any request. Not a fallback for
    // queue errors: it uses the same authenticated snapshot as accept_rule.
    if(body.mode === "owner_rule_preflight") {
      const headers={"Cache-Control":"no-store"};
      if(typeof body.proposal_id!=="string"||!body.proposal_id)
        return Response.json({error:"proposal_id required"},{status:422,headers});
      const {data,error}=await adminDb.rpc("uid_rule_preflight",{p_proposal_id:body.proposal_id,p_actor_user_id:user.id});
      if(error)return Response.json({error:error.message},{status:409,headers});
      if(data?.proposal?.id!==body.proposal_id)return Response.json({error:"Proposal not found"},{status:404,headers});
      if(!validReviewContext(data))return Response.json({error:"Incomplete owner snapshot. Reload before approving."},{status:503,headers});
      if(data.direct_rule?.owner_authorized!==true)return Response.json({error:"Enabled verified configured owner required"},{status:403,headers});
      const compiled=await buildOwnerRulePlan(data);
      const {plan:_plan,...direct_rule_plan}=compiled;
      // Do not compute outcome readiness or expose queue authority on this path.
      const {compiler_context:_compilerContext,automatic_review:_automatic,review_intent_hash:_intent,review_request:_request,...visible}=data;
      return Response.json({...visible,preview_kind:"owner_rule",issues:[],automatic_evaluation_id:null,
        direct_rule_plan,queue_available:false,review_intent_hash:null,review_request:null,
        direct_rule:{...data.direct_rule,eligible:data.direct_rule.eligible===true&&compiled.eligible,
          blockers:[...data.direct_rule.blockers,...compiled.blockers]}},{headers});
    }

    // The displayed patch, full trigger scope and owner-bound rule hash come
    // from ONE SQL snapshot. The effective plan is derived only on the server.
    if (body.mode === "review_preflight") {
      let { data, error } = await adminDb.rpc("uid_review_preflight", { p_proposal_id: body.proposal_id,p_actor_user_id:user.id });
      let queue_available=true;
      // Existing admins retain the general read surface; only the configured
      // owner receives queue authority. Never combine two successful snapshots.
      if(error?.code==="42501"&&error.message==="Enabled verified configured owner required") {
        const fallback=await adminDb.rpc("uid_rule_preflight",{p_proposal_id:body.proposal_id,p_actor_user_id:user.id});
        data=fallback.data;error=fallback.error;queue_available=false;
      }
      if (error) return Response.json({ error: error.message }, { status: 409 });
      if (data?.proposal?.id !== body.proposal_id) return Response.json({ error: "Proposal not found" }, { status: 404 });
      if(!validReviewContext(data))return Response.json({error:"Incomplete review snapshot. Reload before approving."},{status:503});
      if(queue_available&&(typeof data?.review_intent_hash!=="string"||!data.review_intent_hash))
        return Response.json({error:"Review queue unavailable. Retry after the update completes."},{status:503});
      const compiled = await buildOwnerRulePlan(data);
      const {plan:_plan,...direct_rule_plan}=compiled;
      const {compiler_context:_compilerContext,...visible}=reviewReadiness(data);
      return Response.json({ ...visible, direct_rule_plan,queue_available,
        review_intent_hash:queue_available?data.review_intent_hash:null,review_request:queue_available?(data.review_request||null):null,
        direct_rule:data.direct_rule ? {...data.direct_rule,eligible:data.direct_rule.eligible===true&&compiled.eligible,
          blockers:[...(data.direct_rule.blockers||[]),...compiled.blockers]} : undefined,
        automatic_review: prepareGuidedOutcomeReview(data) }, { headers: { "Cache-Control": "no-store" } });
    }
    // This deliberately records owner authority over the displayed creative
    // rule, never visual QC. Forged client plans/actors are never used.
    if(body.mode === "accept_rule") {
      if(body.approve_rule!==true||!body.proposal_id||![body.candidate_hash,body.rule_hash,body.plan_hash].every(value=>typeof value==="string"&&value.length>0))
        return Response.json({error:"Explicit approval of the displayed rule, effective guidance and current scope is required."},{status:422});
      const {data:context,error:contextError}=await adminDb.rpc("uid_rule_preflight",{p_proposal_id:body.proposal_id,p_actor_user_id:user.id});
      if(contextError||context?.proposal?.id!==body.proposal_id)
        return Response.json({error:contextError?.message||"Proposal not found. Reload before retrying."},{status:409});
      let plan:unknown=null;
      const receipt=context.direct_rule_receipt;
      if(context.proposal.status==="merged"&&receipt) {
        if(receipt.proposal_id!==body.proposal_id||receipt.status!=="merged"||receipt.decision_kind!=="owner_direct_rule"||receipt.visual_qc_performed!==false||typeof receipt.rule_decision_id!=="string"||!receipt.rule_decision_id||typeof receipt.merged_at!=="string"||!Number.isFinite(Date.parse(receipt.merged_at))||
           receipt.candidate_hash!==body.candidate_hash||receipt.rule_hash!==body.rule_hash||receipt.plan_hash!==body.plan_hash)
          return Response.json({error:"The completed rule does not match this approval. Reload to inspect its audit."},{status:409});
      } else {
        if(context.proposal.status!=="pending"||context.direct_rule?.eligible!==true||context.direct_rule.owner_authorized!==true||
           context.candidate_hash!==body.candidate_hash||context.direct_rule.rule_hash!==body.rule_hash)
          return Response.json({error:"The rule, scope, owner authority or canonical version changed. Reload before approving."},{status:409});
        const compiled=await buildOwnerRulePlan(context);
        if(!compiled.eligible||!compiled.plan||compiled.plan_hash!==body.plan_hash)
          return Response.json({error:"The effective rule plan is blocked or changed. Reload and review the current guidance.",issues:compiled.blockers.map(item=>item.message)},{status:409});
        plan=compiled.plan;
      }
      const {data,error}=await adminDb.rpc("uid_rule_accept",{
        p_proposal_id:body.proposal_id,p_actor_user_id:user.id,
        p_expected_candidate_hash:body.candidate_hash,p_expected_rule_hash:body.rule_hash,p_plan:plan,p_expected_plan_hash:body.plan_hash,
      });
      if(error)return Response.json({error:error.message},{status:409});
      if(data?.proposal_id!==body.proposal_id||data.status!=="merged"||data.decision_kind!=="owner_direct_rule"||
         data.visual_qc_performed!==false||typeof data.rule_decision_id!=="string"||!data.rule_decision_id||typeof data.merged_at!=="string"||!Number.isFinite(Date.parse(data.merged_at))||data.candidate_hash!==body.candidate_hash||data.rule_hash!==body.rule_hash||data.plan_hash!==body.plan_hash)
        return Response.json({error:"Cannot verify the rule merge receipt. Reload to inspect the saved outcome; do not submit again blindly."},{status:502});
      return Response.json({...data,proposal:{id:data.proposal_id,status:data.status,merged_at:data.merged_at},canonical_changed:true},{headers:{"Cache-Control":"no-store"}});
    }
    if(body.mode === "review_request_status") {
      if(!body.proposal_id)return Response.json({error:"proposal_id required"},{status:400});
      const {data,error}=await adminDb.rpc("uid_review_get",{p_proposal_id:body.proposal_id,p_actor_user_id:user.id});
      return error?Response.json({error:error.message},{status:409}):Response.json({review_request:data},{headers:{"Cache-Control":"no-store"}});
    }
    if(body.mode === "cancel_review") {
      if(!body.proposal_id||!body.request_id)return Response.json({error:"proposal_id and request_id required"},{status:400});
      const {data,error}=await adminDb.rpc("uid_review_cancel",{p_request_id:body.request_id,p_proposal_id:body.proposal_id,p_actor_user_id:user.id});
      return error?Response.json({error:error.message},{status:409}):Response.json({review_request:data,canonical_changed:false});
    }
    // A single explicit intent; only EXISTING verified evidence can reach merge.
    // Client-supplied runs, review flags, actor and evaluation IDs are ignored.
    if (body.mode === "process_review") {
      if (body.approve !== true || typeof body.review_intent_hash !== "string" || !body.review_intent_hash || !body.proposal_id)
        return Response.json({error:"Explicit approval of the current feedback is required."},{status:422});
      const {data:context,error:contextError}=await adminDb.rpc("uid_review_preflight",{p_proposal_id:body.proposal_id,p_actor_user_id:user.id});
      if (contextError || context?.proposal?.id!==body.proposal_id || context?.proposal?.status !== "pending" || !validReviewContext(context))
        return Response.json({error:contextError?.message || "Complete matching pending proposal required. Reload before retrying."},{status:409});
      const intentHash=context.review_intent_hash;
      if(typeof intentHash!=="string"||!intentHash||body.review_intent_hash!==intentHash)
        return Response.json({error:"The proposed change or target scope changed. Reload before approving."},{status:409});
      const automatic_review=prepareGuidedOutcomeReview(context);
      if (automatic_review.status !== "ready_to_merge" || !automatic_review.evaluation_id) {
        const {data:review_request,error:queueError}=await adminDb.rpc("uid_review_enqueue",{
          p_proposal_id:body.proposal_id,p_actor_user_id:user.id,p_expected_intent_hash:intentHash,
        });
        if(queueError)return Response.json({error:queueError.message},{status:409});
        if(!review_request?.id||review_request.proposal_id!==body.proposal_id||!["queued","leased","blocked"].includes(review_request.status))
          return Response.json({error:"Cannot verify saved queue status. Reload before retrying."},{status:502});
        return Response.json({status:review_request.status,review_request,automatic_review,canonical_changed:false,
          approval_recorded:true,background_task_started:false},{headers:{"Cache-Control":"no-store"}});
      }
      // SQL rechecks scope, exact hash, full case coverage and stored genuine
      // Admin review under lock. No synthetic evaluation or self-attestation.
      const {data,error}=await adminDb.rpc("uid_governance_accept_merge",{
        p_proposal_id:body.proposal_id,p_actor_user_id:user.id,p_evaluation_id:automatic_review.evaluation_id,
        p_review_note:"Admin approved processing this exact feedback. Existing stored review and automatic mechanical checks verified; guarded merge requested.",
      });
      if(error)return Response.json({error:error.message},{status:409});
      return Response.json({status:"merged",proposal:{id:data.proposal_id,status:data.status,merged_at:data.merged_at},
        merged_nodes:data.merged_nodes,cross_brand_sync:data.cross_brand_sync,evaluation_id:automatic_review.evaluation_id,
        canonical_changed:true});
    }
    if (body.mode === "resolve_covered") {
      if (!body.proposal_id || !body.covered_proposal_id || !body.candidate_hash || !body.covered_hash
        || typeof body.review_note !== "string" || body.review_note.trim().length < 20) {
        return Response.json({ error: "Review the current matching rule, affected brands and scope, and add a note of at least 20 characters." }, { status: 422 });
      }
      const { data, error } = await adminDb.rpc("uid_governance_resolve_covered", {
        p_proposal_id: body.proposal_id, p_actor_user_id: user.id,
        p_expected_candidate_hash: body.candidate_hash, p_covered_proposal_id: body.covered_proposal_id,
        p_expected_covered_hash: body.covered_hash, p_review_note: body.review_note.trim().slice(0, 4000),
      });
      if (error) return Response.json({ error: error.message, retry_guidance: "Refresh this card and review the current matching rule before trying again." }, { status: 409 });
      return Response.json({ ...data, canonical_changed: false });
    }
    // Tests use actual supplied candidate artifacts; no generation or automatic visual QC.
    if (body.mode === "governance_evaluate") {
      const proposalId = String(body.proposal_id || "").trim();
      if (!proposalId) return Response.json({ error: "proposal_id required" }, { status: 400 });
      const { data: context, error: contextError } = await adminDb.rpc("uid_governance_review_context", { p_proposal_id: proposalId });
      if (contextError || context?.proposal?.status !== "pending") return Response.json({ error: contextError?.message || "Pending proposal required" }, { status: 409 });
      if (typeof body.candidate_hash !== "string" || body.candidate_hash !== context.candidate_hash) {
        return Response.json({ error: "The reviewed proposal, scope, canonical rules or baselines changed. Refresh the card and review again before evaluating." }, { status: 409 });
      }
      const review = body.review || {};
      const assessment = assessReviewCandidates(context, body.candidate_runs, review);
      // The snapshot is captured before reading/evaluating case output, and checked again after.
      const { data: freshHash, error: hashError } = await adminDb.rpc("uid_governance_candidate_hash", { p_proposal_id: proposalId });
      if (hashError || !freshHash || freshHash !== context.candidate_hash) {
        return Response.json({ error: "Proposal, scope, canonical rules or baselines changed during evaluation. Refresh and reassess." }, { status: 409 });
      }
      const { data: stored, error: storageError } = await adminDb.from("uid_governance_evaluations").insert({
        proposal_id: proposalId, candidate_hash: context.candidate_hash,
        baseline_ids: assessment.cases.map((c: any) => c.id), test_results: assessment.results,
        conflict_results: [{ note: String(review.review_note || "").slice(0, 4000), manually_reviewed: review.conflicts_reviewed === true,
          actor_user_id: user.id, product_truth_verified: review.product_truth_verified === true, visual_reviewed: review.visual_reviewed === true,
          scope_targets: context.targets.map((n: any) => ({ node_id: n.id, brand_name: n.brand_name, node_hash: n.node_hash })), issues: assessment.issues }],
        evaluation_status: assessment.status, critical_failures: assessment.critical_failures,
        evaluator_version: REVIEW_EVALUATOR_VERSION, completed_at: new Date().toISOString(),
      }).select("*").single();
      if (storageError) return Response.json({ error: storageError.message }, { status: 500 });
      return Response.json({ evaluation: stored, issues: assessment.issues, results: assessment.results,
        limitation: "Mechanical checks cover supplied output only. Artifact authenticity and creative visual quality require explicit Admin review; reference corpora alone cannot approve a change." });
    }
    if (body.mode === "governance_rollback_preview") {
      const {data:snapshot,error:se}=await adminDb.from("uid_governance_snapshots")
        .select("id,node_id,proposal_id,checkpoint,created_at").eq("id",body.snapshot_id).single();
      if(se||!snapshot)return Response.json({error:"Snapshot not found"},{status:404});
      const {data:hash,error:he}=await adminDb.rpc("uid_governance_node_hash",{p_node_id:snapshot.node_id});
      if(he||!hash)return Response.json({error:"Cannot resolve current node hash"},{status:500});
      return Response.json({snapshot,current_md5:hash,
        note:"Use current_md5 for concurrency guarded rollback after administrator review."});
    }
    if (body.mode === "governance_baseline_upsert") {
      const b=body.baseline||{};
      if(!b.brand_id||!b.branch_slug||!b.case_key||!b.source_brief||!b.approved_output||
        !b.expected_assertions||!["required_text","forbidden_text","required_keys","immutable_fields"].some(k=>Array.isArray(b.expected_assertions?.[k])&&b.expected_assertions[k].length))
        return Response.json({error:"Approved brief, expected assertions and output are required"},{status:422});
      const {data,error}=await adminDb.from("uid_governance_baselines").insert({
        brand_id:b.brand_id,branch_slug:b.branch_slug,case_key:b.case_key,
        source_brief:b.source_brief,approved_output:b.approved_output,
        expected_assertions:b.expected_assertions,approved_by:user.id,
        approved_at:new Date().toISOString()
      }).select().single();
      return error?Response.json({error:error.message},{status:500}):Response.json({baseline:data});
    }
    if (body.mode === "governance_list") {
      const [baselines,evaluations,snapshots,brands]=await Promise.all([
        adminDb.from("uid_governance_baselines").select("*").order("created_at",{ascending:false}).limit(200),
        adminDb.from("uid_governance_evaluations").select("*").order("created_at",{ascending:false}).limit(200),
        adminDb.from("uid_governance_snapshots").select("id,node_id,proposal_id,checkpoint,created_at").order("created_at",{ascending:false}).limit(200),
        adminDb.from("brands").select("id,slug,name").order("name")
      ]);
      if(baselines.error||evaluations.error||snapshots.error||brands.error)return Response.json({error:"Unable to load governance registry"},{status:500});
      return Response.json({baselines:baselines.data,evaluations:evaluations.data,snapshots:snapshots.data,brands:brands.data});
    }
    if (body.mode === "governance_rollback_proposal_preview") {
      const proposalId=String(body.proposal_id||"");
      const {data:snaps,error:se}=await adminDb.from("uid_governance_snapshots")
        .select("id,node_id,checkpoint,content_md,metadata,node_version,created_at")
        .eq("proposal_id",proposalId).in("checkpoint",["before","after"]).order("created_at",{ascending:false});
      if(se||!snaps?.length)return Response.json({error:"Snapshots not available"},{status:404});
      const latest=new Map<string,{before:any;after:any}>();
      for(const snap of snaps){
        const group=latest.get(snap.node_id)||{before:null,after:null};
        const checkpoint=snap.checkpoint as "before"|"after";
        if(!group[checkpoint])group[checkpoint]=snap;
        latest.set(snap.node_id,group);
      }
      const summary=[];
      for(const [nodeId,states] of latest){
        const {data:node}=await adminDb.from("knowledge_nodes")
          .select("id,slug,content_md,metadata,version").eq("id",nodeId).single();
        const {data:currentHash}=await adminDb.rpc("uid_governance_node_hash",{p_node_id:nodeId});
        summary.push({node_id:nodeId,slug:node?.slug,ready:Boolean(states.before&&states.after),
          current_md5:currentHash,after_checkpoint_id:states.after?.id||null});
      }
      return Response.json({proposal_id:proposalId,affected_nodes:summary,
        note:"Rollback is atomic; RPC will reject all nodes if any node has changed since this merge."});
    }
    if (body.mode === "governance_rollback_proposal") {
      const {data,error}=await adminDb.rpc("uid_governance_rollback_proposal",{
        p_proposal_id:body.proposal_id,p_actor_user_id:user.id
      });
      return error?Response.json({error:error.message},{status:409}):Response.json({result:data});
    }
    if (body.mode === "governance_rollback") {
      const {data,error}=await adminDb.rpc("uid_governance_rollback_snapshot",{
        p_snapshot_id:body.snapshot_id,p_actor_user_id:user.id,
        p_expected_current_md5:body.expected_current_md5
      });
      return error?Response.json({error:error.message},{status:409}):Response.json({result:data});
    }
    if (body.mode === "branch_guide_upsert") {
      const brandSlug = String(body.brand_slug || "").trim().toLowerCase();
      const branchSlug = String(body.branch_slug || "").trim().toLowerCase();
      if (!brandSlug || !branchSlug) {
        return Response.json({ error: "brand_slug and branch_slug are required" }, { status: 400 });
      }

      let imageUrl = String(body.image_url || "").trim();
      const dataUrl = String(body.image_data_base64 || "").trim();
      const mimeType = String(body.mime_type || "").trim().toLowerCase();

      if (dataUrl) {
        if (!["image/png","image/jpeg","image/webp"].includes(mimeType)) {
          return Response.json({ error: "PNG, JPEG, or WebP required" }, { status: 415 });
        }
        const clean = dataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\s+/g, "");
        if (!clean) return Response.json({ error: "Image data is required" }, { status: 400 });

        const binary = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
        if (!binary.length) return Response.json({ error: "Image data is invalid" }, { status: 400 });
        if (binary.length > 8 * 1024 * 1024) return Response.json({ error: "Image exceeds 8 MB" }, { status: 413 });

        const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
        const safeBrand = brandSlug.replace(/[^a-z0-9-]/g, "");
        const safeBranch = branchSlug.replace(/[^a-z0-9-]/g, "");
        const objectPath = `branch-guides/${safeBrand}/${safeBranch}-${Date.now()}.${ext}`;

        const { error: uploadError } = await adminDb.storage
          .from("feedback-context")
          .upload(objectPath, binary, { contentType: mimeType, upsert: false });

        if (uploadError) return Response.json({ error: uploadError.message }, { status: 500 });

        const { data: publicUrlData } = adminDb.storage.from("feedback-context").getPublicUrl(objectPath);
        imageUrl = publicUrlData.publicUrl;
      }

      const pageUrl = String(body.page_url || "").trim();
      const cssSelector = String(body.css_selector || "").trim();

      if (pageUrl) {
        let parsed: URL;
        try { parsed = new URL(pageUrl); } catch {
          return Response.json({ error: "Valid page_url required" }, { status: 400 });
        }
        if (parsed.protocol !== "https:") {
          return Response.json({ error: "Only HTTPS page URLs are allowed" }, { status: 400 });
        }
      }

      const payload = {
        brand_slug: brandSlug,
        branch_slug: branchSlug,
        title_vi: body.title_vi ? String(body.title_vi).trim() : null,
        description_vi: body.description_vi ? String(body.description_vi).trim() : null,
        usage_badge: body.usage_badge ? String(body.usage_badge).trim() : null,
        ratio_note: body.ratio_note ? String(body.ratio_note).trim() : null,
        output_note: body.output_note ? String(body.output_note).trim() : null,
        page_url: pageUrl || null,
        css_selector: cssSelector || null,
        preview_mode: pageUrl && cssSelector ? "selector" : "selector",
        image_url: pageUrl && cssSelector ? null : (imageUrl || null),
        image_caption: pageUrl && cssSelector ? null : (body.image_caption ? String(body.image_caption).trim() : null),
        updated_at: new Date().toISOString(),
      };

      const { data: guide, error } = await adminDb
        .from("branch_visual_guides")
        .upsert(payload, { onConflict: "brand_slug,branch_slug" })
        .select("*")
        .single();

      if (error) return Response.json({ error: error.message }, { status: 500 });

      return Response.json({ guide });
    }

    if (body.mode === "team_list") {
      const { data: rows, error } = await adminDb
        .from("creative_dna_team_members")
        .select("user_id,display_name,role,is_active,created_at,updated_at")
        .order("created_at", { ascending: true });

      if (error) return Response.json({ error: error.message }, { status: 500 });

      const members = await Promise.all(
        (rows || []).map(async (row: any) => {
          const { data: userData } = await adminDb.auth.admin.getUserById(row.user_id);
          return {
            ...row,
            email: userData?.user?.email || null,
          };
        }),
      );

      return Response.json({ members });
    }

    if (body.mode === "grant_admin") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: "Valid email required" }, { status: 400 });
      }

      let targetUser: any = null;
      let invited = false;

      for (let page = 1; page <= 10 && !targetUser; page++) {
        const { data: usersData, error: usersError } = await adminDb.auth.admin.listUsers({ page, perPage: 100 });
        if (usersError) return Response.json({ error: usersError.message }, { status: 500 });
        targetUser = (usersData?.users || []).find((u: any) => String(u.email || "").toLowerCase() === email) || null;
        if ((usersData?.users || []).length < 100) break;
      }

      if (!targetUser) {
        const { data: inviteData, error: inviteError } = await adminDb.auth.admin.inviteUserByEmail(email);
        if (inviteError) return Response.json({ error: inviteError.message }, { status: 500 });
        targetUser = inviteData?.user;
        invited = true;
      }

      if (!targetUser?.id) {
        return Response.json({ error: "Unable to resolve or invite user" }, { status: 500 });
      }

      const displayName = String(body.display_name || email.split("@")[0]).trim().slice(0, 120) || email;

      const { data: memberRow, error: memberError } = await adminDb
        .from("creative_dna_team_members")
        .upsert(
          {
            user_id: targetUser.id,
            display_name: displayName,
            role: "admin",
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        )
        .select("user_id,display_name,role,is_active,created_at,updated_at")
        .single();

      if (memberError) return Response.json({ error: memberError.message }, { status: 500 });

      return Response.json({
        member: { ...memberRow, email },
        invited,
        instruction: invited
          ? "Admin access granted and an invitation email was requested."
          : "Admin access granted to the existing user.",
      });
    }

    if (body.mode === "delete_all") {
      const status = String(body.status || "").trim().toLowerCase();
      const allowed = new Set(["pending","accepted","merged","rejected","all"]);
      if (!allowed.has(status)) {
        return Response.json({ error: "Valid status required" }, { status: 400 });
      }

      let query = adminDb
        .from("knowledge_proposals")
        .delete()
        .select("id,status");

      if (status !== "all") query = query.eq("status", status);

      const { data: deleted, error } = await query;
      if (error) return Response.json({ error: error.message }, { status: 500 });

      return Response.json({
        deleted_count: (deleted || []).length,
        status,
        instruction: "Selected proposal records were permanently deleted from the admin review queue.",
      });
    }

    if (body.mode === "list") {
      const { data, error } = await adminDb
        .from("knowledge_proposals")
        .select("id,status,raw_feedback,proposed_content_md,proposed_scope,change_summary,evidence_summary,submitted_by_name,created_at,reviewed_at,review_note,merged_at,resolution,context_images,brands(name),knowledge_nodes(title,slug)")
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) return Response.json({ error: error.message }, { status: 500 });

      return Response.json({
        proposals: (data || []).map((p: any) => ({
          id: p.id,
          status: p.status,
          raw_feedback: p.raw_feedback,
          proposed_content_md: p.proposed_content_md,
          proposed_scope: p.proposed_scope,
          change_summary: p.change_summary,
          evidence_summary: p.evidence_summary || {},
          submitted_by_name: p.submitted_by_name,
          created_at: p.created_at,
          reviewed_at: p.reviewed_at,
          review_note: p.review_note,
          merged_at: p.merged_at,
          resolution: p.resolution,
          context_images: p.context_images || [],
          brand_name: p.brands?.name,
          branch_title: p.knowledge_nodes?.title,
          branch_slug: p.knowledge_nodes?.slug,
        })),
      });
    }

    // Legacy manual merge is deliberately disabled until governed migration is supported.
    if (body.mode === "merge") {
      return Response.json({error:"Legacy merge is disabled pending governed migration; use verified evaluation flow."},{status:409});
    }
    if (body.mode === "review") {
      if (!body.proposal_id || !["accept", "reject"].includes(body.decision)) {
        return Response.json({ error: "proposal_id and valid decision required" }, { status: 400 });
      }

      if (body.decision === "accept") {
        const { data: currentHash, error: hashError } = await adminDb.rpc("uid_governance_candidate_hash", { p_proposal_id: body.proposal_id });
        if (hashError || !currentHash || body.candidate_hash !== currentHash)
          return Response.json({ error: "The reviewed proposal, scope, canonical rules or baselines changed. Refresh and review before merging." }, { status: 409 });
        if(!body.evaluation_id)
          return Response.json({error:"Passed regression evaluation ID required before Accept"},{status:422});
        const { data, error } = await adminDb.rpc("uid_governance_accept_merge", {
          p_proposal_id: body.proposal_id,
          p_actor_user_id: user.id,
          p_review_note: body.review_note || null,
          p_evaluation_id: body.evaluation_id,
        });

        if (error) return Response.json({ error: error.message }, { status: 409 });

        return Response.json({
          proposal: {
            id: data.proposal_id,
            status: data.status,
            merged_at: data.merged_at,
          },
          merged_nodes: data.merged_nodes,
          cross_brand_sync: data.cross_brand_sync,
          instruction: "Accepted and merged into canonical Creative DNA in one action.",
        });
      }

      const now = new Date().toISOString();
      const { data, error } = await adminDb
        .from("knowledge_proposals")
        .update({
          status: "rejected",
          reviewed_at: now,
          reviewed_by: user.id,
          review_note: body.review_note || null,
          updated_at: now,
        })
        .eq("id", body.proposal_id)
        .eq("status", "pending")
        .select("id,status,knowledge_node_id,brand_id,raw_feedback,proposed_scope,reviewed_at,context_images")
        .maybeSingle();

      if (error) return Response.json({ error: error.message }, { status: 500 });
      if (!data) return Response.json({ error: "Pending proposal not found" }, { status: 404 });

      return Response.json({
        proposal: data,
        instruction: "Rejected; canonical DNA unchanged.",
      });
    }

    return Response.json({ error: "mode must be list, review, merge, team_list, grant_admin, delete_all, or branch_guide_upsert" }, { status: 400 });
  },
};
