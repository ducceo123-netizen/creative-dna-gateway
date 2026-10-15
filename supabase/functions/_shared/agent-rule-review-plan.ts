/** Deterministic rule-only plan builder. No model, network, permissions, baseline creation or writes. */
import {prepareCanonicalRuleProjection} from './owner-rule-plan.ts';
import {stableJson,sha256,sourceHashes,MAX_OWNER_SUPPLEMENTS,OWNER_SUPPLEMENTAL_PRECEDENCE} from './creative-quality.ts';
import {compileRuleQuality,stripRuleCatalog,RULE_QUALITY_SCHEMA,RULE_SUPPLEMENT_SCHEMA} from './agent-rule-quality.ts';
import {PILOT_RULES,PILOT_SCOPE,PILOT_BRANDS,RULE_REVIEW_MODE,RULE_REVIEW_SCOPE,RULE_REVIEW_EVALUATOR,RULE_COMPILER} from './agent-rule-policy.ts';
const object = (v:any) => !!v && typeof v==='object' && !Array.isArray(v);
const uuid = (v:any) => typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v:any) => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const clone = (v:any) => JSON.parse(stableJson(v));
const equal = (a:any,b:any) => stableJson(a)===stableJson(b);
const exact = (v:any, keys:string[]) => object(v) && equal(Object.keys(v).sort(),[...keys].sort());
const fail = (code:string,message:string):never => {throw Object.assign(new Error(message),{code});};
const prose = (v:any) => typeof v==='string' && v.trim().length>=40 && v.length<=4000;
const sorted = (a:any[]) => [...a].sort();
export function ruleReviewSourceRecords(context:any) {
  const records = [{id:'rule-context', record:context},...context.targets,...context.compiler_context.brand_dna_nodes,...context.compiler_context.dependent_nodes];
  const map = new Map<string,any>();
  for(const record of records) {
    if(!object(record)||typeof record.id!=='string') fail('source_record_invalid','Every canonical source needs an immutable identity.');
    if(map.has(record.id)&&!equal(map.get(record.id),record)) fail('source_record_collision','Repeated source identities have different records.');
    map.set(record.id,record);
  }
  return [...map.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export async function buildAgentRuleReviewPlan(claim:any, review:any) {
  try {
    if(!object(claim)||!uuid(claim.request_id)||!uuid(claim.proposal_id)||!uuid(claim.owner_user_id)
      || !Number.isInteger(claim.lease_version)||claim.lease_version<1||claim.lease_version>999999999
      || claim.attempt_id!==`${claim.request_id}:${claim.lease_version}` || claim.evaluator_version!==RULE_REVIEW_EVALUATOR
      || !/^sha256:[a-f0-9]{64}$/.test(claim.snapshot_hash||'') || !object(claim.snapshot)) fail('invalid_rule_claim','A fenced v3 rule-review claim is required.');
    const s=claim.snapshot, c=s.rule_context, intent=claim.intent, capability=s.compiler_capability;
    if(!object(intent)||intent.schema_version!=='uid.review-intent.v3'||intent.review_mode!==RULE_REVIEW_MODE
      || intent.owner_user_id!==claim.owner_user_id || intent.proposal_id!==claim.proposal_id
      || !object(c)||c.proposal?.id!==claim.proposal_id || c.candidate_hash!==claim.candidate_hash || s.candidate_hash!==claim.candidate_hash
      || intent.proposed_content_md!==c.proposal.proposed_content_md || intent.proposed_scope!==c.proposal.proposed_scope
      || intent.source_node_id!==c.proposal.knowledge_node_id || !equal(intent.targets,c.targets.map((t:any)=>({id:t.id,brand_id:t.brand_id,slug:t.slug})).sort((a:any,b:any)=>a.id.localeCompare(b.id))))
      fail('intent_mode_scope_mismatch','The exact delegated v3 rule patch and target closure must match the snapshot; v2 is not upgradeable by the host.');
    if(capability?.review_mode!==RULE_REVIEW_MODE||capability?.compiler_version!==RULE_COMPILER||!hash(capability?.compiler_bundle_hash)) fail('compiler_capability_missing','The server must pin the separate rule-review compiler capability.');
    const policy=s.rule_policy, op=policy?.operation;
    if(!Object.hasOwn(PILOT_RULES,op||'')||policy?.enabled!==true||intent.operation!==op
      || c.proposal.proposed_content_md!==(PILOT_RULES as any)[op] || c.proposal.proposed_scope!==PILOT_SCOPE
      || policy.canonical_sha256!==await sha256(c.proposal.proposed_content_md)
      || !equal(policy.brand_slugs,PILOT_BRANDS)||!equal(sorted(c.targets.map((t:any)=>t.brand_slug)),PILOT_BRANDS)
      || c.scope?.branch_slug!=='onepage-system'||c.scope.cross_brand!==true||c.scope.structural!==true
      || !equal(policy.target_node_ids,sorted(c.targets.map((t:any)=>t.id)))) fail('unsupported_rule_policy','Only an explicitly activated exact pilot operation and its complete three-brand Onepage scope may use rule-only review.');
    if(!exact(review,['schema_version','decision','review_note','source_receipts','findings','visual_qc_performed','review_scope'])
      || review.schema_version!=='uid.agent-rule-review.v1'||review.decision!=='passed'||!prose(review.review_note)
      || review.visual_qc_performed!==false||review.review_scope!==RULE_REVIEW_SCOPE||!Array.isArray(review.source_receipts)||!Array.isArray(review.findings))
      fail('invalid_rule_review','A genuine scoped semantic review is required; image-QC or owner-decision claims are not permitted.');
    const start=Date.parse(claim.leased_at),end=Date.parse(claim.lease_expires_at),expires=Date.parse(claim.expires_at),now=Date.now();
    if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(expires)||start>now||end<=now||end<=start||end-start>900000||end>expires)
      fail('invalid_lease_window','A current 900-second-or-shorter fenced lease within the owner intent is required.');
    const records=ruleReviewSourceRecords(c);
    if(records.length>128||review.source_receipts.length!==records.length) fail('source_coverage','Read every exact canonical, brand DNA and dependency record in this lease.');
    for(const r of records) {
      const receipts=review.source_receipts.filter((x:any)=>x.node_id===r.id),receipt=receipts[0];
      if(receipts.length!==1||!exact(receipt,['node_id','record_sha256','read_at','revalidated_at','note'])||receipt.record_sha256!==await sha256(stableJson(r))
        || !prose(receipt.note)||Date.parse(receipt.read_at)<start||Date.parse(receipt.revalidated_at)<Date.parse(receipt.read_at)
        || !Number.isFinite(Date.parse(receipt.read_at))||!Number.isFinite(Date.parse(receipt.revalidated_at))||Date.parse(receipt.revalidated_at)>now||Date.parse(receipt.revalidated_at)>=end)
        fail('source_receipt_invalid','Each source receipt must identify the actual read and revalidated immutable record within this lease.');
    }
    if(review.findings.length!==c.targets.length*3) fail('finding_coverage','Every canonical target requires rule semantics, scope fidelity and canonical conflict findings.');
    const recordIds=records.map(r=>r.id);
    for(const t of c.targets) for(const criterion of ['rule_semantics','scope_fidelity','canonical_conflicts']) {
      const findings=review.findings.filter((f:any)=>f.node_id===t.id&&f.criterion===criterion),f=findings[0];
      if(findings.length!==1||!exact(f,['node_id','criterion','result','note','source_node_ids'])||f.result!=='passed'||!prose(f.note)||!equal(f.source_node_ids,recordIds))
        fail('finding_not_passed','Each target criterion needs a genuine source-linked passed finding; uncertainty cannot pass.');
    }
    // Validate v4 source envelopes before adapting only catalog representations for
    // the unchanged v2 projection primitive. Source hashes exclude the catalog itself.
    for(const t of c.targets) {
      const brand=c.compiler_context.brands.find((b:any)=>b.id===t.brand_id),dna=c.compiler_context.brand_dna_nodes.find((d:any)=>d.brand_id===t.brand_id);
      const result=await compileRuleQuality({brand,branch:t,brand_dna:dna,visual_references:[]});
      if(result.status!=='COMPILED') fail('preexisting_quality_blocked',result.errors.join(', '));
    }
    const adapted=clone(c);
    adapted.targets.forEach((t:any)=>{t.metadata=stripRuleCatalog(t.metadata);});
    adapted.compiler_context.projected_targets.forEach((t:any)=>{t.metadata=stripRuleCatalog(t.metadata);});
    const p=await prepareCanonicalRuleProjection(adapted);
    if(p.canonicalAppend||!p.isOnepage) fail('compiled_onepage_required','Pilot rules require the existing three-brand Onepage quality catalog.');
    const originals=new Map(c.compiler_context.projected_targets.map((t:any)=>[t.id,t]));
    p.projected.forEach((t:any)=>{t.metadata=clone((originals.get(t.id) as any).metadata);});
    const masterOriginal=c.targets.find((t:any)=>t.id===p.master.id),catalog=clone(masterOriginal.metadata.creative_quality_contract);
    const reviewHash=await sha256(stableJson(review)),canonicalHash=await sha256(p.canonical),id=`agent-rule:${claim.attempt_id}`;
    for(let i=0;i<p.projected.length;i++) {
      const bundle=catalog.contracts[p.brands[i].slug];
      const prior=[...(bundle.owner_supplemental_rules||[]),...(bundle.agent_reviewed_supplemental_rules||[]),...(bundle.agent_rule_reviewed_supplemental_rules||[])];
      if(prior.length>=MAX_OWNER_SUPPLEMENTS||prior.some((r:any)=>r.proposal_id===claim.proposal_id||r.canonical_text===p.canonical)) fail('supplement_collision','Capacity or an existing exact rule prevents adding a second supplemental decision.');
      const hashes=await sourceHashes({brand:p.brands[i],branch:p.projected[i],brand_dna:p.dnas[i]});
      bundle.schema_version=RULE_QUALITY_SCHEMA;
      bundle.agent_rule_reviewed_supplemental_rules=[...(bundle.agent_rule_reviewed_supplemental_rules||[]),{
        schema_version:RULE_SUPPLEMENT_SCHEMA,id,proposal_id:claim.proposal_id,request_id:claim.request_id,attempt_id:claim.attempt_id,
        decision_kind:RULE_REVIEW_MODE,evaluator_version:RULE_REVIEW_EVALUATOR,snapshot_hash:claim.snapshot_hash,review_hash:reviewHash,
        review_scope:RULE_REVIEW_SCOPE,visual_qc_performed:false,canonical_text:p.canonical,declared_scope:p.rule.scope,
        scope:{brands:p.brandSlugs,branches:[p.scope.branch_slug]},rule_class:p.rule.rule_class,confidence:p.rule.confidence,
        source:{node:'branch',locator:`agent-rule:${claim.proposal_id}:${claim.attempt_id}`,canonical_text_hash:canonicalHash},accepted_source_hashes:hashes,precedence:OWNER_SUPPLEMENTAL_PRECEDENCE}];
      bundle.source_hashes=hashes;bundle.revision=id;
    }
    p.projected.forEach((t:any)=>{t.metadata.creative_quality_contract=clone(catalog);});
    const compiled=[];
    for(let i=0;i<p.projected.length;i++) {
      const result=await compileRuleQuality({brand:p.brands[i],branch:p.projected[i],brand_dna:p.dnas[i],visual_references:[]});
      if(result.status!=='COMPILED'||!result.agent_rule_reviewed_supplemental_rules.some((r:any)=>r.id===id)) fail('proposed_quality_blocked',result.errors.join(', '));
      compiled.push({node_id:p.projected[i].id,brand_slug:p.brands[i].slug,source_hashes:result.source_hashes,contract_hash:result.contract_hash,added_supplement_ids:[id]});
    }
    const identity={request_id:claim.request_id,attempt_id:claim.attempt_id,proposal_id:claim.proposal_id,candidate_hash:claim.candidate_hash,snapshot_hash:claim.snapshot_hash,review_hash:reviewHash};
    const plan={schema_version:'uid.agent-rule-review-plan.v1',...identity,targets:p.projected.map(t=>({node_id:t.id,content_md:t.content_md,metadata:t.metadata,version:t.version,input_schema:t.input_schema,status:t.status,confidence:t.confidence}))};
    return {status:'COMPILED',blockers:[],compiler_plan:plan,compiler_receipt:{schema_version:'uid.agent-rule-review-compiler-receipt.v1',status:'COMPILED',proof_scope:'DETERMINISTIC_COMPILATION_ONLY',compiler_version:RULE_COMPILER,compiler_bundle_hash:capability.compiler_bundle_hash,...identity,plan_hash:await sha256(stableJson(plan)),compiled}};
  } catch(error:any) { return {status:'BLOCKED',compiler_plan:null,compiler_receipt:null,blockers:[{code:error?.code||'rule_compiler_error',message:error?.message||'Rule compilation failed closed.'}]}; }
}
