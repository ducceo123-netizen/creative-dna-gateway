/** Pure owner-decision projection. No network, model, credentials, writes or visual QC. */
import {
  compileCreativeQuality, sourceHashes, sha256, stableJson,
  QUALITY_CATALOG_SCHEMA, QUALITY_COMPILER, QUALITY_SCHEMA, QUALITY_SUPPLEMENTED_SCHEMA, QUALITY_AGENT_REVIEWED_SCHEMA, OWNER_SUPPLEMENTAL_SCHEMA, OWNER_SUPPLEMENTAL_PRECEDENCE, MAX_OWNER_SUPPLEMENTS,
  type OwnerSupplementalRule, type QualityBundle, type ResolvedDna,
} from './creative-quality.ts';

export const OWNER_RULE_PLAN_SCHEMA = 'uid.owner-rule-plan.v1';
export const OWNER_CANONICAL_APPEND_SCHEMA = 'uid.owner-canonical-append.v1';
const HEADINGS = ['Generalized Rule', 'Expected Behavior', 'Reject Conditions', 'Scope', 'Rule Class', 'Confidence'] as const;
const UNCOMPILED_LEAF_BRANCHES = new Set(['ldp-system', 'home-hero', 'ldp-hero', 'ugc-image', 'recipient-image', 'seasonal-banner', 'shop-by-product-image', 'shop-by-categories', 'niche-product-combo']);
type JsonObject = Record<string, any>;
export type CanonicalOwnerRule = {
  generalized_rule: string; expected_behavior: string; reject_conditions: string;
  scope: string; rule_class: 'STRUCTURAL' | 'BRAND_STYLE' | 'WORKFLOW'; confidence: 'HIGH' | 'MEDIUM';
};
export type OwnerRuleTarget = {
  node_id: string; content_md: string; metadata: JsonObject; version: string;
  input_schema: unknown; status: string; confidence: unknown;
};
/** Display-only appendix provenance. It is not a compiled quality supplement. */
export type OwnerCanonicalAppend = Omit<OwnerSupplementalRule, 'schema_version' | 'accepted_source_hashes'> & {
  schema_version: typeof OWNER_CANONICAL_APPEND_SCHEMA; accepted_source_hashes?: never;
};
export type OwnerRuleAddition = (OwnerSupplementalRule | OwnerCanonicalAppend) & { target_node_ids: string[]; affected_brands: string[] };
export type OwnerRulePlan = {
  schema_version: typeof OWNER_RULE_PLAN_SCHEMA;
  candidate_hash: string; rule_hash: string; targets: OwnerRuleTarget[];
};
export type OwnerRuleCompilation = { node_id: string; brand_slug: string; source_hashes: { branch: string; brand_dna: string }; contract_hash: string; added_supplement_ids: string[] };
export type OwnerRulePlanResult = {
  eligible: boolean; blockers: Array<{ code: string; message: string; next_action: string }>;
  plan_kind: 'canonical_append' | 'compiled_supplement' | null;
  plan: OwnerRulePlan | null; plan_hash: string | null; additions: OwnerRuleAddition[];
  compiler_version: string | null; compiled: OwnerRuleCompilation[];
  visual_qc_performed: false; semantic_consistency: 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS';
};
class PlanError extends Error {
  constructor(readonly code: string, message: string, readonly next_action?: string) { super(message); }
}
const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, max = 1000000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const equal = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const fail = (code: string, message: string, next_action?: string): never => { throw new PlanError(code, message, next_action); };
const clone = <T>(v: T): T => JSON.parse(stableJson(v));
const slug = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Deliberately ASCII whitespace for exact PostgreSQL/JS parity. */
export const normalizeOwnerRuleText = (s: string) => s.trim().toLowerCase().replace(/[ \t\r\n]+/g, ' ');

