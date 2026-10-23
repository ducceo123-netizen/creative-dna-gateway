/** A host-reported selection audit, not another research pipeline or a semantic truth classifier. */
export const INSIGHT_VALUE_VERSION = 'uid-onepage-insight-value/1';
export const INSIGHT_VALUE_GUIDANCE = 'Before BUILD_CONTENT_MAP, reuse the research already collected and compare each proposed insight with existing covered content. Prefer a concrete customer decision or action over generic benefits. Add only new supported information or a demonstrably clearer decision in an existing section; otherwise skip. Do not force extra FAQ, Good to Know, sections or research just to fill this assessment. A family-level review may suggest a question, never establish an exact-SKU experience, fact, cause or frequency. Answer using current matching official product evidence. AI-generated illustrations may explain an answer but never prove it. Check applicability, variants, freshness and contradictory evidence; do not transfer care or material claims between products. Perform this short comparison in every new Onepage run using existing research. Record the actual comparison in analysis.insight_value; submit candidates: [] when nothing adds value. The envelope stays optional for older clients, but its absence means NOT_ASSESSED, not permission to claim this check passed. No additional source hunt or customer question is required just to fill it. The evaluator checks declared structure and detectable duplication only; host semantic/evidence review and all canonical, content approval and pixel gates remain required.';
export const INSIGHT_VALUE_CONTRACT = {
  schema_version: INSIGHT_VALUE_VERSION,
  execution: 'REUSE_EXISTING_RESEARCH_BEFORE_BUILD_CONTENT_MAP',
  execution_step: 'SELECT_INCREMENTAL_CUSTOMER_VALUE',
  invoke_with: 'Same compile_onepage_job research object, after research validation and before content mapping; not a separate API or knowledge-base sync',
  optional: true,
  input_shape: {
    schema_version: INSIGHT_VALUE_VERSION,
    baseline_note: '40–4000 characters identifying the current content/plan compared, or why no content exists yet; host-reported, not server-verified freshness',
    existing_content: [{ id: 'covered content ID', concern: 'question already answered', implication: 'answer already conveyed', claim_ids: ['existing research claim IDs'], section: 'existing content section' }],
    candidates: [{
      insight_index: 'zero-based index in analysis.insights; no new product claims here',
      novelty: 'new_information | clearer_decision | already_covered',
      customer_job: 'choose_variant | use_correctly | avoid_mismatch | understand_limit | none',
      customer_action: 'internal description of decision/action enabled, never new facts or publish-ready copy; empty only for a skipped candidate',
      applicability: 'current_scope_verified | family_only | stale | unknown',
      evidence: 'supported | insufficient | conflicting',
      reason: '40–4000 characters explaining actual incremental value or omission and evidence limits',
    }],
  },
  evidence_origin: 'Sources and evidence items may declare evidence_origin: retrieved_source | ai_generated_illustration. Declared AI illustrations are never claim evidence. Missing origin is not a verification attestation.',
  output: 'eligible_insight_indexes are candidates for host review, never approval or newly verified facts; skip/blocked entries retain reason codes',
  instruction: INSIGHT_VALUE_GUIDANCE,
};

type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, min = 1): v is string => typeof v === 'string' && v.trim().length >= min && v.length <= 4000;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(x => text(x)) && new Set(v).size === v.length;
const rows = (v: unknown, max = 100): v is Obj[] => Array.isArray(v) && v.length <= max && v.every(object);
const normalize = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const claimKey = (row: Obj) => JSON.stringify([...row.claim_ids].sort());
const fingerprint = (row: Obj) => JSON.stringify([normalize(row.concern), normalize(row.implication), claimKey(row)]);

