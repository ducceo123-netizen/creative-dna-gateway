/** v4 adapter. v1-v3 compiler sources remain byte-for-byte unchanged. */
import { compileCreativeQuality, stableJson, sha256, ownerSupplementalShapeValid, QUALITY_CATALOG_SCHEMA, MAX_OWNER_SUPPLEMENTS, OWNER_SUPPLEMENTAL_SCHEMA, OWNER_SUPPLEMENTAL_PRECEDENCE } from './creative-quality.ts';
import { RULE_COMPILER, RULE_REVIEW_SCOPE, RULE_REVIEW_EVALUATOR } from './agent-rule-policy.ts';
export const RULE_QUALITY_SCHEMA = 'uid-creative-quality/4';
export const RULE_SUPPLEMENT_SCHEMA = 'uid.agent-rule-reviewed-supplemental-rule.v1';
const clone = (x: any) => JSON.parse(stableJson(x));
const obj = (x: any) => !!x && typeof x === 'object' && !Array.isArray(x);
const hash = (x: any) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export function ruleSupplementValid(r: any, brand: string, branch: string): boolean {
  const keys = ['schema_version','id','proposal_id','request_id','attempt_id','decision_kind','evaluator_version','snapshot_hash','review_hash','review_scope','canonical_text','declared_scope','scope','rule_class','confidence','source','accepted_source_hashes','precedence','visual_qc_performed'];
  if (!obj(r) || stableJson(Object.keys(r).sort()) !== stableJson(keys.sort()) || r.schema_version !== RULE_SUPPLEMENT_SCHEMA
    || r.decision_kind !== 'agent_rule_review' || r.visual_qc_performed !== false || r.review_scope !== RULE_REVIEW_SCOPE
    || r.evaluator_version !== RULE_REVIEW_EVALUATOR || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.request_id)
    || r.attempt_id !== `${r.request_id}:${String(r.attempt_id).split(':')[1]}` || !/^[1-9][0-9]{0,8}$/.test(String(r.attempt_id).split(':')[1])
    || r.id !== `agent-rule:${r.attempt_id}` || !/^sha256:[a-f0-9]{64}$/.test(r.snapshot_hash) || !hash(r.review_hash)
    || r.source?.locator !== `agent-rule:${r.proposal_id}:${r.attempt_id}`) return false;
  // Reuse only grammar/body validation. This temporary object is never emitted or persisted.
  const {request_id,attempt_id,evaluator_version,snapshot_hash,review_hash,review_scope, ...body} = r;
  return ownerSupplementalShapeValid({...body, schema_version: OWNER_SUPPLEMENTAL_SCHEMA, id: `owner:${r.proposal_id}`,
    decision_kind: 'owner_direct_rule', source: {...r.source,locator:`owner-rule:${r.proposal_id}`}, semantic_consistency:'NOT_PROVEN_BY_DETERMINISTIC_CHECKS'},brand,branch);
}
export function stripRuleCatalog(metadata: any) {
  const copy = clone(metadata);
  const stored = copy.creative_quality_contract;
  const bundles = stored?.schema_version === QUALITY_CATALOG_SCHEMA ? Object.values(stored.contracts || {}) : [stored];
  for (const b of bundles as any[]) if (b?.schema_version === RULE_QUALITY_SCHEMA) {
    delete b.agent_rule_reviewed_supplemental_rules;
    b.schema_version = b.agent_reviewed_supplemental_rules?.length ? 'uid-creative-quality/3' : b.owner_supplemental_rules?.length ? 'uid-creative-quality/2' : 'uid-creative-quality/1';
  }
  return copy;
}
export async function compileRuleQuality(dna: any, context: any = {}) {
  const stored = dna.branch?.metadata?.creative_quality_contract;
  const b = stored?.schema_version === QUALITY_CATALOG_SCHEMA ? stored.contracts?.[dna.brand?.slug] : stored;
  const raw = b?.agent_rule_reviewed_supplemental_rules;
  const rules = Array.isArray(raw) ? raw : [];
  const errors: string[] = [];
  if ((b?.schema_version === RULE_QUALITY_SCHEMA && (!Array.isArray(raw) || !raw.length)) || (raw !== undefined && b?.schema_version !== RULE_QUALITY_SCHEMA)) errors.push('RULE_REVIEW_SCHEMA_INVALID');
  if (raw !== undefined && (!Array.isArray(raw) || rules.length > MAX_OWNER_SUPPLEMENTS || !rules.every(r => ruleSupplementValid(r,dna.brand?.slug,dna.branch?.slug)))) errors.push('RULE_REVIEW_SUPPLEMENT_INVALID');
  const all = [...(b?.owner_supplemental_rules || []),...(b?.agent_reviewed_supplemental_rules || []),...rules];
  if (all.length > MAX_OWNER_SUPPLEMENTS || new Set(all.map(r=>r?.proposal_id)).size !== all.length || new Set(all.map(r=>r?.id)).size !== all.length) errors.push('RULE_REVIEW_SUPPLEMENT_COLLISION');
  for (const r of rules) if (ruleSupplementValid(r,dna.brand?.slug,dna.branch?.slug)) {
    if (await sha256(r.canonical_text) !== r.source.canonical_text_hash || !dna.branch.content_md.includes(r.canonical_text)) errors.push('RULE_REVIEW_SOURCE_DRIFT');
  }
  const base = await compileCreativeQuality({...dna,branch:{...dna.branch,metadata:stripRuleCatalog(dna.branch?.metadata || {})}},context);
  const {contract_hash: _old, ...contract} = base;
  const combined = [...new Set([...base.errors,...errors])].sort();
  const result = {...contract, compiler_version:RULE_COMPILER, status:combined.length?'BLOCKED':'COMPILED',errors:combined,
    rules:combined.length?[]:contract.rules, owner_supplemental_rules:combined.length?[]:contract.owner_supplemental_rules, agent_reviewed_supplemental_rules:combined.length?[]:contract.agent_reviewed_supplemental_rules,
    gates:combined.length?{...contract.gates,content_authoring:'BLOCKED',asset_generation:'BLOCKED'}:contract.gates,
    agent_rule_reviewed_supplemental_rules: combined.length ? [] : rules,
    agent_rule_reviewed_supplemental_policy:{review_scope:RULE_REVIEW_SCOPE,visual_qc_performed:false,precedence:OWNER_SUPPLEMENTAL_PRECEDENCE,
      instruction:'Apply the exact delegated rule text alongside existing hard constraints. Semantic review is scoped to its snapshot; no output, media, product claim or future generation has passed QC through this decision.'}};
  return {...result,contract_hash:await sha256(stableJson(result))};
}
/** Reader dispatch is format-based, not a grant to create or approve a v4 record.
 * Older catalogs retain their exact compiler output and hash. */
export async function compileCompatibleQuality(dna: any, context: any = {}): Promise<any> {
  const stored=dna.branch?.metadata?.creative_quality_contract;
  const bundles=stored?.schema_version===QUALITY_CATALOG_SCHEMA?Object.values(stored.contracts||{}):[stored];
  const v4=bundles.some((b:any)=>b?.schema_version===RULE_QUALITY_SCHEMA||(obj(b)&&Object.hasOwn(b,'agent_rule_reviewed_supplemental_rules')));
  return v4?compileRuleQuality(dna,context):compileCreativeQuality(dna,context);
}
