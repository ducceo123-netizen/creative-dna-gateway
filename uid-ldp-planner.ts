import { evaluateResearch, type ResearchContext } from './supabase/functions/_shared/product-research.ts';
import { LDP_CONTRACT, LDP_JOB_SCHEMA, LDP_VERSION, canonicalLdpSnapshot, researchEvidenceSnapshot, ldpContentVersion, ldpInputShape, MATERIAL_ROUTES, type LdpJob } from './uid-ldp-contract.ts';

const unique = (values: string[]) => new Set(values).size === values.length;
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export function isPawfectHouseLdp(data: any) { return (data.resolved?.brand ?? data.brand?.slug) === 'pawfecthouse' && (data.resolved?.branch ?? data.branch?.slug) === 'ldp-system'; }

/** A deterministic recommendation from supplied facts, never a live catalog fetch. No fixed tile/feature quota. */
export function suggestLdpStructure(matrix: LdpJob['product_matrix']) {
  const eligible = matrix.filter(p => !p.excluded);
  const groups = (key: 'product_type' | 'niches') => {
    const grouped = new Map<string, Set<string>>();
    for (const p of eligible) for (const name of key === 'niches' ? p.niches : [p.product_type]) { const ids = grouped.get(name) ?? new Set<string>(); ids.add(p.id); grouped.set(name, ids); }
    return [...grouped].map(([name, ids]) => ({ name, product_ids: [...ids].sort(), distinct_product_count: ids.size })).sort((a,b) => b.distinct_product_count - a.distinct_product_count || a.name.localeCompare(b.name));
  };
  const types = groups('product_type'), niches = groups('niches');
  const distinctNiches = niches.filter((n,i) => !niches.slice(0,i).some(other => JSON.stringify(other.product_ids) === JSON.stringify(n.product_ids)));
  return { source: 'HOST_SUPPLIED_PRODUCT_MATRIX_NOT_INDEPENDENTLY_VERIFIED', candidate_product_navigation: types,
    candidate_niche_navigation: distinctNiches, candidate_featured_lines: types.filter(t => t.distinct_product_count > 1),
    withheld_duplicate_niches: niches.filter(n => !distinctNiches.includes(n)).map(n => n.name),
    instruction: 'Choose only useful sections supported by this assortment. Counts are candidates, not quotas. Preserve independent merchandising roles; absence of sales proof means neutral labels. Distinct product IDs can still be variants of one design: host must check actual design breadth.' };
}

