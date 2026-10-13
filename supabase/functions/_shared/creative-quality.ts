/** Deterministic, account-independent quality policy. No model, credentials, network or writes. */
export const QUALITY_SCHEMA = 'uid-creative-quality/1';
// Stored /2 bundles require supplemental capability. Old /1 compilers fail closed.
export const QUALITY_SUPPLEMENTED_SCHEMA = 'uid-creative-quality/2';
export const QUALITY_COMPILER = '2026-10-13-owner-supplement-v1';
export const OWNER_SUPPLEMENTAL_SCHEMA = 'uid.owner-supplemental-rule.v1';
export const OWNER_SUPPLEMENTAL_PRECEDENCE = 'SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH';
export const MAX_OWNER_SUPPLEMENTS = 16;
export const QUALITY_CATALOG_SCHEMA = 'uid-creative-quality-catalog/1';
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Scope = { brands: string[]; branches: string[]; product_urls?: string[] };
export type RuleSource = { node: 'branch' | 'brand_dna'; locator: string; excerpt?: string };
export type QualityRule = {
  id: string; key: string; value: Json; instruction: string;
  category: 'content' | 'typography' | 'banner' | 'proof' | 'brand_style' | 'delivery' | 'workflow';
  scope: Scope; sources: RuleSource[]; supersedes?: string[]; reference_ids?: string[]; required_reference_ids?: string[];
};
export type QualityReference = {
  id: string; role: string; scope: Scope; required_for: string[];
  usage?: 'supplementary_inspiration' | 'required_evidence'; suggested_for?: string[];
  asset_url?: string; reference_id?: string; source: RuleSource;
};
export type OwnerSupplementalRule = {
  schema_version: typeof OWNER_SUPPLEMENTAL_SCHEMA; id: string; proposal_id: string;
  decision_kind: 'owner_direct_rule'; canonical_text: string; declared_scope: string; scope: Scope;
  rule_class: 'STRUCTURAL' | 'BRAND_STYLE' | 'WORKFLOW'; confidence: 'HIGH' | 'MEDIUM';
  source: { node: 'branch'; locator: string; canonical_text_hash: string };
  accepted_source_hashes: { branch: string; brand_dna: string };
  precedence: typeof OWNER_SUPPLEMENTAL_PRECEDENCE;
  semantic_consistency: 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS'; visual_qc_performed: false;
};
export type QualityBundle = {
  schema_version: typeof QUALITY_SCHEMA | typeof QUALITY_SUPPLEMENTED_SCHEMA; revision: string;
  source_hashes: { branch: string; brand_dna: string };
  rules: QualityRule[]; references: QualityReference[]; owner_supplemental_rules?: OwnerSupplementalRule[];
};
export type ResolvedDna = {
  brand?: { slug?: string; version?: string }; branch?: DnaNode; brand_dna?: DnaNode;
  visual_references?: unknown[];
};
type DnaNode = { slug?: string; version?: string; content_md?: string; metadata?: Record<string, unknown> };
export type QualityContext = { source_url?: string };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 1600): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const strings = (v: unknown, max = 80): v is string[] => Array.isArray(v) && v.length <= max && v.every(x => text(x, 500));
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  if (object(v)) return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
}
export async function sha256(v: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function sourceHashes(dna: ResolvedDna) {
  const hash = async (node?: DnaNode) => {
    const { creative_quality_contract: _contract, ...metadata } = node?.metadata || {};
    return sha256(stableJson({ slug: node?.slug ?? null, version: node?.version ?? null, content_md: node?.content_md ?? '', metadata }));
  };
  return { branch: await hash(dna.branch), brand_dna: await hash(dna.brand_dna) };
}
function normalizeUrl(value?: string): string | null {
  try { const u = new URL(value || ''); if (u.protocol !== 'https:' || u.username || u.password) return null; return u.origin + u.pathname.replace(/\/+$/, ''); } catch { return null; }
}
function scopeValid(s: unknown): s is Scope {
  return object(s) && strings(s.brands) && !!s.brands.length && strings(s.branches) && !!s.branches.length &&
    (s.product_urls === undefined || (strings(s.product_urls) && !!s.product_urls.length && s.product_urls.every((u: string) => normalizeUrl(u))));
}
function applies(s: Scope, brand: string, branch: string, context: QualityContext) {
  return (s.brands.includes('*') || s.brands.includes(brand)) && (s.branches.includes('*') || s.branches.includes(branch)) &&
    (!s.product_urls || s.product_urls.some(u => normalizeUrl(u) === normalizeUrl(context.source_url)));
}
function narrower(a: Scope, b: Scope) {
  const subset = (x: string[], y: string[]) => y.includes('*') || x.every(v => y.includes(v));
  return subset(a.brands,b.brands) && subset(a.branches,b.branches) &&
    (!b.product_urls || (!!a.product_urls && a.product_urls.every(u => b.product_urls!.some(v => normalizeUrl(u) === normalizeUrl(v)))));
}
function sourceValid(s: unknown, dna: ResolvedDna): s is RuleSource {
  if (!object(s) || !['branch','brand_dna'].includes(s.node) || !text(s.locator,500)) return false;
  // Excerpts are optional for retained canonical baseline, mandatory source hash guards still apply.
  return s.excerpt === undefined || (text(s.excerpt,2000) && !!dna[s.node as 'branch'|'brand_dna']?.content_md?.includes(s.excerpt));
}
function ruleValid(r: unknown, dna: ResolvedDna): r is QualityRule {
  return object(r) && text(r.id,120) && text(r.key,120) && text(r.instruction) && r.value !== undefined &&
    stableJson(r.value).length <= 2000 && ['content','typography','banner','proof','brand_style','delivery','workflow'].includes(r.category) &&
    scopeValid(r.scope) && Array.isArray(r.sources) && r.sources.length > 0 && r.sources.length <= 8 && r.sources.every(s => sourceValid(s,dna)) &&
    (r.supersedes === undefined || strings(r.supersedes)) && (r.reference_ids === undefined || strings(r.reference_ids)) &&
    (r.required_reference_ids === undefined || strings(r.required_reference_ids));
}
function referenceValid(r: unknown, dna: ResolvedDna): r is QualityReference {
  return object(r) && text(r.id,120) && text(r.role,120) && scopeValid(r.scope) && strings(r.required_for) &&
    (r.usage === undefined || ['supplementary_inspiration','required_evidence'].includes(r.usage)) &&
    (r.usage !== 'required_evidence' || r.required_for.length > 0) &&
    (r.suggested_for === undefined || strings(r.suggested_for)) &&
    sourceValid(r.source,dna) && (r.asset_url === undefined || text(r.asset_url,2000)) && (r.reference_id === undefined || text(r.reference_id,500));
}
function exactKeys(value: unknown, keys: string[]): boolean {
  return object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
export function ownerSupplementalShapeValid(r: unknown, brand: string, branch: string): r is OwnerSupplementalRule {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const hash = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
  if (!object(r) || !exactKeys(r, ['schema_version','id','proposal_id','decision_kind','canonical_text','declared_scope','scope','rule_class','confidence','source','accepted_source_hashes','precedence','semantic_consistency','visual_qc_performed'])
    || r.schema_version !== OWNER_SUPPLEMENTAL_SCHEMA || !uuid.test(r.proposal_id)
    || r.id !== 'owner:' + r.proposal_id || r.decision_kind !== 'owner_direct_rule'
    || !text(r.canonical_text,16000) || r.canonical_text !== r.canonical_text.trim() || /[\u0000-\u0008\u000b-\u001f]/.test(r.canonical_text) || !text(r.declared_scope,500)
    || !scopeValid(r.scope) || !exactKeys(r.scope,['brands','branches'])
    || r.scope.brands.includes('*') || r.scope.branches.includes('*')
    || !r.scope.brands.includes(brand) || !r.scope.branches.includes(branch)
    || !['STRUCTURAL','BRAND_STYLE','WORKFLOW'].includes(r.rule_class) || !['HIGH','MEDIUM'].includes(r.confidence)
    || !exactKeys(r.source,['node','locator','canonical_text_hash']) || r.source.node !== 'branch'
    || r.source.locator !== 'owner-rule:' + r.proposal_id || !hash(r.source.canonical_text_hash)
    || !exactKeys(r.accepted_source_hashes,['branch','brand_dna']) || !hash(r.accepted_source_hashes.branch) || !hash(r.accepted_source_hashes.brand_dna)
    || r.precedence !== OWNER_SUPPLEMENTAL_PRECEDENCE || r.semantic_consistency !== 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS' || r.visual_qc_performed !== false) return false;
  const headings = ['Generalized Rule','Expected Behavior','Reject Conditions','Scope','Rule Class','Confidence'];
  const sections = [...r.canonical_text.matchAll(/^## ([^\n]+)\n/gm)];
  if (sections.length !== 6 || sections[0].index !== 0 || sections.some((m,i) => m[1] !== headings[i])) return false;
  const contents = sections.map((m,i) => r.canonical_text.slice(m.index! + m[0].length,sections[i+1]?.index ?? r.canonical_text.length).trim());
  return contents.every(v => v && !/^#{1,6}\s/m.test(v) && !/```|~~~/m.test(v))
    && contents.slice(0,3).every(v => v.length <= 4000)
    && contents[2].split('\n').length <= 12 && contents[2].split('\n').every((v: string) => /^- \S/.test(v) && v.length <= 802)
    && contents[3] === r.declared_scope && contents[4] === r.rule_class && contents[5] === r.confidence;
}
function usableAssetUrl(value?: string) {
  // This reports a retrievable candidate only, never claims that bytes were fetched or visually inspected.
  try { const u = new URL(value || ''); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash &&
    !/(^|\.)(chatgpt\.com|openai\.com|localhost)$/.test(u.hostname) && !/^(\[|\d{1,3}(\.\d{1,3}){3}$)/.test(u.hostname) ? u.href : null; } catch { return null; }
}
export async function compileCreativeQuality(dna: ResolvedDna, context: QualityContext = {}) {
  const brand = String(dna.brand?.slug || ''), branch = String(dna.branch?.slug || '');
  const hashes = await sourceHashes(dna);
  const stored = dna.branch?.metadata?.creative_quality_contract;
  const errors: string[] = [];
  // Onepage's existing master trigger mirrors all metadata. Keep an explicit brand-keyed
  // catalog on that master instead of fighting the trigger with overwritten local writes.
  const isCatalog = object(stored) && stored.schema_version === QUALITY_CATALOG_SCHEMA;
  const catalogValid = isCatalog && object(stored.contracts) && Object.keys(stored.contracts).length <= 16;
  const raw = isCatalog ? catalogValid && Object.hasOwn(stored.contracts,brand) ? stored.contracts[brand] : undefined : stored;
  if (isCatalog && (!catalogValid || !Object.hasOwn(stored.contracts,brand))) errors.push('BRAND_CONTRACT_MISSING');
  let bundle: QualityBundle | null = null;
  if (!object(raw)) errors.push('QUALITY_CONTRACT_MISSING');
  else if (![QUALITY_SCHEMA, QUALITY_SUPPLEMENTED_SCHEMA].includes(raw.schema_version) || !text(raw.revision,120) || !object(raw.source_hashes) ||
    !Array.isArray(raw.rules) || !raw.rules.length || raw.rules.length > 80 || !Array.isArray(raw.references) || raw.references.length > 48 ||
    stableJson(raw).length > 100000 || !raw.rules.every(r => ruleValid(r,dna)) || !raw.references.every(r => referenceValid(r,dna))) errors.push('QUALITY_CONTRACT_INVALID');
  else bundle = raw as QualityBundle;
  if (bundle && (bundle.source_hashes.branch !== hashes.branch || bundle.source_hashes.brand_dna !== hashes.brand_dna)) errors.push('QUALITY_CONTRACT_STALE');
  const rawSupplemental = bundle?.owner_supplemental_rules;
  if (bundle && ((bundle.schema_version === QUALITY_SCHEMA && rawSupplemental !== undefined)
    || (bundle.schema_version === QUALITY_SUPPLEMENTED_SCHEMA && (!Array.isArray(rawSupplemental) || !rawSupplemental.length))))
    errors.push('OWNER_SUPPLEMENTAL_SCHEMA_INVALID');
  const supplements = Array.isArray(rawSupplemental) ? rawSupplemental : [];
  if (rawSupplemental !== undefined && (!Array.isArray(rawSupplemental) || rawSupplemental.length > MAX_OWNER_SUPPLEMENTS
    || !supplements.every(r => ownerSupplementalShapeValid(r,brand,branch)))) errors.push('OWNER_SUPPLEMENTAL_INVALID');
  if (new Set(supplements.map(r => r?.id)).size !== supplements.length) errors.push('DUPLICATE_OWNER_SUPPLEMENTAL_IDS');
  for (const supplement of supplements) if (ownerSupplementalShapeValid(supplement,brand,branch)) {
    if (supplement.source.canonical_text_hash !== await sha256(supplement.canonical_text)) errors.push('OWNER_SUPPLEMENTAL_HASH_MISMATCH');
    if (!dna.branch?.content_md?.includes(supplement.canonical_text)) errors.push('OWNER_SUPPLEMENTAL_SOURCE_DRIFT');
  }
  const allRules = bundle?.rules || [];
  if (new Set(allRules.map(r => r.id)).size !== allRules.length) errors.push('DUPLICATE_RULE_IDS');
  const candidates = allRules.filter(r => applies(r.scope,brand,branch,context));
  const superseded = new Set<string>();
  for (const r of candidates) for (const target of r.supersedes || []) {
    const prior = allRules.find(p => p.id === target);
    if (!prior || prior.id === r.id || prior.key !== r.key || !narrower(r.scope,prior.scope)) errors.push(`INVALID_SUPERSESSION:${r.id}:${target}`);
    else if (candidates.some(p => p.id === target)) superseded.add(target);
  }
  // Linear-time cycle detection, bounded by the validated bundle size.
  const visiting = new Set<string>(), visited = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((allRules.find(r => r.id === id)?.supersedes || []).some(cyclic)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (allRules.some(r => cyclic(r.id))) errors.push('SUPERSESSION_CYCLE');
  const rules = candidates.filter(r => !superseded.has(r.id)).sort((a,b) => a.id.localeCompare(b.id));
  const byKey = new Map<string,QualityRule>();
  for (const r of rules) { const prior = byKey.get(r.key); if (prior && stableJson({value:prior.value,instruction:prior.instruction}) !== stableJson({value:r.value,instruction:r.instruction})) errors.push(`UNRESOLVED_RULE_CONFLICT:${r.key}`); byKey.set(r.key,r); }
  if (bundle && !rules.length) errors.push('NO_APPLICABLE_RULES');
  if (bundle && !rules.some(r => r.category === 'brand_style' && r.key === 'brand.active_expression' && r.scope.brands.includes(brand) && !r.scope.brands.includes('*') && r.sources.some(source => source.node === 'brand_dna'))) errors.push('BRAND_STYLE_NOT_COMPILED');
  if (bundle && branch === 'onepage-system') for (const category of ['content','typography','banner','proof','delivery','workflow'])
    if (!rules.some(r => r.category === category)) errors.push(`QUALITY_CATEGORY_MISSING:${category}`);
  const refCandidates = (bundle?.references || []).filter(r => applies(r.scope,brand,branch,context));
  if (new Set((bundle?.references || []).map(r => r.id)).size !== (bundle?.references.length || 0)) errors.push('DUPLICATE_REFERENCE_IDS');
  const allCanonicalReferences = list(dna.visual_references).filter(object);
  const canonicalReferences = allCanonicalReferences.filter(r => ['approved','reference'].includes(r.status));
  const references = refCandidates.map(r => {
    const canonical = allCanonicalReferences.find(e => e.id === r.id || (!!r.reference_id && (e.id === r.reference_id || e.metadata?.reference_id === r.reference_id)));
    const revoked = canonical && !['approved','reference'].includes(canonical.status);
    const asset_url = revoked ? null : usableAssetUrl(canonical?.asset_url) || usableAssetUrl(r.asset_url);
    // Legacy case examples used required_for as a fixed-seed gate. They are now
    // supplementary by default; only explicitly reviewed evidence can be mandatory.
    const usage = r.usage ?? 'supplementary_inspiration';
    return { ...r, usage, required_for: usage === 'required_evidence' ? r.required_for : [],
      suggested_for: [...new Set([...(r.suggested_for || []), ...(usage === 'supplementary_inspiration' ? r.required_for : [])])].sort(),
      asset_url, availability: asset_url ? usage === 'required_evidence' ? 'FETCH_REQUIRED' : 'FETCH_IF_SELECTED' : 'UNAVAILABLE', pixel_inspection: 'NOT_INSPECTED' as const };
  });
  // reference_ids are optional inspiration links, including historical fixed seeds.
  // An evidence dependency must be explicit and cannot be fulfilled by inspiration.
  for (const r of rules) for (const id of r.required_reference_ids || [])
    if (!references.some(ref => ref.id === id && ref.usage === 'required_evidence')) errors.push(`REQUIRED_REFERENCE_UNRESOLVED:${id}`);
  const requiredReferences = references.filter(r => r.usage === 'required_evidence');
  const unresolved = requiredReferences.filter(r => r.availability === 'UNAVAILABLE').map(r => r.id);
  const contentReady = errors.length === 0;
  const contract = {
    schema_version: QUALITY_SCHEMA, compiler_version: QUALITY_COMPILER, revision: bundle?.revision ?? null,
    route: { brand, branch }, source_hashes: hashes,
    status: contentReady ? 'COMPILED' : 'BLOCKED', errors: [...new Set(errors)].sort(),
    rules: contentReady ? rules : [],
    owner_supplemental_rules: contentReady ? [...supplements].sort((a,b) => a.id.localeCompare(b.id)) : [],
    owner_supplemental_policy: { layer: 'OWNER_APPROVED_VERBATIM_SUPPLEMENT', precedence: OWNER_SUPPLEMENTAL_PRECEDENCE,
      semantic_consistency: 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS', visual_qc_performed: false,
      instruction: 'Read the applicable owner-approved supplemental canonical text verbatim alongside the active catalog. This layer adds guidance only; it never replaces or supersedes existing catalog rules, hard gates, verified product truth, safety or scoped brand expression. If supplemental prose conflicts with any of those, keep the hard canonical requirement and stop the conflicting part for clarification. Owner acceptance is not image QC or proof of semantic consistency.' },
    superseded_rule_ids: [...superseded].sort(), references,
    canonical_visual_reference_catalog: canonicalReferences.map((r: any) => ({ id: r.id, material_type: r.material_type, status: r.status, usage: 'supplementary_inspiration', asset_url: usableAssetUrl(r.asset_url), pixel_inspection: 'NOT_INSPECTED' })),
    reference_library_policy: { usage: 'OPTIONAL_SUPPLEMENTARY_INSPIRATION', fixed_seed_set_required: false, empty_library_blocks_generation: false,
      overrides_active_brand_or_product_rules: false, inspect_selected_images_before_use: true },
    reference_gate: { status: unresolved.length ? 'BLOCKED_MISSING_REFERENCES' : requiredReferences.length ? 'PIXEL_INSPECTION_REQUIRED' : 'NO_REQUIRED_STYLE_REFERENCES', missing_reference_ids: unresolved, blocked_asset_slots: [...new Set(references.filter(r => unresolved.includes(r.id)).flatMap(r => r.required_for))].sort() },
    gates: { content_authoring: contentReady ? 'READY_WITH_SOURCE_RESEARCH' : 'BLOCKED', asset_generation: !contentReady || unresolved.length ? 'BLOCKED' : requiredReferences.length ? 'REQUIRES_PRODUCT_AND_REFERENCE_PIXEL_INSPECTION' : 'REQUIRES_PRODUCT_PIXEL_INSPECTION',
      human_artistic_review: 'REQUIRED', identical_pixels_guaranteed: false },
    provenance: { source: 'approved_canonical_metadata', account_independent: true, canonical_branch_version: dna.branch?.version ?? null, canonical_brand_version: dna.brand_dna?.version ?? null,
      legacy_library_pointer_count: new Set((String(dna.branch?.content_md || '') + String(dna.brand_dna?.content_md || '')).match(/libfile_[a-zA-Z0-9]+/g) || []).size,
      visual_reference_set_hash: await sha256(stableJson(dna.visual_references || [])) },
    instruction: 'Apply active scoped rules and the explicitly emitted owner-approved verbatim supplemental layer. Supplements are subordinate to the active canonical catalog, hard gates, safety and verified product truth; stop conflicting supplemental directions for clarification. Never infer image QC from owner acceptance. Superseded historical prose and metadata do not override this contract. Verify current PDP facts before content. Reference Library images and legacy reference_ids are optional supplementary inspiration, never fixed seeds, universal style or product evidence. An empty library or unavailable inspiration does not block creation. Follow active brand/product rules and inspect current product evidence before assets. Inspect any inspiration actually selected before using it; otherwise omit it. Only explicitly scoped required_evidence references and required_reference_ids may add an evidence gate; fetch and inspect their pixels. URLs/IDs alone are not visual verification. Stop the affected stage and name missing evidence, stale contract or rule conflict. No silent fallback to account memory. Human review is required for artistic quality; a matching policy hash is not an identical-output guarantee.',
  };
  return { ...contract, contract_hash: await sha256(stableJson(contract)) };
}