export function evaluateInsightValue(research: unknown, validation: { status: string; structurally_supported_claim_ids: string[] }, policyBlocked = false) {
  const decisions: { insight_index: number; disposition: 'eligible' | 'skip' | 'blocked'; reasons: string[] }[] = [];
  const finish = (status: string, issues: string[] = []) => ({
    schema_version: INSIGHT_VALUE_VERSION, status, issues,
    eligible_insight_indexes: decisions.filter(d => d.disposition === 'eligible').map(d => d.insight_index),
    decisions, assessment: 'HOST_REPORTED_NOT_SERVER_VERIFIED',
    semantics: 'REQUIRES_HOST_REVIEW', existing_gates: 'UNCHANGED',
    next_action: status === 'NOT_ASSESSED' ? 'Compare existing research to current covered content; submit the optional audit in the same compiler call, or record no useful additions. Do not repeat research.' : status === 'NO_INCREMENTAL_VALUE' ? 'Skip additions and continue existing supported content through unchanged gates.' : 'Review candidate meaning and current evidence before using any eligible insight in existing content slots; blocked candidates stay omitted.',
    baseline: 'HOST_REPORTED_CURRENT_CONTENT_NOT_SERVER_VERIFIED',
  });
  const raw = object(research) && object(research.analysis) ? research.analysis.insight_value : undefined;
  if (raw === undefined) return finish('NOT_ASSESSED');
  if (policyBlocked) return finish('BLOCKED_BY_EXISTING_POLICY', ['CANONICAL_POLICY_BLOCKED']);
  if (!['READY', 'READY_WITH_LIMITATIONS'].includes(validation.status)) return finish('AWAITING_VALID_RESEARCH', ['RESEARCH_NOT_READY']);
  if (!object(research) || !object(research.analysis) || !rows(research.analysis.insights) || !rows(research.analysis.conflicts) || !rows(research.claims) || !rows(research.sources) || !object(raw) || raw.schema_version !== INSIGHT_VALUE_VERSION || !text(raw.baseline_note, 40) || !rows(raw.existing_content) || !rows(raw.candidates)) return finish('NEEDS_REVISION', ['INVALID_INSIGHT_VALUE_SHAPE']);
  const supported = new Set(validation.structurally_supported_claim_ids);
  const contentIds = new Set<string>();
  for (const item of raw.existing_content) {
    if (!text(item.id) || contentIds.has(item.id) || !text(item.concern) || !text(item.implication) || !text(item.section) || !ids(item.claim_ids) || item.claim_ids.some(id => !supported.has(id))) return finish('NEEDS_REVISION', ['INVALID_EXISTING_CONTENT']);
    contentIds.add(item.id);
  }
  const seenIndexes = new Set<number>();
  // Validate the whole optional envelope before selecting anything from it.
  for (const candidate of raw.candidates) {
    if (!Number.isInteger(candidate.insight_index) || candidate.insight_index < 0 || candidate.insight_index >= research.analysis.insights.length || seenIndexes.has(candidate.insight_index) ||
        !['new_information', 'clearer_decision', 'already_covered'].includes(candidate.novelty) ||
        !['choose_variant', 'use_correctly', 'avoid_mismatch', 'understand_limit', 'none'].includes(candidate.customer_job) ||
        typeof candidate.customer_action !== 'string' || candidate.customer_action.length > 4000 ||
        !['current_scope_verified', 'family_only', 'stale', 'unknown'].includes(candidate.applicability) ||
        !['supported', 'insufficient', 'conflicting'].includes(candidate.evidence) || !text(candidate.reason, 40)) return finish('NEEDS_REVISION', ['INVALID_CANDIDATE']);
    const insight = research.analysis.insights[candidate.insight_index];
    if (!text(insight.concern) || !text(insight.implication) || !text(insight.section) || !ids(insight.claim_ids)) return finish('NEEDS_REVISION', ['INVALID_INSIGHT_REFERENCE']);
    seenIndexes.add(candidate.insight_index);
  }
  const claims = new Map(research.claims.map(c => [c.id, c]));
  const sources = new Map(research.sources.map(s => [s.id, s]));
  const accepted = new Set<string>();
  // Page-wide coverage, not section-local: moving a fact or combining covered facts is not new information.
  const coveredClaimIds = new Set<string>(raw.existing_content.flatMap((item: Obj) => item.claim_ids));
  for (const candidate of raw.candidates) {
    const insight = research.analysis.insights[candidate.insight_index];
    const blocked: string[] = [], skipped: string[] = [];
    if (!ids(insight.claim_ids) || !insight.claim_ids.length || insight.claim_ids.some((id: string) => !supported.has(id))) blocked.push('SUPPORTED_CLAIMS_REQUIRED');
    if (candidate.evidence !== 'supported') blocked.push(`EVIDENCE_${candidate.evidence.toUpperCase()}`);
    if (candidate.applicability !== 'current_scope_verified') blocked.push(`APPLICABILITY_${candidate.applicability.toUpperCase()}`);
    for (const id of insight.claim_ids) {
      const claim = claims.get(id);
      if (!claim) continue;
      // An analogue question alone is not a factual customer answer.
      if (claim.kind === 'analogue_insight') blocked.push('ANALOGUE_IS_QUESTION_NOT_ANSWER');
      for (const sourceId of claim.source_ids) {
        const source = sources.get(sourceId);
        if (source?.evidence_origin === 'ai_generated_illustration') blocked.push('AI_ILLUSTRATION_NOT_EVIDENCE');
      }
      // Non-product claims may carry extra fields ignored by the base research schema.
      // Never assume those untrusted nested refs/inventories are iterable or well formed.
      if (claim.evidence_items !== undefined && (!rows(claim.evidence_items) || claim.evidence_items.some(ref => !text(ref.source_id) || !text(ref.item_id) || !claim.source_ids.includes(ref.source_id)))) {
        blocked.push('INVALID_EVIDENCE_REFS');
      } else for (const ref of claim.evidence_items ?? []) {
        const coverage = sources.get(ref.source_id)?.pdp_coverage;
        if (!object(coverage) || !object(coverage.gallery) || !object(coverage.details) || !rows(coverage.gallery.items, 300) || !rows(coverage.details.items, 300)) {
          blocked.push('INVALID_EVIDENCE_REFS');
          continue;
        }
        const items = [...coverage.gallery.items, ...coverage.details.items];
        const matches = items.filter(item => item.id === ref.item_id);
        if (matches.length !== 1) blocked.push('INVALID_EVIDENCE_REFS');
        if (matches.some(item => item.evidence_origin === 'ai_generated_illustration')) blocked.push('AI_ILLUSTRATION_NOT_EVIDENCE');
      }
      if (research.analysis.conflicts.some((conflict: Obj) => conflict.claim_ids.includes(id))) blocked.push('CONFLICT_REQUIRES_SEPARATE_REVIEW');
    }
    if (candidate.novelty === 'already_covered') skipped.push('ALREADY_COVERED');
    if (candidate.customer_job === 'none' || !text(candidate.customer_action, 20)) skipped.push('NO_CONCRETE_CUSTOMER_ACTION');
    const key = fingerprint(insight);
    if (accepted.has(key)) skipped.push('DUPLICATE_CANDIDATE');
    const exactCovered = raw.existing_content.some((item: Obj) => fingerprint(item) === key);
    const coveredClaims = insight.claim_ids.every((id: string) => coveredClaimIds.has(id));
    if (exactCovered || (candidate.novelty === 'new_information' && coveredClaims)) skipped.push('NO_INCREMENTAL_INFORMATION');
    const disposition = blocked.length ? 'blocked' : skipped.length ? 'skip' : 'eligible';
    decisions.push({ insight_index: candidate.insight_index, disposition, reasons: [...new Set([...blocked, ...skipped])] });
    if (disposition === 'eligible') { accepted.add(key); insight.claim_ids.forEach((id: string) => coveredClaimIds.add(id)); }
  }
  return finish(decisions.some(d => d.disposition === 'eligible') ? 'READY_FOR_HOST_REVIEW' : decisions.some(d => d.disposition === 'blocked') ? 'NEEDS_REVISION' : 'NO_INCREMENTAL_VALUE');
}
