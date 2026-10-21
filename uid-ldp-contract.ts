import { createHash } from 'node:crypto';
import { z } from 'zod';

export const LDP_VERSION = 'uid-ldp-job/1';
const id = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(4000);
export const httpsUrl = z.string().max(4000).refine(value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }, 'Verified HTTPS URL required');
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const dimensions = z.object({ width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000) }).strict();
export const MATERIAL_ROUTES = { hero: 'ldp-hero', ugc: 'ugc-image', shop_by_product: 'shop-by-product-image', niche_combo: 'niche-product-combo', featured: 'ldp-hero', catalog: 'source-media' } as const;
export const LDP_CONTRACT = {
  schema_version: LDP_VERSION,
  implementation: 'HOST_EXECUTED_WITH_PURE_GATEWAY_PLANNING_AND_VALIDATION',
  scope: 'pawfecthouse/ldp-system',
  intake: 'Existing resolve_creative_dna research object; optional research.ldp_job. No new tool or Onepage overload.',
  required_inputs: ['collection_url'],
  host_intake: { user_supplies: 'One collection URL is sufficient. Optional user constraints only.', discovery: 'Infer brand and niche from the actual collection; resolve current canonical LDP rules first, discover authoritative live brand UI/LDP references, then research the real pool. Do not ask the user to supply a separate reference URL or write the plan.', execution: 'For an authenticated end-to-end user request, the host builds and validates the plan then continues within its existing tool permissions. Ask only for essential unresolved inputs, explicit user-requested checkpoints, material scope changes or permission-required actions.', material_rules: 'Resolve every selected material route freshly before production; do not replace current canonical instructions with this workflow guidance.' },
  design_role: 'Act as a UI/UX designer: explain the shopper journey, original idea, hierarchy, intentional layout variation and mobile decisions. Live web provides brand/UI grammar, not a rigid template to copy mechanically.',
  source_priority: ['current accepted scoped rules and user locks', 'live brand website UI/layout/style', 'approved same-brand layout references'],
  phases: ['research', 'page_plan', 'authorization_scope_check', 'asset_generation', 'asset_inspection', 'complete_design_draft_assembly', 'responsive_qc', 'human_review', 'handoff'],
  material_routes: MATERIAL_ROUTES,
  hero: { desktop: { width: 2560, height: 800 }, mobile: { width: 750, height: 954 }, rule_basis: 'Accepted PawfectHouse LDP Hero 2026-10-05; independently corroborated live source markup 2026-10-15', stale_schema: 'Legacy 21:9 must not override the accepted desktop/mobile rule. This task contract does not mutate canonical records.', adaptation: 'Same story/SKU, recompose instead of merely cropping', applies_to: 'hero only; featured slots have separate live-source dimensions' },
  integrity: ['Full media/detail evidence for selected SKU variants; enumeration is not pixel inspection.', 'No invented products, reviews, customer identities, prices, ranking, policies or destinations.', 'Generated UGC is commercial imagery, never authenticated customer proof.', 'Combo composition is not a purchasable bundle unless verified.', 'Live reference defects are negative evidence, never blindly copied.'],
  execution_limits: ['Gateway does not browse, generate, spend, upload or write Figma.', 'Planner ranks host-supplied verified assortment, not independently fetched catalog truth.', 'Approval and media/Figma inspection records remain host-reported, not authenticated by this read-only endpoint.', 'Design draft completion requires actual desktop/mobile full-page image inspection; generated markup or receipts alone are not proof of visual quality.', 'No automatic Train, canonical writes, publication or deployment.'],
  delivery: ['Complete desktop/mobile full-page design draft images for user Figma reconstruction; no hosted demo required', 'Original and production assets', 'Asset-section-element manifest', 'Copy/destination/source manifest', 'Token provenance and actual QC limits'],
};

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => (value as any)[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableJson((value as any)[k])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export const fingerprint = (value: unknown) => 'sha256:' + createHash('sha256').update(stableJson(value)).digest('hex');
export function researchEvidenceSnapshot(raw: unknown) { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fingerprint(null); const { ldp_job, ldp_asset_outputs, ldp_figma_receipt, ldp_preview_layout, ldp_delivery_mode, ldp_design_draft, ...research } = raw as Record<string, unknown>; return fingerprint(research); }
export const canonicalLdpSnapshot = (data: any) => fingerprint({ resolved: data.resolved, brand: data.brand, brand_dna: data.brand_dna, branch: data.branch, resolution_policy: data.resolution_policy });

const product = z.object({ id, display_name: text, product_type: text, niches: z.array(text).min(1).max(30), evidence_source_ids: z.array(id).min(1).max(30), suitability_note: text, excluded: z.boolean().default(false) }).strict();
const card = z.object({ id, role: z.enum(['niche','product_type','product']), title: text, product_ids: z.array(id).min(1).max(100), asset_ids: z.array(id).max(20), destination: httpsUrl, destination_evidence_id: id }).strict();
const section = z.object({ id, role: z.enum(['header','footer','hero','trust','early_merchandise','niche_navigation','product_navigation','featured','new_arrivals','gallery','closing']), title: text, lead: text.optional(), cta_label: text.optional(), cards: z.array(card).max(100).default([]), rationale: text, layout_intent: text, mobile_intent: text, product_ids: z.array(id).max(100), claim_ids: z.array(id).max(100), asset_ids: z.array(id).max(100), destination: httpsUrl.optional(), destination_evidence_id: id.optional(), commercial_label: z.enum(['neutral','bestseller','new_arrivals','customer_review']).default('neutral'), label_evidence_ids: z.array(id).max(30).default([]) }).strict();
const asset = z.object({ id, role: z.enum(['hero','ugc','shop_by_product','niche_combo','featured','catalog']), route: z.enum(['ldp-hero','ugc-image','shop-by-product-image','niche-product-combo','source-media']), rule_snapshot: digest, product_ids: z.array(id).min(1).max(10), evidence_items: z.array(z.object({ source_id: id, item_id: id }).strict()).min(1).max(100), section_ids: z.array(id).min(1).max(30), concept: text, composition: text, copy_safe_area: text, variant: z.enum(['desktop','mobile','shared']), pair_id: id.optional(), dimensions, source_url: httpsUrl.optional(), dependencies: z.array(id).max(100).default([]), provenance: z.enum(['generated_commercial','verified_source_media','verified_customer_media']), ui_text_baked_in: z.literal(false) }).strict();
const baseline = z.object({ authority: z.literal('live_web'), url: httpsUrl.refine(value => { try { return ['pawfecthouse.com','www.pawfecthouse.com'].includes(new URL(value).hostname); } catch { return false; } }), observed_at: z.string().datetime({ offset: true }), desktop: dimensions, mobile: dimensions, mobile_render_inspected: z.boolean(), tokens: z.object({ font_family: text, text_color: z.string().regex(/^#[a-fA-F0-9]{6}$/), surface_color: z.string().regex(/^#[a-fA-F0-9]{6}$/), accent_color: z.string().regex(/^#[a-fA-F0-9]{6}$/), spacing: z.number().nonnegative().max(200), radius: z.number().nonnegative().max(200) }).strict(), token_evidence: text, responsive_behavior: text, known_defects: z.array(text).max(30) }).strict();
export const LDP_JOB_SCHEMA = z.object({
  schema_version: z.literal(LDP_VERSION), task_id: id, content_version: digest.optional(), canonical_snapshot: digest, research_snapshot: digest,
  brief: z.object({ brand: z.literal('pawfecthouse'), niche: text, locale: id, source_url: httpsUrl, user_locks: z.array(text).max(30) }).strict(),
  product_matrix: z.array(product).min(1).max(100), baseline,
  design_strategy: z.object({ original_idea: text, shopper_journey: text, visual_hierarchy: text, layout_variation: text, mobile_decisions: text, brand_consistency: text, design_rationale: text }).strict(),
  page_manifest: z.object({ scope: z.enum(['complete_ldp','section_prototype']), required_section_ids: z.array(id).min(1).max(40) }).strict(),
  sections: z.array(section).min(1).max(40), assets: z.array(asset).max(100),
  evidence: z.array(z.object({ id, kind: z.enum(['destination','sales_ranking','freshness','customer_review','policy']), url: httpsUrl, observed_at: z.string().datetime({ offset: true }), product_ids: z.array(id).max(100), observation: text }).strict()).max(100),
  review_policy: z.enum(['autonomous','user_checkpoint']).default('autonomous'),
  execution_authority: z.object({ task_id: id, source_message_id: id, origin: z.literal('authenticated_user_instruction'), scope: z.literal('end_to_end_ldp') }).strict().optional(),
  plan_approval: z.object({ task_id: id, content_version: digest, source_message_id: id }).strict().optional(),
}).strict();
export type LdpJob = z.infer<typeof LDP_JOB_SCHEMA>;
export function ldpContentVersion(job: Omit<LdpJob, 'content_version'> | LdpJob) { const { content_version, plan_approval, ...content } = job as LdpJob; return fingerprint(content); }
export const ldpInputShape = z.toJSONSchema(LDP_JOB_SCHEMA, { target: 'draft-2020-12', io: 'input' });