/** The exact canonical grammar is authoritative; loose substring matches are unsafe. */
export function parseCanonicalOwnerRule(value: unknown): CanonicalOwnerRule {
  if (!string(value, 16000) || value !== value.trim() || value.includes('\r') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    fail('invalid_canonical_rule', 'Use the exact bounded six-heading canonical rule format.');
  const input = value as string;
  const matches = [...input.matchAll(/^## ([^\n]+)\n/gm)];
  if (matches.length !== HEADINGS.length || matches[0]?.index !== 0 || matches.some((m, i) => m[1] !== HEADINGS[i]))
    fail('invalid_canonical_headings', 'Expected each canonical heading exactly once, in the documented order.');
  const values = matches.map((match, i) => input.slice(match.index! + match[0].length, matches[i + 1]?.index ?? input.length).trim());
  if (values.some(v => !v || /^#{1,6}\s/m.test(v) || /```|~~~/m.test(v)))
    fail('invalid_canonical_sections', 'Every canonical section must contain plain rule text, without nested headings or code blocks.');
  const [generalized_rule, expected_behavior, reject_conditions, scope, rule_class, confidence] = values;
  if ([generalized_rule, expected_behavior, reject_conditions].some(v => v.length > 4000) || scope.length > 500)
    fail('rule_text_too_long', 'Each canonical rule section must fit 4,000 characters and scope must fit 500; no text is truncated.');
  const rejects = reject_conditions.split('\n');
  if (rejects.length > 12 || rejects.some(v => !/^- \S/.test(v) || v.length > 802))
    fail('invalid_reject_conditions', 'Reject Conditions must have one to twelve nonempty bullet lines, each at most 800 characters.');
  if (!['STRUCTURAL', 'BRAND_STYLE', 'WORKFLOW'].includes(rule_class))
    fail('unsupported_rule_class', 'The supplemental rule needs an explicitly supported creative rule class.');
  if (!['HIGH', 'MEDIUM'].includes(confidence))
    fail('uncertain_rule', 'The canonical rule needs HIGH or MEDIUM confidence before owner acceptance.');
  if (rejects.some(v => [generalized_rule, expected_behavior].some(x => normalizeOwnerRuleText(x) === normalizeOwnerRuleText(v.slice(2)))))
    fail('self_conflicting_rule', 'The rule requires and rejects the same exact behavior.');
  return { generalized_rule, expected_behavior, reject_conditions, scope, rule_class, confidence } as CanonicalOwnerRule;
}

function metadataForMirror(master: JsonObject, brandName: string): JsonObject {
  return { ...clone(master), active_brand: brandName, onepage_master_brand: 'PawfectHouse',
    onepage_sync_mode: 'PAWFECTHOUSE_MASTER_100_PERCENT', cross_brand_onepage_structure: 'IDENTICAL_HARD',
    brand_difference_scope: 'BRAND_DNA_EXPRESSION_ONLY' };
}
const mutation = (node: JsonObject): OwnerRuleTarget => ({
  node_id: node.id, content_md: node.content_md, metadata: node.metadata, version: node.version,
  input_schema: node.input_schema, status: node.status, confidence: node.confidence,
});
function validateNode(node: unknown, kind: string): asserts node is JsonObject {
  if (!object(node) || !string(node.id, 120) || !string(node.brand_id, 120) || !slug(node.slug)
    || !string(node.version, 120) || typeof node.content_md !== 'string' || node.content_md.length > 1000000
    || !object(node.metadata) || !string(node.status, 80) || !Object.hasOwn(node, 'input_schema') || !Object.hasOwn(node, 'confidence')) fail('invalid_source_node', `Invalid ${kind} source node snapshot.`);
}
function dnaFor(node: JsonObject, brand: JsonObject, dna: JsonObject): ResolvedDna {
  return { brand: { slug: brand.slug }, branch: node, brand_dna: dna, visual_references: [] };
}
function checkDirectOpposites(rule: CanonicalOwnerRule, nodes: JsonObject[]) {
  const clauses = (rule.generalized_rule + '\n' + rule.expected_behavior).split(/[\n.]/)
    .map(normalizeOwnerRuleText).filter(v => v.length >= 12);
  for (const node of nodes) {
    const stored = node.metadata.creative_quality_contract;
    const bundles = stored?.schema_version === QUALITY_CATALOG_SCHEMA && object(stored.contracts) ? Object.values(stored.contracts) : [stored];
    const prior = [node.content_md, ...bundles.flatMap((b: any) => Array.isArray(b?.rules) ? b.rules.map((r: any) => String(r.instruction || '')) : [])]
      .flatMap(v => String(v).split(/[\n.]/)).map(v => normalizeOwnerRuleText(v.replace(/^[#* -]+/, ''))).filter(Boolean);
    for (const clause of clauses) for (const old of prior) for (const prefix of ['never ', 'do not ', 'must not ', 'không ']) {
      if (old === prefix + clause || clause === prefix + old)
        fail('canonical_conflict', 'A proposed clause directly negates existing canonical guidance; resolve the exact conflict before adding it.');
    }
  }
}

/** A read-only projection primitive, not an approval or external write capability. */
export async function prepareCanonicalRuleProjection(snapshot: unknown) {
    if (!object(snapshot) || !object(snapshot.proposal) || !object(snapshot.scope) || !object(snapshot.compiler_context)
      || !string(snapshot.candidate_hash, 300))
      fail('compiler_snapshot_required', 'An exact server-generated proposal, scope and compiler snapshot is required.');
    const s = snapshot as JsonObject, p = s.proposal, scope = s.scope, context = s.compiler_context;
    if (!UUID.test(p.id || '') || p.status !== 'pending' || p.merged_at != null)
      fail('pending_proposal_required', 'A valid pending unmerged proposal is required.');
    const canonical = typeof p.proposed_content_md === 'string' ? p.proposed_content_md.trim() : p.proposed_content_md;
    const rule = parseCanonicalOwnerRule(canonical);
    if (rule.scope !== p.proposed_scope || scope.proposed_scope !== p.proposed_scope)
      fail('scope_mismatch', 'Canonical, proposal and target scopes differ.');
    if (context.policy_version !== OWNER_RULE_PLAN_SCHEMA || !Array.isArray(s.targets) || !s.targets.length || s.targets.length > 16
      || !Array.isArray(context.projected_targets) || context.projected_targets.length !== s.targets.length
      || !Array.isArray(context.brands) || !Array.isArray(context.brand_dna_nodes))
      fail('compiler_snapshot_invalid', 'The compiler snapshot lacks bounded exact target projections or brand sources.');
    const targets: JsonObject[] = clone(s.targets).sort((a: JsonObject, b: JsonObject) => a.id.localeCompare(b.id));
    const projected: JsonObject[] = clone(context.projected_targets).sort((a: JsonObject, b: JsonObject) => a.id.localeCompare(b.id));
    targets.forEach(n => validateNode(n, 'branch')); projected.forEach(n => validateNode(n, 'projected branch'));
    if (new Set(targets.map(n => n.id)).size !== targets.length || !equal(targets.map(n => n.id), projected.map(n => n.id))
      || !equal(targets.map(n => n.id), [...(scope.target_node_ids || [])].sort())
      || !slug(scope.branch_slug) || targets.some(n => n.slug !== scope.branch_slug)
      || !targets.some(n => n.id === p.knowledge_node_id) || scope.source_node_id !== p.knowledge_node_id)
      fail('target_scope_mismatch', 'The source, exact target membership or branch scope changed.');
    if (!['onepage-system','ldp-system','home-hero','ldp-hero','ugc-image','recipient-image','seasonal-banner','shop-by-product-image','shop-by-categories','niche-product-combo'].includes(scope.branch_slug))
      fail('unsupported_branch', 'Only a supported canonical leaf or the verified structural Onepage closure can receive this plan.');
    const isOnepage = scope.branch_slug === 'onepage-system';
    if (isOnepage && (scope.cross_brand !== true || scope.structural !== true))
      fail('onepage_mirror_scope', 'Onepage master/mirror triggers do not permit an isolated brand update.');
    const brands = targets.map(n => {
      const matches = context.brands.filter((b: any) => b.id === n.brand_id);
      if (matches.length !== 1 || !slug(matches[0].slug) || !string(matches[0].name, 500)
        || n.brand_slug !== matches[0].slug || n.brand_name !== matches[0].name)
        fail('brand_source_missing', 'Every target needs its exact, unambiguous current brand identity.');
      return matches[0];
    });
    if (new Set(brands.map(b => b.slug)).size !== brands.length)
      fail('duplicate_brand_target', 'Multiple target branches for the same brand need an explicit projection policy.');
    const brandSlugs = brands.map(b => b.slug).sort();
    const masterIndex = isOnepage ? targets.findIndex(n => n.id === context.master_node_id) : 0;
    if (masterIndex < 0 || (isOnepage && (context.master_count !== 1 || brands[masterIndex].name.toLowerCase() !== 'pawfecthouse'
        || targets.filter((_, i) => brands[i].name.toLowerCase() === 'pawfecthouse').length !== 1
        || brands.some(b => !['pawfecthouse', 'giftsoul', 'soulprise'].includes(b.name.toLowerCase())))))
      fail('onepage_master_invalid', 'Onepage requires one verified PawfectHouse master and the actual supported mirrors.');
    const master = targets[masterIndex];
    const block = context.merge_block_text;
    if (typeof block !== 'string' || !block.startsWith('\n\n## ACCEPTED ADMIN FEEDBACK — ')
      || !/^\n\n## ACCEPTED ADMIN FEEDBACK — \d{4}-\d{2}-\d{2}\n/.test(block)
      || block !== block.slice(0, block.indexOf('\n', 3) + 1) + canonical + '\n')
      fail('merge_projection_invalid', 'The SQL merge block is not bound to the exact canonical rule and UTC merge date.');
    const nextContent = (n: JsonObject) => n.content_md.includes(canonical) ? n.content_md : n.content_md + block;
    // Absence is an explicit route, never a fallback after a failed compile.
    // Inspect the original JSON as well: cloning must not turn a present but
    // invalid contract (including undefined in a non-JSON caller) into absence.
    const catalogCount = s.targets.filter((n: JsonObject) => Object.hasOwn(n.metadata, 'creative_quality_contract')).length;
    if (!isOnepage && catalogCount > 0 && catalogCount < targets.length)
      fail('mixed_quality_scope', 'Phạm vi này có cả nhánh đã có quality contract và nhánh chưa có contract.',
        'Tách phạm vi thành các nhóm đồng nhất hoặc chuẩn bị bản cập nhật bao gồm đầy đủ contract và các nhánh phụ thuộc.');
    const canonicalAppend = !isOnepage && catalogCount === 0;
    if (canonicalAppend) {
      if (!UNCOMPILED_LEAF_BRANCHES.has(scope.branch_slug))
        fail('unsupported_branch', 'Nhánh này chưa hỗ trợ thêm rule canonical trực tiếp.',
          'Dùng luồng quản trị của nhánh này; Brand DNA cần bản cập nhật bao gồm các nhánh phụ thuộc.');
      if (!Array.isArray(context.dependent_nodes) || context.dependent_nodes.length
        || targets.some(n => targets.some(parent => n.parent_id === parent.id)))
        fail('unsupported_dependency_scope', 'Chưa xác minh được phạm vi không có nhánh con đang hoạt động phụ thuộc vào thay đổi này.',
          'Tải lại phạm vi; nếu có nhánh phụ thuộc, chuẩn bị bản cập nhật bao gồm toàn bộ các nhánh đó trước khi duyệt.');
      if (typeof scope.cross_brand !== 'boolean' || typeof scope.structural !== 'boolean'
        || (!scope.cross_brand && targets.length !== 1) || (rule.rule_class === 'BRAND_STYLE' && scope.cross_brand))
        fail('target_scope_mismatch', 'The resolved leaf scope must preserve exact local or cross-brand creative-rule boundaries.');
      if (s.compiler_context.projected_targets.some((n: JsonObject) => Object.hasOwn(n.metadata, 'creative_quality_contract')))
        fail('merge_projection_mismatch', 'Canonical append cannot create a quality catalog or change its absence.');
    }
    if (!canonicalAppend && !isOnepage && (targets.length !== 1 || scope.cross_brand !== false))
      fail('unsupported_leaf_scope', 'A compiled non-Onepage plan must target exactly one canonical leaf.');
    const dnas = canonicalAppend ? [] : targets.map(n => {
      const matches = context.brand_dna_nodes.filter((d: any) => d.brand_id === n.brand_id);
      if (matches.length !== 1) fail('brand_dna_ambiguous', 'Each target must have exactly one server-resolved latest active brand DNA source.');
      validateNode(matches[0], 'brand DNA');
      if (matches[0].slug !== 'brand-dna' || matches[0].status !== 'active') fail('brand_dna_invalid', 'The latest brand DNA source must be active.');
      return clone(matches[0]);
    });
    for (let i = 0; i < targets.length; i++) {
      const before = targets[i], after = projected[i], source = isOnepage ? master : before;
      const expectedMetadata = isOnepage && i !== masterIndex ? metadataForMirror(master.metadata, brands[i].name) : source.metadata;
      if (before.status !== 'active' || before.content_md !== source.content_md || !equal(before.metadata, expectedMetadata)
        || ['version', 'input_schema', 'status', 'confidence'].some(k => !equal(before[k], source[k])))
        fail('mirror_preservation_blocked', 'A target is inactive or diverges from its master; acceptance would change unrelated canonical fields.');
      if (after.brand_id !== before.brand_id || after.slug !== before.slug || after.content_md !== nextContent(source)
        || !equal(after.metadata, expectedMetadata)
        || ['version', 'input_schema', 'status', 'confidence'].some(k => !equal(after[k], source[k])))
        fail('merge_projection_mismatch', 'The proposed SQL content, version or metadata projection does not match the supported merge behavior.');
      if (!canonicalAppend) {
        const baseline = await compileCreativeQuality(dnaFor(before, brands[i], dnas[i]));
        if (baseline.status !== 'COMPILED')
          fail('preexisting_quality_blocked', `${brands[i].slug}: quality contract hiện tại đang thiếu, không hợp lệ hoặc không khớp nguồn canonical.`,
            'Khôi phục hoặc cập nhật quality contract qua luồng kiểm tra nguồn hiện có rồi tải lại; không bỏ qua lỗi bằng duyệt rule trực tiếp.');
      }
    }
    checkDirectOpposites(rule, targets);
    return { snapshot: s, proposal: p, scope, context, canonical, rule, targets, projected, brands, brandSlugs, master, isOnepage, dnas, canonicalAppend };
}

/** Only call with the server-produced, immutable SQL preflight snapshot. */
export async function buildOwnerRulePlan(snapshot: unknown): Promise<OwnerRulePlanResult> {
  const base = { compiler_version: QUALITY_COMPILER, visual_qc_performed: false as const, semantic_consistency: 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS' as const };
  try {
    if (!object(snapshot) || !string(snapshot.direct_rule?.rule_hash, 300) || !UUID.test(snapshot.compiler_context?.owner_user_id || ''))
      fail('verified_owner_required', 'The owner plan requires an authenticated owner preflight and exact direct-rule hash.');
    const { snapshot: s, proposal: p, scope, context, canonical, rule, targets, projected, brands, brandSlugs, master, isOnepage, dnas, canonicalAppend } = await prepareCanonicalRuleProjection(snapshot);
    if (canonicalAppend) {
      if (s.direct_rule.owner_authorized !== true)
        fail('verified_owner_required', 'The SQL preflight must explicitly authorize the configured owner.');
      // SQL remains authoritative for protected/noncreative instructions. An
      // append plan must not bypass any of its existing eligibility checks.
      if (s.direct_rule.eligible !== true || !Array.isArray(s.direct_rule.blockers) || s.direct_rule.blockers.length)
        fail('direct_rule_ineligible', 'The server eligibility checks must all pass before appending canonical guidance.');
      const textHash = await sha256(canonical);
      const additions: OwnerRuleAddition[] = projected.map((n, i) => ({
        schema_version: OWNER_CANONICAL_APPEND_SCHEMA, id: `owner:${p.id}`, proposal_id: p.id,
        decision_kind: 'owner_direct_rule', canonical_text: canonical, declared_scope: rule.scope,
        scope: { brands: brandSlugs, branches: [scope.branch_slug] }, rule_class: rule.rule_class, confidence: rule.confidence,
        source: { node: 'branch', locator: `owner-rule:${p.id}`, canonical_text_hash: textHash },
        precedence: OWNER_SUPPLEMENTAL_PRECEDENCE,
        semantic_consistency: 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS', visual_qc_performed: false,
        target_node_ids: [n.id], affected_brands: [brands[i].slug],
      }));
      // Keep the existing SQL plan schema exact. Display provenance is not
      // written into source metadata, nor does it imply a quality/QC pass.
      const plan: OwnerRulePlan = { schema_version: OWNER_RULE_PLAN_SCHEMA,
        candidate_hash: s.candidate_hash, rule_hash: s.direct_rule.rule_hash, targets: projected.map(mutation) };
      return { eligible: true, blockers: [], plan_kind: 'canonical_append', plan, plan_hash: await sha256(stableJson(plan)),
        additions, compiled: [], ...base, compiler_version: null };
    }
    const additions: OwnerRuleAddition[] = [];
    const sharedCatalog = clone(master.metadata.creative_quality_contract);
    if (sharedCatalog?.schema_version !== QUALITY_CATALOG_SCHEMA || !object(sharedCatalog.contracts))
      fail('catalog_required', 'This supported acceptance path requires an existing brand-keyed quality catalog.');
    const compiled: OwnerRuleCompilation[] = [];
    // Hashes omit the entire quality catalog, so this is acyclic and preserves
    // every unrelated catalog property and every unaffected brand contract.
    for (let i = 0; i < projected.length; i++) {
      const catalog = isOnepage ? sharedCatalog : clone(projected[i].metadata.creative_quality_contract);
      const bundle: QualityBundle = catalog?.schema_version === QUALITY_CATALOG_SCHEMA ? catalog.contracts?.[brands[i].slug] : catalog;
      if (!object(bundle) || ![QUALITY_SCHEMA, QUALITY_SUPPLEMENTED_SCHEMA, QUALITY_AGENT_REVIEWED_SCHEMA].includes(bundle.schema_version) || !Array.isArray(bundle.rules))
        fail('quality_bundle_missing', `No exact compiled bundle for ${brands[i].slug}.`);
      const previous = bundle.owner_supplemental_rules || [];
      const agentPrevious = bundle.agent_reviewed_supplemental_rules || [];
      if (previous.length + agentPrevious.length >= MAX_OWNER_SUPPLEMENTS)
        fail('supplement_capacity_exceeded', 'The additive change exceeds the limit of 16 owner supplements; no existing guidance is removed or truncated.');
      if ([...previous, ...agentPrevious].some(r => r.id === `owner:${p.id}` || r.proposal_id === p.id || r.canonical_text === canonical))
        fail('owner_rule_id_collision', 'This proposal already has a compiled supplement; refresh the recorded decision.');
      const hashes = await sourceHashes(dnaFor(projected[i], brands[i], dnas[i]));
      const supplement: OwnerSupplementalRule = {
        schema_version: OWNER_SUPPLEMENTAL_SCHEMA, id: `owner:${p.id}`, proposal_id: p.id,
        decision_kind: 'owner_direct_rule', canonical_text: canonical, declared_scope: rule.scope,
        scope: { brands: brandSlugs, branches: [scope.branch_slug] }, rule_class: rule.rule_class, confidence: rule.confidence,
        source: { node: 'branch', locator: `owner-rule:${p.id}`, canonical_text_hash: await sha256(canonical) },
        accepted_source_hashes: hashes, precedence: OWNER_SUPPLEMENTAL_PRECEDENCE,
        semantic_consistency: 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS', visual_qc_performed: false,
      };
      bundle.schema_version = agentPrevious.length ? QUALITY_AGENT_REVIEWED_SCHEMA : QUALITY_SUPPLEMENTED_SCHEMA;
      bundle.owner_supplemental_rules = [...previous, supplement];
      bundle.revision = `owner-rule:${p.id}`;
      bundle.source_hashes = hashes;
      additions.push({ ...clone(supplement), target_node_ids: [projected[i].id], affected_brands: [brands[i].slug] });
      if (!isOnepage) projected[i].metadata.creative_quality_contract = catalog;
    }
    if (isOnepage) projected.forEach(n => { n.metadata.creative_quality_contract = clone(sharedCatalog); });
    for (let i = 0; i < projected.length; i++) {
      const result = await compileCreativeQuality(dnaFor(projected[i], brands[i], dnas[i]));
      if (result.status !== 'COMPILED' || !result.owner_supplemental_rules.some(actual => actual.id === `owner:${p.id}` && actual.canonical_text === canonical))
        fail('proposed_quality_blocked', `${brands[i].slug}: proposed quality contract does not compile the exact verbatim supplement (${result.errors.join(', ')}).`);
      compiled.push({ node_id: projected[i].id, brand_slug: brands[i].slug, source_hashes: result.source_hashes,
        contract_hash: result.contract_hash, added_supplement_ids: [`owner:${p.id}`] });
    }
    const plan: OwnerRulePlan = { schema_version: OWNER_RULE_PLAN_SCHEMA,
      candidate_hash: s.candidate_hash, rule_hash: s.direct_rule.rule_hash, targets: projected.map(mutation) };
    return { eligible: true, blockers: [], plan_kind: 'compiled_supplement', plan, plan_hash: await sha256(stableJson(plan)), additions, compiled, ...base };
  } catch (error) {
    return { eligible: false, blockers: [{ code: error instanceof PlanError ? error.code : 'compiler_error',
      message: error instanceof PlanError ? error.message : 'The deterministic compiler could not safely project this rule.',
      next_action: error instanceof PlanError && error.next_action
        ? error.next_action : 'Review the exact canonical rule and source snapshot; resolve this blocker before owner acceptance.' }],
      plan_kind: null, plan: null, plan_hash: null, additions: [], compiled: [], ...base };
  }
}
