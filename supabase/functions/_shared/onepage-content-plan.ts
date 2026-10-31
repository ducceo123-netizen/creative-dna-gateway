import { ONEPAGE_UI_CONTENT_CONTRACT, validateOnepageUiCopy } from './onepage-ui-content.ts';
/** New-run structural checks. This is not a canonical patch, source receipt or approval. */
export const ONEPAGE_CONTENT_PLAN_VERSION = 'uid-onepage-content-plan/1';
export const ONEPAGE_CONTENT_PLAN_CONTRACT = {
  schema_version: ONEPAGE_CONTENT_PLAN_VERSION,
  required_before: 'BUILD_CONTENT_MAP',
  ui_content: ONEPAGE_UI_CONTENT_CONTRACT,
  provenance: 'Owner-requested banner simplification; enforcement of existing adaptive section and collection evidence rules. No canonical mutation.',
  instruction: 'Submit analysis.content_plan with the same research object before content authoring. Choose the verified product keyword as the entire banner title on both devices, without an appended emotional phrase, slogan or subtitle. Keep approved desktop support separate; mobile has no support/subtitle. Compare FAQ and Good To Know using unresolved buyer questions, practical visual explanations, source coverage and overlap with existing content. Neither mode is the default. Record why one is more useful and why the other is not selected. Preserve canonical counts: GTK uses three distinct supported notes; FAQ has one row per useful supported answer, no filler. Missing evidence blocks the affected content plan; never invent sources or substitute modes to pass. For collections, enumerate available products, disclose inspected coverage and exceptions, and distinguish shared claims from SKU-only details. Product Details retain one anchor SKU and three distinct factual closeups; choose their features from evidence, never assume board edges, flat print or hooks. Existing approved outcomes are not rewritten. Host semantic, evidence and pixel review plus content approval remain mandatory.',
  input_shape: {
    schema_version: ONEPAGE_CONTENT_PLAN_VERSION,
    banner: { product_keyword: 'verified product/line descriptor only', keyword_source_ids: ['inspected exact target PDP IDs'], desktop_title: 'exact product_keyword', mobile_title: 'exact product_keyword', desktop_support: 'separate approved support or empty', mobile_support: '', subtitle: '' },
    post_story: { mode: 'gtk | faq', rationale: 'specific comparison grounded in this research', alternative_rejected_reason: 'why the other mode adds less value', source_ids: ['inspected research sources informing the choice'], insight_indexes: ['distinct zero-based analysis.insights indexes; supported claim_ids required'] },
    details: { anchor_product_id: 'one verified scope product', items: [{ slot: 'detail_01 | detail_02 | detail_03', claim_ids: ['supported product facts applying to anchor'], visible_proof: 'distinct closeup proving this fact at the circular UI crop' }] },
    collection: { discovered_product_count: 'known count of matching valid products; document excluded/nonmatching products separately', enumeration_note: 'actual enumeration method and exclusions; no invented completeness', shared_claim_ids: ['supported collection/shared_subset facts used for line-level copy'], exceptions: 'variant exceptions and coverage limits, or explicit none verified' },
    ui_copy: 'Optional full draft keyed ONLY by selected template data-text-slot IDs. When supplied, all slots are required; FAQ row count equals selected insight count. Never add occasion heading/support or fixed section headings. Omit during research preflight when copy is not authored yet.',
  },
};
type Obj = Record<string, any>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, min = 1): v is string => typeof v === 'string' && v.trim().length >= min && v.length <= 4000;
const rows = (v: unknown): v is Obj[] => Array.isArray(v) && v.length <= 100 && v.every(obj);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 100 && v.every(x => text(x)) && new Set(v).size === v.length;
const normalize = (v: string) => v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function evaluateOnepageContentPlan(research: unknown, validation: { status: string; structurally_supported_claim_ids: string[] }, policyBlocked = false, minimumCollectionProducts?: number) {
  const issues: string[] = [];
  const finish = (status: string, mode: string | null = null) => ({ schema_version: ONEPAGE_CONTENT_PLAN_VERSION, status, issues: [...new Set(issues)], selected_mode: mode, semantics: 'HOST_REPORTED_REQUIRES_EVIDENCE_AND_SEMANTIC_REVIEW', content_approval: 'STILL_REQUIRED' });
  if (policyBlocked) return finish('BLOCKED_BY_EXISTING_POLICY');
  if (!['READY', 'READY_WITH_LIMITATIONS'].includes(validation.status)) return finish('AWAITING_VALID_RESEARCH');
  const p = obj(research) && obj(research.analysis) ? research.analysis.content_plan : undefined;
  if (p === undefined) return finish('REQUIRES_CONTENT_PLAN');
  if (!obj(research) || !obj(research.analysis) || !obj(research.scope) || !rows(research.scope.products) || !rows(research.sources) || !rows(research.claims) || !rows(research.analysis.insights) || !obj(p) || p.schema_version !== ONEPAGE_CONTENT_PLAN_VERSION) return finish('INVALID_CONTENT_PLAN');
  // Reject alternate block/copy fields rather than approving a draft that cannot map.
  const only = (value: unknown, keys: string[]) => obj(value) && Object.keys(value).some(key => !keys.includes(key));
  if (only(p, ['schema_version', 'banner', 'post_story', 'details', 'collection', 'ui_copy']) ||
      only(p.post_story, ['mode', 'rationale', 'alternative_rejected_reason', 'source_ids', 'insight_indexes']) ||
      only(p.details, ['anchor_product_id', 'items']) ||
      (rows(p.details?.items) && p.details.items.some((item: Obj) => only(item, ['slot', 'claim_ids', 'visible_proof']))) ||
      only(p.collection, ['discovered_product_count', 'enumeration_note', 'shared_claim_ids', 'exceptions'])) issues.push('UNKNOWN_CONTENT_PLAN_FIELD');
  if (Object.hasOwn(p, 'ui_copy')) issues.push(...validateOnepageUiCopy(p.ui_copy, p.post_story?.mode, Array.isArray(p.post_story?.insight_indexes) ? p.post_story.insight_indexes.length : 0));
  const sources = new Map(research.sources.map(s => [s.id, s]));
  const claims = new Map(research.claims.map(c => [c.id, c]));
  const supported = new Set(validation.structurally_supported_claim_ids);
  const facts = (refs: unknown, product?: string) => ids(refs) && refs.every(id => {
    const c = claims.get(id);
    return supported.has(id) && c?.kind === 'product_fact' && (!product || c.product_ids?.includes(product)) && ids(c.source_ids) && c.source_ids.every((sourceId: string) => sources.get(sourceId)?.evidence_origin !== 'ai_generated_illustration') && (!Array.isArray(c.evidence_items) || c.evidence_items.every((ref: Obj) => {
      if (!obj(ref)) return false;
      const source = sources.get(ref.source_id);
      const items = [source?.pdp_coverage?.gallery?.items, source?.pdp_coverage?.details?.items].flatMap(v => rows(v) ? v : []);
      return items.find(item => item.id === ref.item_id)?.evidence_origin !== 'ai_generated_illustration';
    }));
  });
  const b = p.banner;
  const bannerFields = new Set(['product_keyword', 'keyword_source_ids', 'desktop_title', 'mobile_title', 'desktop_support', 'mobile_support', 'subtitle']);
  if (obj(b) && Object.keys(b).some(key => !bannerFields.has(key))) issues.push('UNKNOWN_BANNER_COPY_FIELD');
  if (obj(b) && ['product_keyword', 'desktop_title', 'mobile_title'].some(key => typeof b[key] === 'string' && /[\r\n\u2028\u2029]/u.test(b[key]))) issues.push('MULTILINE_BANNER_COPY_FORBIDDEN');
  if (!obj(b) || !text(b.product_keyword) || !ids(b.keyword_source_ids) || b.keyword_source_ids.some((id: string) => sources.get(id)?.kind !== 'target_pdp' || sources.get(id)?.match !== 'exact' || sources.get(id)?.status !== 'inspected' || sources.get(id)?.evidence_origin === 'ai_generated_illustration')) issues.push('VERIFIED_PRODUCT_KEYWORD_REQUIRED');
  if (!obj(b) || !text(b.desktop_title) || !text(b.mobile_title) || !text(b.product_keyword) || normalize(b.desktop_title) !== normalize(b.product_keyword) || normalize(b.mobile_title) !== normalize(b.product_keyword)) issues.push('BANNER_TITLE_MUST_EQUAL_PRODUCT_KEYWORD');
  if (!obj(b) || typeof b.desktop_support !== 'string' || b.desktop_support.length > 4000 || b.mobile_support !== '' || b.subtitle !== '') issues.push('BANNER_SUPPORT_DESKTOP_ONLY_NO_SUBTITLE');
  const s = p.post_story;
  if (!obj(s) || !['gtk', 'faq'].includes(s.mode) || !text(s.rationale, 40) || !text(s.alternative_rejected_reason, 40) || !ids(s.source_ids) || s.source_ids.some((id: string) => !['inspected', 'partial'].includes(sources.get(id)?.status) || sources.get(id)?.evidence_origin === 'ai_generated_illustration')) issues.push('RESEARCH_BASED_MODE_COMPARISON_REQUIRED');
  if (!obj(s) || !Array.isArray(s.insight_indexes) || !s.insight_indexes.length || s.insight_indexes.length > 100 || new Set(s.insight_indexes).size !== s.insight_indexes.length || (s.mode === 'gtk' && s.insight_indexes.length !== 3)) issues.push('INVALID_POST_STORY_ITEMS');
  else {
    const seen = new Set<string>();
    for (const index of s.insight_indexes) {
      const i = Number.isInteger(index) && index >= 0 ? research.analysis.insights[index] : undefined;
      if (!obj(i) || !facts(i.claim_ids) || !text(i.concern) || !text(i.implication)) { issues.push('POST_STORY_SUPPORTED_ANSWER_REQUIRED'); continue; }
      if (!ids(s.source_ids) || i.claim_ids.some((id: string) => claims.get(id)?.source_ids?.some((sourceId: string) => !s.source_ids.includes(sourceId)))) issues.push('MODE_EVIDENCE_NOT_LINKED_TO_ANSWERS');
      const existing = research.analysis.insight_value?.existing_content;
      if (rows(existing) && existing.some(row => text(row.concern) && text(row.implication) && normalize(row.concern) === normalize(i.concern) && normalize(row.implication) === normalize(i.implication))) issues.push('POST_STORY_ALREADY_COVERED');
      const key = normalize(i.concern) + ':' + normalize(i.implication);
      if (seen.has(key)) issues.push('DUPLICATE_POST_STORY_INSIGHT');
      seen.add(key);
      if (research.scope.source_type === 'collection' && i.claim_ids.some((id: string) => claims.get(id)?.scope === 'sku')) issues.push('COLLECTION_POST_STORY_REQUIRES_SHARED_EVIDENCE');
    }
  }
  const d = p.details;
  if (!obj(d) || !research.scope.products.some((x: Obj) => x.id === d.anchor_product_id) || !rows(d.items) || d.items.length !== 3 || new Set(d.items.map((i: Obj) => i.slot)).size !== 3 || d.items.some((i: Obj) => !['detail_01', 'detail_02', 'detail_03'].includes(i.slot) || !facts(i.claim_ids, d.anchor_product_id) || !text(i.visible_proof, 20))) issues.push('THREE_EVIDENCED_ANCHOR_DETAILS_REQUIRED');
  else if (new Set(d.items.map((i: Obj) => normalize(i.visible_proof))).size !== 3) issues.push('DISTINCT_DETAIL_PROOFS_REQUIRED');
  if (research.scope.source_type === 'collection') {
    const c = p.collection;
    if (!obj(c) || !Number.isInteger(c.discovered_product_count) || c.discovered_product_count < research.scope.products.length || !text(c.enumeration_note, 40) || !text(c.exceptions) || !facts(c.shared_claim_ids) || c.shared_claim_ids.some((id: string) => !['collection', 'shared_subset'].includes(claims.get(id)?.scope))) issues.push('COLLECTION_COVERAGE_AND_SHARED_FACTS_REQUIRED');
    else {
      if (c.discovered_product_count > 1 && research.scope.products.length === 1) issues.push('COLLECTION_SINGLE_DEMO_COVERAGE');
      if (Number.isInteger(minimumCollectionProducts) && minimumCollectionProducts! > 0 && research.scope.products.length < Math.min(c.discovered_product_count, minimumCollectionProducts!)) issues.push('CANONICAL_COLLECTION_POOL_INSUFFICIENT');
    }
    if (obj(c) && research.scope.inventory_complete && c.discovered_product_count !== research.scope.products.length) issues.push('COLLECTION_COMPLETENESS_CONTRADICTION');
  }
  return finish(issues.length ? 'NEEDS_REVISION' : 'READY_FOR_HOST_REVIEW', issues.length ? null : s.mode);
}
