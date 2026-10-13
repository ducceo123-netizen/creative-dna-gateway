/** Trusted-host deterministic projection. This module never fetches or inspects media,
 * grants approval, executes a merge, or turns a compiler result into review evidence. */
import { prepareCanonicalRuleProjection, type OwnerRuleTarget, type OwnerRuleCompilation } from './owner-rule-plan.ts';
import {
  compileCreativeQuality, sourceHashes, stableJson, sha256, QUALITY_COMPILER,
  QUALITY_CATALOG_SCHEMA, QUALITY_AGENT_REVIEWED_SCHEMA, AGENT_REVIEWED_SCHEMA,
  AGENT_REVIEW_EVALUATOR, AGENT_REVIEW_SCOPE, OWNER_SUPPLEMENTAL_PRECEDENCE, MAX_OWNER_SUPPLEMENTS,
  type AgentReviewedSupplementalRule, type QualityBundle,
} from './creative-quality.ts';

export const AGENT_RULE_PLAN_SCHEMA = 'uid.agent-rule-plan.v1';
export const AGENT_COMPILER_RECEIPT_SCHEMA = 'uid.agent-compiler-receipt.v1';
type ObjectValue = Record<string, any>;
export type AgentReviewCore = {
  schema_version: 'uid.agent-review.v1'; decision: 'passed' | 'blocked'; review_note: string;
  media_receipts: ObjectValue[]; findings: ObjectValue[];
};
export type AgentRulePlan = {
  schema_version: typeof AGENT_RULE_PLAN_SCHEMA; request_id: string; attempt_id: string; proposal_id: string;
  candidate_hash: string; snapshot_hash: string; review_hash: string; targets: OwnerRuleTarget[];
};
export type AgentCompilerReceipt = {
  schema_version: typeof AGENT_COMPILER_RECEIPT_SCHEMA; status: 'COMPILED'; proof_scope: 'DETERMINISTIC_COMPILATION_ONLY';
  compiler_version: string; compiler_bundle_hash: string; request_id: string; attempt_id: string; proposal_id: string;
  candidate_hash: string; snapshot_hash: string; review_hash: string; plan_hash: string; compiled: OwnerRuleCompilation[];
};
export type AgentRulePlanResult = {
  status: 'COMPILED' | 'BLOCKED'; blockers: Array<{code: string; message: string; next_action: string}>;
  compiler_plan: AgentRulePlan | null; compiler_receipt: AgentCompilerReceipt | null;
};
class AgentPlanError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const fail = (code: string, message: string): never => { throw new AgentPlanError(code, message); };
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const clone = <T>(v: T): T => JSON.parse(stableJson(v));
const equal = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const sameIds = (a: unknown, b: string[]) => Array.isArray(a) && a.every(x => typeof x === 'string') && equal([...a].sort(), [...b].sort());
const timestamp = (v: unknown) => typeof v === 'string' && /[TZ]|[+-]\d\d:\d\d$/.test(v) ? Date.parse(v) : NaN;
const coreKeys = ['schema_version', 'decision', 'review_note', 'media_receipts', 'findings'];

/** The exact reviewed core is hashed; transport compiler fields cannot recurse into it. */
export function agentReviewCore(review: unknown): AgentReviewCore {
  if (!object(review) || Object.keys(review).some(k => ![...coreKeys, 'compiler_plan', 'compiler_receipt'].includes(k))
    || coreKeys.some(k => !Object.hasOwn(review, k)) || review.schema_version !== 'uid.agent-review.v1'
    || !['passed','blocked'].includes(review.decision) || !text(review.review_note) || review.review_note.trim().length < 20
    || !Array.isArray(review.media_receipts) || review.media_receipts.length > 256 || !Array.isArray(review.findings) || review.findings.length > 48
    || stableJson(review).length > 3000000)
    fail('invalid_review_core', 'A bounded genuine-review core is required; manual or caller approval flags cannot substitute for evidence.');
  const validated = review as ObjectValue;
  return Object.fromEntries(coreKeys.map(k => [k, clone(validated[k])])) as AgentReviewCore;
}