export function validateLdpJob(raw: unknown, context: ResearchContext, snapshot: string) {
  const issues: string[] = [], limitations: string[] = [];
  const research = evaluateResearch({ ...context, require_pdp_coverage: true });
  let bytes = Infinity; try { bytes = JSON.stringify(raw)?.length ?? 0; } catch { /* invalid */ }
  const parsed = bytes <= 160000 ? LDP_JOB_SCHEMA.safeParse(raw) : undefined;
  if (!parsed?.success) return { schema_version: LDP_VERSION, status: 'NEEDS_LDP_PLAN', issues: parsed && !parsed.success ? parsed.error.issues.map(e => `${e.path.join('.')}:${e.message}`) : ['LDP_PLAN_TOO_LARGE'], research, execution: 'NOT_EXECUTED', approval: 'NOT_AUTHENTICATED' };
  const job = parsed.data;
  const expected_version = ldpContentVersion(job);
  if (job.content_version !== expected_version) issues.push('CONTENT_VERSION_MISMATCH');
  if (job.canonical_snapshot !== snapshot) issues.push('STALE_CANONICAL_SNAPSHOT');
  if (job.research_snapshot !== researchEvidenceSnapshot(context.research)) issues.push('STALE_RESEARCH_SNAPSHOT');
  if (context.source_url !== job.brief.source_url) issues.push('BRIEF_SOURCE_MISMATCH');
  if (!['READY','READY_WITH_LIMITATIONS'].includes(research.status)) issues.push('SELECTED_PRODUCT_RESEARCH_REQUIRED');
  const packet = isObject(context.research) ? context.research : {};
  const products = new Map<string, any>((Array.isArray(packet.scope?.products) ? packet.scope.products : []).map((p:any) => [p.id,p]));
  const sources = new Map<string, any>((Array.isArray(packet.sources) ? packet.sources : []).map((s:any) => [s.id,s]));
  const claims = new Map<string, any>((Array.isArray(packet.claims) ? packet.claims : []).map((c:any) => [c.id,c]));
  const matrix = new Map(job.product_matrix.map(p => [p.id,p]));
  const sections = new Map(job.sections.map(s => [s.id,s]));
  const assets = new Map(job.assets.map(a => [a.id,a]));
  const evidence = new Map(job.evidence.map(e => [e.id,e]));
  for (const [label, list] of [['PRODUCT',job.product_matrix],['SECTION',job.sections],['ASSET',job.assets],['EVIDENCE',job.evidence]] as const) if (!unique(list.map(v=>v.id))) issues.push(`DUPLICATE_${label}_ID`);
  for (const p of job.product_matrix) {
    if (!products.has(p.id)) issues.push(`UNRESEARCHED_PRODUCT:${p.id}`);
    if (p.evidence_source_ids.some(id => !sources.get(id)?.product_ids?.includes(p.id) || !['inspected','partial'].includes(sources.get(id)?.status))) issues.push(`PRODUCT_MATRIX_EVIDENCE_MISMATCH:${p.id}`);
  }
  const checkProducts = (ids: string[], target: string) => { if (!unique(ids) || ids.some(id => !matrix.has(id) || matrix.get(id)?.excluded || !products.has(id))) issues.push(`INVALID_PRODUCT_ALLOCATION:${target}`); };
  if (!unique(job.page_manifest.required_section_ids) || job.page_manifest.required_section_ids.length!==job.sections.length || job.sections.some(s=>!job.page_manifest.required_section_ids.includes(s.id))) issues.push('APPROVED_SECTION_MANIFEST_MISMATCH');
  const contentSections=job.sections.filter(s=>s.role!=='header');
  if (contentSections[0]?.role !== 'hero' || job.sections.filter(s=>s.role==='hero').length !== 1) issues.push('EXACTLY_ONE_LEADING_HERO_REQUIRED');
  if(job.page_manifest.scope==='complete_ldp') {
    if(job.sections[0].role!=='header'||job.sections.at(-1)?.role!=='footer')issues.push('COMPLETE_PAGE_REQUIRES_HEADER_AND_FOOTER');
    if(!job.sections.some(s=>s.cards.some(c=>c.role==='product')))issues.push('COMPLETE_PAGE_REQUIRES_CATALOG_CARDS');
    if(!job.sections.some(s=>s.cards.some(c=>c.role==='niche'||c.role==='product_type')))issues.push('COMPLETE_PAGE_REQUIRES_BROWSING_NAVIGATION');
    if(!job.sections.some(s=>s.role==='gallery'&&s.asset_ids.length))issues.push('COMPLETE_PAGE_REQUIRES_GALLERY');
  }

  const navigationSets = new Set<string>(), cardIds = new Set<string>();
  for (const s of job.sections) {
    checkProducts(s.product_ids,s.id);
    if (['hero','early_merchandise','niche_navigation','product_navigation','featured','new_arrivals'].includes(s.role) && !s.product_ids.length) issues.push(`EMPTY_MERCHANDISING_SECTION:${s.id}`);
    if (!unique(s.asset_ids) || s.asset_ids.some(id => !assets.has(id) || !assets.get(id)?.section_ids.includes(s.id))) issues.push(`SECTION_ASSET_BINDING_MISMATCH:${s.id}`);
    if (!unique(s.claim_ids) || s.claim_ids.some(id => !claims.has(id) || claims.get(id).product_ids.some((pid:string)=>!s.product_ids.includes(pid)))) issues.push(`SECTION_CLAIM_SCOPE_MISMATCH:${s.id}`);
    if (s.destination) { const e = evidence.get(s.destination_evidence_id ?? ''); if (!e || e.kind !== 'destination' || e.url !== s.destination || s.product_ids.some(id => !e.product_ids.includes(id))) issues.push(`DESTINATION_EVIDENCE_REQUIRED:${s.id}`); }
    else if (s.destination_evidence_id) issues.push(`ORPHAN_DESTINATION_EVIDENCE:${s.id}`);
    if (['niche_navigation','product_navigation','featured'].includes(s.role) && !s.destination && !s.cards.length) issues.push(`MERCHANDISING_DESTINATION_REQUIRED:${s.id}`);
    const required = s.commercial_label === 'bestseller' ? 'sales_ranking' : s.commercial_label === 'new_arrivals' ? 'freshness' : s.commercial_label === 'customer_review' ? 'customer_review' : null;
    if (s.role === 'new_arrivals' && s.commercial_label !== 'new_arrivals') issues.push(`FRESHNESS_LABEL_REQUIRED:${s.id}`);
    if (required && (!s.label_evidence_ids.length || s.label_evidence_ids.some(id => evidence.get(id)?.kind !== required) || s.product_ids.some(pid=>!s.label_evidence_ids.some(id=>evidence.get(id)?.product_ids.includes(pid))))) issues.push(`COMMERCIAL_LABEL_EVIDENCE_REQUIRED:${s.id}`);
    if (s.role === 'trust' && !s.label_evidence_ids.some(id=>evidence.get(id)?.kind==='policy')) issues.push(`TRUST_POLICY_EVIDENCE_REQUIRED:${s.id}`);
    if (s.label_evidence_ids.some(id=>!evidence.has(id))) issues.push(`UNKNOWN_LABEL_EVIDENCE:${s.id}`);
    if (s.role === 'niche_navigation' && !s.cards.length) { const key = [...s.product_ids].sort().join('|'); if(navigationSets.has(key)) issues.push(`DUPLICATE_NICHE_ALLOCATION:${s.id}`); navigationSets.add(key); }
    if (s.role === 'featured' && new Set(s.product_ids.map(id=>matrix.get(id)?.product_type)).size !== 1) issues.push(`FEATURED_MUST_HAVE_ONE_PRODUCT_TYPE:${s.id}`);
    if (s.destination && !s.cta_label) issues.push(`CTA_LABEL_REQUIRED:${s.id}`);
    for (const card of s.cards) {
      if (cardIds.has(card.id)) issues.push(`DUPLICATE_CARD_ID:${card.id}`); cardIds.add(card.id);
      checkProducts(card.product_ids, card.id);
      if (card.product_ids.some(id=>!s.product_ids.includes(id))) issues.push(`CARD_PRODUCT_SCOPE_MISMATCH:${card.id}`);
      if (!unique(card.asset_ids) || card.asset_ids.some(id=>!s.asset_ids.includes(id) || assets.get(id)?.product_ids.some(pid=>!card.product_ids.includes(pid)))) issues.push(`CARD_ASSET_SCOPE_MISMATCH:${card.id}`);
      const destination=evidence.get(card.destination_evidence_id);
      if (!destination || destination.kind!=='destination' || destination.url!==card.destination || card.product_ids.some(id=>!destination.product_ids.includes(id))) issues.push(`CARD_DESTINATION_EVIDENCE_REQUIRED:${card.id}`);
      if (card.role==='product' && (card.product_ids.length!==1 || products.get(card.product_ids[0])?.url!==card.destination || matrix.get(card.product_ids[0])?.display_name!==card.title)) issues.push(`CATALOG_CARD_IDENTITY_MISMATCH:${card.id}`);
      if (card.role==='product_type' && new Set(card.product_ids.map(id=>matrix.get(id)?.product_type)).size!==1) issues.push(`CATEGORY_CARD_TYPE_MISMATCH:${card.id}`);
      if (card.role==='niche') { const key=[...card.product_ids].sort().join('|'); if(navigationSets.has(key)) issues.push(`DUPLICATE_NICHE_ALLOCATION:${card.id}`); navigationSets.add(key); }
    }

  }
  const pairs = new Map<string, typeof job.assets>();
  for (const a of job.assets) {
    checkProducts(a.product_ids,a.id);
    if (a.route !== MATERIAL_ROUTES[a.role]) issues.push(`MATERIAL_ROUTE_MISMATCH:${a.id}`);
    if (!unique(a.section_ids) || a.section_ids.some(id=>!sections.get(id)?.asset_ids.includes(a.id) || a.product_ids.some(pid=>!sections.get(id)?.product_ids.includes(pid)))) issues.push(`ASSET_SECTION_BINDING_MISMATCH:${a.id}`);
    if (!unique(a.dependencies) || a.dependencies.some(id=>id===a.id || !assets.has(id))) issues.push(`INVALID_ASSET_DEPENDENCY:${a.id}`);
    for (const p of a.product_ids) if (!a.evidence_items.some(item => { const src=sources.get(item.source_id); const media=[...(src?.pdp_coverage?.gallery?.items ?? [])].find((m:any)=>m.id===item.item_id); return src?.kind==='target_pdp' && src?.product_ids?.includes(p) && media?.status==='inspected' && (media.variant === products.get(p)?.variant || media.variant===undefined && src.product_ids.length===1); })) issues.push(`ASSET_PRODUCT_PIXEL_EVIDENCE_REQUIRED:${a.id}:${p}`);
    if (a.evidence_items.some(item => { const src=sources.get(item.source_id); return !src || ![...(src?.pdp_coverage?.gallery?.items??[]),...(src?.pdp_coverage?.details?.items??[])].some((m:any)=>m.id===item.item_id&&m.status==='inspected'); })) issues.push(`UNKNOWN_ASSET_EVIDENCE:${a.id}`);
    if (a.role==='shop_by_product' && (a.dimensions.width!==a.dimensions.height || new Set(a.product_ids.map(id=>matrix.get(id)?.product_type)).size!==1)) issues.push(`SHOP_BY_PRODUCT_FORMAT_OR_TYPE:${a.id}`);
    if (a.role==='niche_combo' && (a.product_ids.length<2 || a.product_ids.length>3)) issues.push(`COMBO_REQUIRES_TWO_OR_THREE_PRODUCTS:${a.id}`);
    if (a.role==='catalog' && (!a.source_url || a.provenance!=='verified_source_media' || !a.evidence_items.some(ref=>sources.get(ref.source_id)?.pdp_coverage?.gallery?.items?.some((item:any)=>item.id===ref.item_id&&item.url===a.source_url&&item.status==='inspected')))) issues.push(`CATALOG_SOURCE_REQUIRED:${a.id}`);
    if (a.role==='hero') { const expected=a.variant==='desktop'?LDP_CONTRACT.hero.desktop:a.variant==='mobile'?LDP_CONTRACT.hero.mobile:null; if(!expected||a.dimensions.width!==expected.width||a.dimensions.height!==expected.height) issues.push(`HERO_DIMENSION_MISMATCH:${a.id}`); if(!a.pair_id) issues.push(`HERO_PAIR_REQUIRED:${a.id}`); else pairs.set(a.pair_id,[...(pairs.get(a.pair_id)??[]),a]); }
    if (a.provenance==='generated_commercial' && a.section_ids.some(id=>sections.get(id)?.commercial_label==='customer_review')) issues.push(`GENERATED_IMAGE_IS_NOT_CUSTOMER_PROOF:${a.id}`);
  }
  if (!pairs.size) issues.push('DESKTOP_MOBILE_HERO_REQUIRED');
  for(const [id,list] of pairs) if(list.length!==2 || !list.some(a=>a.variant==='desktop') || !list.some(a=>a.variant==='mobile') || list[0].concept!==list[1].concept || JSON.stringify([...list[0].product_ids].sort())!==JSON.stringify([...list[1].product_ids].sort())) issues.push(`HERO_PAIR_STORY_OR_PRODUCT_MISMATCH:${id}`);
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string)=>{if(visiting.has(id)){issues.push('ASSET_DEPENDENCY_CYCLE');return;}if(visited.has(id))return;visiting.add(id);for(const dep of assets.get(id)?.dependencies??[])visit(dep);visiting.delete(id);visited.add(id);};for(const a of job.assets)visit(a.id);
  if (!job.baseline.mobile_render_inspected) limitations.push('LIVE_MOBILE_RENDER_QA_PENDING');
  limitations.push(...research.limitations,'SEMANTIC_PRODUCT_COPY_AND_REFERENCE_DEFECT_REVIEW_REQUIRED','MATERIAL_RULE_HASH_FRESHNESS_REQUIRES_HOST_RESOLVER_RECHECK');
  const approval = job.plan_approval;
  const approval_matches = !!approval && approval.task_id===job.task_id && approval.content_version===expected_version;
  if (approval && !approval_matches) issues.push('STALE_OR_WRONG_TASK_APPROVAL');
  return { schema_version: LDP_VERSION, task_id:job.task_id, expected_version, status: issues.length?'NEEDS_LDP_PLAN':'REQUIRES_HOST_EVIDENCE_AND_PLAN_REVIEW', issues:[...new Set(issues)], limitations:[...new Set(limitations)], research, approval_matches,
    delivery_scope:job.page_manifest.scope,complete_page_eligible:job.page_manifest.scope==='complete_ldp'&&!issues.length, approval:'HOST_REPORTED_NOT_AUTHENTICATED', execution:'NOT_EXECUTED', next: issues.length?'Repair only affected inputs and resubmit.':approval_matches?'Host must verify authentic approval and all product pixels before authorized production.':'Present this exact plan revision for user approval after semantic source review.', recommendations:suggestLdpStructure(job.product_matrix) };
}

export function attachLdpWorkflow<T extends Record<string,any>>(data:T, context:ResearchContext={}):T & Record<string,any> {
  if (!isPawfectHouseLdp(data)) return data;
  const snapshot=canonicalLdpSnapshot(data);
  const raw=isObject(context.research)?context.research.ldp_job:undefined;
  const validation=raw===undefined?{schema_version:LDP_VERSION,status:'AWAITING_LDP_PLAN',execution:'NOT_EXECUTED'}:validateLdpJob(raw,context,snapshot);
  const policyBlocked=data.creative_quality_contract?.status==='BLOCKED'||data.quality_execution_guard?.status==='BLOCKED'||data.readiness?.content_authoring==='BLOCKED';
  return {...data,ldp_workflow_contract:{...LDP_CONTRACT,canonical_snapshot:snapshot,research_snapshot:researchEvidenceSnapshot(context.research),input_shape:ldpInputShape},ldp_validation:validation,
    readiness:{...data.readiness,ldp_plan:policyBlocked?'BLOCKED':validation.status,ldp_asset_execution:'HOST_EXECUTION_REQUIRED',ldp_figma_delivery:'REQUIRES_NATIVE_ASSEMBLY_AND_ACTUAL_QC'}};
}