function validateReviewEvidence(claim: ObjectValue, core: AgentReviewCore) {
  const snapshot = claim.snapshot;
  if (core.decision !== 'passed') fail('review_not_passed', 'The review contains unresolved findings; compilation cannot approve them.');
  const manifest: ObjectValue[] = snapshot.media_manifest;
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 256 || manifest.some(m => !object(m) || !text(m.evidence_id,120) || !text(m.locator,4000) || !text(m.record_version,300))
    || new Set(manifest.map(m => m.evidence_id)).size !== manifest.length || core.media_receipts.length !== manifest.length)
    fail('media_coverage', 'Receipts must exactly cover the pinned nonempty source, baseline and candidate manifest.');
  const leasedAt = timestamp(claim.leased_at), expires = timestamp(claim.lease_expires_at), intentExpires = timestamp(claim.expires_at);
  if (!Number.isFinite(leasedAt) || !Number.isFinite(expires) || expires <= leasedAt || !Number.isFinite(intentExpires) || expires > intentExpires)
    fail('invalid_lease_window', 'A valid immutable lease window is required.');
  const locatorHashes = new Map<string,string>();
  for (const m of manifest) {
    const matches = core.media_receipts.filter(r => object(r) && r.evidence_id === m.evidence_id), r = matches[0];
    const fetched = timestamp(r?.retrieved_at), revalidated = timestamp(r?.revalidated_at);
    const inspectionMatches = object(r) && ((/^image\//.test(r.media_type) && r.inspection_method === 'image')
      || (/^video\//.test(r.media_type) && r.inspection_method === 'video')
      || (['application/pdf','text/html'].includes(r.media_type) && r.inspection_method === 'rendered')
      || (m.kind === 'source' && /^text\//.test(r.media_type) && ['read','rendered'].includes(r.inspection_method)));
    if (matches.length !== 1 || !object(r) || r.locator !== m.locator || r.record_version !== m.record_version
      || !hash(r.content_sha256) || r.revalidated_sha256 !== r.content_sha256
      || (m.expected_content_sha256 != null && m.expected_content_sha256 !== r.content_sha256)
      || (m.object_version != null && m.object_version !== r.object_version)
      || r.inspected !== true || !text(r.note) || r.note.trim().length < 20 || !inspectionMatches
      || !Number.isFinite(fetched) || !Number.isFinite(revalidated) || fetched < leasedAt || revalidated < fetched || revalidated > expires)
      fail('invalid_media_receipt', `Pinned evidence ${m.evidence_id} lacks a matching current-lease byte and inspection receipt.`);
    if (locatorHashes.has(r.locator) && locatorHashes.get(r.locator) !== r.content_sha256)
      fail('inconsistent_media_bytes', 'Repeated locators must refer to identical revalidated bytes.');
    locatorHashes.set(r.locator, r.content_sha256);
  }
  if (core.media_receipts.some(r => !manifest.some(m => m.evidence_id === r.evidence_id))) fail('unknown_media_receipt', 'An inspection receipt is outside the pinned manifest.');
  const targets = snapshot.rule_context.targets;
  const brands = [...new Set(targets.map((t: ObjectValue) => t.brand_id))];
  if (core.findings.length !== brands.length * 3) fail('criterion_coverage', 'Every affected brand needs exactly three evidence-linked review criteria.');
  for (const brand of brands) {
    const brandMedia = manifest.filter(m => m.brand_id === brand);
    if (!['source','baseline','candidate'].every(kind => brandMedia.some(m => m.kind === kind)))
      fail('missing_brand_media', 'Every affected brand needs actual source, approved-baseline and candidate evidence.');
    const evidenceIds = brandMedia.map(m => m.evidence_id), nodeIds = targets.filter((t: ObjectValue) => t.brand_id === brand).map((t: ObjectValue) => t.id);
    for (const criterion of ['product_truth','visual_quality','canonical_conflicts']) {
      const matches = core.findings.filter(f => object(f) && f.brand_id === brand && f.criterion === criterion), f = matches[0];
      if (matches.length !== 1 || !object(f) || f.result !== 'passed' || f.critical !== false || !text(f.note) || f.note.trim().length < 20
        || !sameIds(f.evidence_ids, evidenceIds) || !sameIds(f.canonical_node_ids, nodeIds))
        fail('criterion_not_passed', `${criterion} must have a passed, evidence-linked finding for every exact target of this brand.`);
    }
  }
}

/** Call only after real source/media review. The pinned CLI separately verifies
 * the loaded source bundle; SQL independently checks the lease, review and delta. */
export async function buildAgentReviewedRulePlan(inputClaim: unknown, review: unknown): Promise<AgentRulePlanResult> {
  try {
    const claim = inputClaim as ObjectValue;
    if (!object(inputClaim) || !uuid(claim.request_id) || !uuid(claim.proposal_id) || !(typeof claim.snapshot_hash === 'string' && /^sha256:[0-9a-f]{64}$/.test(claim.snapshot_hash))
      || !Number.isSafeInteger(claim.lease_version) || claim.lease_version < 1 || claim.lease_version > 999999999
      || claim.attempt_id !== `${claim.request_id}:${claim.lease_version}` || claim.evaluator_version !== AGENT_REVIEW_EVALUATOR
      || !text(claim.candidate_hash,300) || !object(claim.snapshot) || !object(claim.snapshot.rule_context)
      || claim.snapshot.candidate_hash !== claim.candidate_hash || claim.snapshot.rule_context.candidate_hash !== claim.candidate_hash
      || claim.snapshot.rule_context.proposal?.id !== claim.proposal_id || claim.snapshot.proposal?.id !== claim.proposal_id
      || claim.snapshot.compiler_capability?.compiler_version !== QUALITY_COMPILER || !hash(claim.snapshot.compiler_capability?.compiler_bundle_hash))
      fail('agent_claim_invalid', 'An exact fenced SQL claim and pinned compiler capability are required.');
    const core = agentReviewCore(review);
    if (!sameIds(claim.snapshot.targets?.map((t: ObjectValue) => t.id), claim.snapshot.rule_context.targets?.map((t: ObjectValue) => t.id) || []))
      fail('review_scope_mismatch', 'Reviewed targets differ from the actual compiler trigger closure.');
    validateReviewEvidence(claim, core);
    const prepared = await prepareCanonicalRuleProjection(claim.snapshot.rule_context);
    const { proposal, scope, canonical, rule, projected, brands, brandSlugs, master, isOnepage, dnas } = prepared;
    if (prepared.canonicalAppend)
      fail('catalog_required', 'Agent-reviewed canonical changes need an existing valid brand-keyed catalog; direct owner canonical append does not create compiler capability.');
    const shared = clone(master.metadata.creative_quality_contract);
    if (shared?.schema_version !== QUALITY_CATALOG_SCHEMA || !object(shared.contracts))
      fail('catalog_required', 'Agent-reviewed canonical changes need an existing valid brand-keyed catalog.');
    const reviewHash = await sha256(stableJson(core)), canonicalHash = await sha256(canonical);
    const supplementId = `agent-review:${claim.attempt_id}`;
    for (let i = 0; i < projected.length; i++) {
      const catalog = isOnepage ? shared : clone(projected[i].metadata.creative_quality_contract);
      const bundle: QualityBundle = catalog?.schema_version === QUALITY_CATALOG_SCHEMA ? catalog.contracts?.[brands[i].slug] : null;
      if (!object(bundle)) fail('quality_bundle_missing', 'The exact reviewed brand bundle is missing.');
      const owners = bundle.owner_supplemental_rules || [], agents = bundle.agent_reviewed_supplemental_rules || [];
      if (owners.length + agents.length >= MAX_OWNER_SUPPLEMENTS) fail('supplement_capacity_exceeded', 'The combined supplemental capacity is full; no prior rule is removed or truncated.');
      if ([...owners,...agents].some(r => r.proposal_id === proposal.id || r.canonical_text === canonical))
        fail('supplement_identity_collision', 'This proposal or exact canonical text already has a supplemental decision.');
      const hashes = await sourceHashes({ brand: brands[i], branch: projected[i], brand_dna: dnas[i], visual_references: [] });
      const supplement: AgentReviewedSupplementalRule = {
        schema_version: AGENT_REVIEWED_SCHEMA, id: supplementId, proposal_id: proposal.id, request_id: claim.request_id, attempt_id: claim.attempt_id,
        evaluator_version: AGENT_REVIEW_EVALUATOR, decision_kind: 'owner_approved_agent_review', snapshot_hash: claim.snapshot_hash, review_hash: reviewHash,
        review_scope: AGENT_REVIEW_SCOPE, canonical_text: canonical, declared_scope: rule.scope,
        scope: { brands: brandSlugs, branches: [scope.branch_slug] }, rule_class: rule.rule_class, confidence: rule.confidence,
        source: { node: 'branch', locator: `agent-review:${proposal.id}:${claim.attempt_id}`, canonical_text_hash: canonicalHash },
        accepted_source_hashes: hashes, precedence: OWNER_SUPPLEMENTAL_PRECEDENCE,
      };
      bundle.schema_version = QUALITY_AGENT_REVIEWED_SCHEMA;
      bundle.agent_reviewed_supplemental_rules = [...agents, supplement];
      bundle.revision = `agent-review:${claim.attempt_id}`;
      bundle.source_hashes = hashes;
      if (!isOnepage) projected[i].metadata.creative_quality_contract = catalog;
    }
    if (isOnepage) projected.forEach(n => { n.metadata.creative_quality_contract = clone(shared); });
    const compiled: OwnerRuleCompilation[] = [];
    for (let i = 0; i < projected.length; i++) {
      const result = await compileCreativeQuality({ brand: brands[i], branch: projected[i], brand_dna: dnas[i], visual_references: [] });
      if (result.status !== 'COMPILED' || !result.agent_reviewed_supplemental_rules.some(r => r.id === supplementId && r.canonical_text === canonical))
        fail('proposed_quality_blocked', `${brands[i].slug}: the exact agent-reviewed supplement did not compile (${result.errors.join(', ')}).`);
      compiled.push({ node_id: projected[i].id, brand_slug: brands[i].slug, source_hashes: result.source_hashes, contract_hash: result.contract_hash, added_supplement_ids: [supplementId] });
    }
    const identities = { request_id: claim.request_id, attempt_id: claim.attempt_id, proposal_id: proposal.id,
      candidate_hash: claim.candidate_hash, snapshot_hash: claim.snapshot_hash, review_hash: reviewHash };
    const plan: AgentRulePlan = { schema_version: AGENT_RULE_PLAN_SCHEMA, ...identities, targets: projected.map(n => ({
      node_id: n.id, content_md: n.content_md, metadata: n.metadata, version: n.version, input_schema: n.input_schema, status: n.status, confidence: n.confidence,
    })) };
    const receipt: AgentCompilerReceipt = { schema_version: AGENT_COMPILER_RECEIPT_SCHEMA, status: 'COMPILED', proof_scope: 'DETERMINISTIC_COMPILATION_ONLY',
      compiler_version: QUALITY_COMPILER, compiler_bundle_hash: claim.snapshot.compiler_capability.compiler_bundle_hash,
      ...identities, plan_hash: await sha256(stableJson(plan)), compiled };
    return { status: 'COMPILED', blockers: [], compiler_plan: plan, compiler_receipt: receipt };
  } catch (error) {
    return { status: 'BLOCKED', compiler_plan: null, compiler_receipt: null, blockers: [{
      code: error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'agent_compiler_error',
      message: error instanceof Error ? error.message : 'The deterministic agent-review plan could not be safely compiled.',
      next_action: 'Keep the proposal pending; resolve the exact source, scope, schema or evidence blocker before a fresh review attempt.',
    }] };
  }
}
