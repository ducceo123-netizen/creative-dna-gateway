import {getOnepageReviewContract} from './uid-onepage-html-preview.ts';
import {RULE_COMPILER,RULE_REVIEW_SCOPE} from './supabase/functions/_shared/agent-rule-policy.ts';
import {ruleSupplementValid} from './supabase/functions/_shared/agent-rule-quality.ts';
import { createHash } from 'node:crypto';
import { QUALITY_COMPILER, OWNER_SUPPLEMENTAL_PRECEDENCE, MAX_OWNER_SUPPLEMENTS, ownerSupplementalShapeValid, agentReviewedSupplementalShapeValid, AGENT_REVIEW_SCOPE, stableJson } from './supabase/functions/_shared/creative-quality.ts';
import { ONEPAGE_FAQ_TEMPLATE_VERSION, replacePostStorySection } from './onepage-faq-template.ts';
import faqSection from './templates/onepage-faq-section-v1.json' with { type: 'json' };
import originalTemplate from './templates/onepage-ui-v1.json' with { type: 'json' };
import { ONEPAGE_UI_CONTENT_CONTRACT, validateOnepageUiCopy } from './supabase/functions/_shared/onepage-ui-content.ts';

const canvasCss = `
/* Owner-approved UI mapping canvas gutters — 2026-10-03.v2 */
.onepage-mapping-canvas { width: 100%; box-sizing: border-box; padding-inline: 32px; }
.onepage-mapping-canvas > .product-app--container > .container { width: 100%; max-width: 1280px; }
.onepage-mapping-canvas > .product-app--container > .container > .one-whole.column { width: 100%; margin-left: 0; margin-right: 0; }
@media only screen and (max-width: 798px) {
  .onepage-mapping-canvas { padding-inline: 16px; }
}
`;
const paddedHtml = originalTemplate.html.replace('<body>', '<body><div class="onepage-mapping-canvas">').replace('</body>', '</div></body>');
const paddedCss = originalTemplate.css + canvasCss;
const paddedTemplate = {
  ...originalTemplate, version: '2026-10-03.v2', html: paddedHtml, css: paddedCss,
  html_sha256: createHash('sha256').update(paddedHtml).digest('hex'),
  css_sha256: createHash('sha256').update(paddedCss).digest('hex'),
};
// Metadata-only revision: exact same approved HTML/CSS bytes, current delivery instructions.
const qualityAlignedTemplate = { ...paddedTemplate, version: '2026-10-11.v3' };
const faqHtml = replacePostStorySection(paddedHtml, faqSection.html);
const faqTemplate = {
  ...qualityAlignedTemplate, version: ONEPAGE_FAQ_TEMPLATE_VERSION,
  reference_url: faqSection.reference_url, captured_at: faqSection.captured_at,
  html: faqHtml, html_sha256: createHash('sha256').update(faqHtml).digest('hex'),
  asset_slots: originalTemplate.asset_slots.filter(slot => !slot.startsWith('gtk_')),
  text_slots: [...originalTemplate.text_slots.filter(slot => !/^(title|description)_(11|12|13)$/.test(slot)), ...faqSection.text_slots],
  verification: { source_capture: faqSection.verification.source_capture, pixel_parity: faqSection.verification.pixel_parity },
};
const templates: Record<string, typeof originalTemplate> = {
  [originalTemplate.version]: originalTemplate,
  [paddedTemplate.version]: paddedTemplate,
  [qualityAlignedTemplate.version]: qualityAlignedTemplate,
  [faqTemplate.version]: faqTemplate,
};
export const ONEPAGE_TEMPLATE_VERSION = qualityAlignedTemplate.version;
export const TEMPLATE_PRODUCTION_ORIGIN = 'https://uid-brands-gateway-preview.onrender.com';
const LEGACY_TEMPLATE_ORIGIN = 'https://creative-dna-gateway.vercel.app';
export const ONEPAGE_BINDINGS_SCHEMA = { type: 'object', additionalProperties: false, required: ['text', 'assets'], properties: { text: { type: 'object', additionalProperties: { type: 'string' } }, assets: { type: 'object', additionalProperties: { type: 'string' } }, faq_count: { type: 'integer', minimum: 1, maximum: 100 } } };
export const ONEPAGE_TEMPLATE_DESC = 'Read the versioned, shared Onepage UI mapping template. Returns stable download URLs, SHA-256 hashes, required asset/text slots and exact-layout instructions. Download template.html and styles.css into the same folder, bind approved assets/copy using a DOM parser, then render. No ChatGPT Library access is needed. Use format=source only when inline HTML/CSS is necessary; source is large. Never redraw the mapping or reload the live PDP to reconstruct the layout. For final mapping call this same tool with bindings: exact text-slot copy and asset-slot references, plus faq_count for FAQ only. It returns deterministically bound HTML and unchanged CSS; unknown/missing slots are rejected and caller HTML/CSS is never accepted. No files are fetched, stored or published; approval and visual QC are still required.';

export function getOnepageUiTemplate(version = ONEPAGE_TEMPLATE_VERSION, format: 'manifest' | 'source' = 'manifest') {
  const template = Object.hasOwn(templates, version) ? templates[version] : undefined;
  if (!template) throw new Error('Unknown Onepage UI template version');
  if (format !== 'manifest' && format !== 'source') throw new Error('Invalid template format');
  const base = `${[qualityAlignedTemplate.version, faqTemplate.version].includes(version) ? TEMPLATE_PRODUCTION_ORIGIN : LEGACY_TEMPLATE_ORIGIN}/api/onepage-ui-template/${version}`;
  const manifest = {
    id: template.id, version, scope: template.scope,
    live_html_feedback: getOnepageReviewContract(),
    post_story_section: version === faqTemplate.version ? 'faq' : 'gtk',
    variants: { gtk: qualityAlignedTemplate.version, faq: faqTemplate.version },
    ...(version === faqTemplate.version ? { faq_binding: faqSection.binding, faq_css_reference: { url: faqSection.css_reference_url, sha256: faqSection.css_source_sha256 } } : {}),
    reference_url: template.reference_url, captured_at: template.captured_at,
    urls: { html: `${base}/template.html`, css: `${base}/styles.css`, bundle: `${base}/bundle.json`, manifest: `${base}/manifest.json` },
    sha256: { html: template.html_sha256, css: template.css_sha256, original_app_css: template.app_css_sha256 },
    asset_slots: template.asset_slots, text_slots: template.text_slots,
    ui_content_contract: ONEPAGE_UI_CONTENT_CONTRACT,
    technical_quality_gate: { command: 'node --import tsx scripts/preflight-creative-package.ts manifest.json', schema: 'uid.creative-package-input.v1', purpose: 'Decode and hash actual local asset bytes before deterministic binding. Use onepage.bindings with assets matching the decoded manifest exactly.', browser_qa: 'scripts/quality/fixed_ui.py compares the approved source and candidate at equal viewport/state; inspect actual desktop/mobile images separately.', limitations: 'Host execution required; this API does not fetch/decode assets, certify provider interaction or perform visual QC.' },
    deterministic_binding: { tool: 'get_onepage_ui_template', input: { version, bindings: { text: 'Exact complete data-text-slot map; no section heading aliases', assets: 'Exact complete data-asset-slot map; HTTPS or relative file references', ...(version === faqTemplate.version ? { faq_count: 'Number of approved FAQ answers, 1–100' } : {}) } }, required_before: 'RENDER_UI_MAPPING', output: 'Use returned bound html and unchanged css, not a manually reconstructed page', limitations: 'Cannot prevent an external host from ignoring or later editing the bound output. Does not certify product truth or visual QC.' },
    verification: template.verification,
    canvas_gutter: version !== originalTemplate.version ? { desktop_px: 32, mobile_px: 16, mobile_max_width_px: 798 } : null,
    layout_lock: 'HARD: preserve captured DOM/classes/section order, widths, columns, gaps, padding, typography, borders, backgrounds, masks, object-fit, object-position and responsive CSS. Preserve the approved outer canvas gutters in this version. Substitute approved images and exact copy only. Render mapping from this template; never use imagegen to redraw the page.',
    loading: 'Download html + css into the same folder (styles.css is relative to template.html), or use bundle.json. Fonts and fixed UI checkmarks are embedded. This backend-owned template supersedes libfile/ZIP references and split feedback payloads as the executable UI source. Do not fetch the live PDP to rebuild layout. If unavailable, report template retrieval failure without guessing.',
    binding: 'Use a DOM parser. Set img[src] and source[srcset] using data-asset-slot; delete stale img[srcset]. Set textContent of data-text-slot elements using exact approved copy. ui_checkmark is a fixed embedded GTK-only UI dependency. FAQ row repetition follows faq_binding. Resolve supplied asset paths relative to output HTML. Do not alter other DOM/style properties.',
    qa: 'Compare at the same viewport; inspect desktop, mobile and 798/799px breakpoints. Check circular Product Details masks, full badge readability and final-package assets. ' + (version === faqTemplate.version ? 'Check every FAQ answer expanded, long question wrapping, unique input/label IDs and no GTK placeholders. ' : 'Check rounded Good To Know masks. ') + 'Downloadability/source hashes do not certify pixel parity. ' + ([qualityAlignedTemplate.version, faqTemplate.version].includes(version) ? 'Ship exactly one full-page desktop PNG mapping named onepage_{product_slug}-overall.png (lowercase snake_case product slug) in the normal creative package; production assets remain WebP. This explicit mapping exception supersedes historical WebP-only preview metadata.' : 'Ship the existing WebP mapping only in the normal creative package.')
  };
  return format === 'source' ? { ...manifest, html: template.html, css: template.css } : manifest;
}

export function getTemplateFile(version: string, file: string) {
  const template = Object.hasOwn(templates, version) ? templates[version] : undefined;
  if (!template) return null;
  if (file === 'template.html') return { type: 'text/html', body: template.html, hash: template.html_sha256 };
  if (file === 'styles.css') return { type: 'text/css', body: template.css, hash: template.css_sha256 };
  const value = file === 'manifest.json' ? getOnepageUiTemplate(version) : file === 'bundle.json' ? getOnepageUiTemplate(version, 'source') : null;
  if (!value) return null;
  const body = JSON.stringify(value);
  return { type: 'application/json', body, hash: createHash('sha256').update(body).digest('hex') };
}

export type OnepageBindings = { text: Record<string, string>; assets: Record<string, string>; faq_count?: number };
/** Deterministic substitution into trusted source, never accepting caller HTML/CSS.
 * The only repeated structure is the existing FAQ row prototype.
 */
export function bindOnepageUiTemplate(version: string | undefined, bindings: OnepageBindings) {
  const source = getOnepageUiTemplate(version, 'source') as ReturnType<typeof getOnepageUiTemplate> & { html: string; css: string };
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || Object.keys(bindings).some(key => !['text', 'assets', 'faq_count'].includes(key))) throw new Error('INVALID_TEMPLATE_BINDINGS');
  const mode = source.post_story_section;
  if (mode === 'gtk' && bindings.faq_count !== undefined) throw new Error('FAQ_COUNT_FORBIDDEN_IN_GTK');
  const issues = validateOnepageUiCopy(bindings.text, mode, bindings.faq_count ?? 0);
  if (issues.length) throw new Error(issues.join(','));
  const assets = bindings.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets) || Object.keys(assets).some(key => !source.asset_slots.includes(key)) || source.asset_slots.some(key => !Object.hasOwn(assets, key))) throw new Error('ASSETS_MUST_MATCH_TEMPLATE_SLOTS');
  for (const value of Object.values(assets)) {
    // This tool never fetches URLs. Restrict generated src attributes nonetheless.
    if (typeof value !== 'string' || !value || value.length > 4000 || /[\u0000-\u0020\u007f\\]/u.test(value) || value.startsWith('//') || value.startsWith('/') || value.startsWith('#') || (/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('https://'))) throw new Error('UNSAFE_ASSET_REFERENCE');
    if (value.startsWith('https://')) { const url = new URL(value); if (!url.hostname || url.username || url.password) throw new Error('UNSAFE_ASSET_REFERENCE'); }
  }
  let html = source.html;
  if (mode === 'faq') {
    const marker = '<div class="uid-faqs-item" data-faq-item="01">';
    const start = html.indexOf(marker);
    if (start < 0 || html.indexOf(marker, start + marker.length) >= 0) throw new Error('INVALID_FAQ_TEMPLATE_ROW');
    const tags = /<div\b[^>]*>|<\/div\s*>/g; tags.lastIndex = start;
    let depth = 0, end = -1;
    for (let match = tags.exec(html); match; match = tags.exec(html)) { depth += match[0].startsWith('</') ? -1 : 1; if (depth === 0) { end = tags.lastIndex; break; } }
    if (end < 0) throw new Error('INVALID_FAQ_TEMPLATE_ROW');
    const row = html.slice(start, end);
    const repeated = Array.from({ length: bindings.faq_count! }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return row.replace(/faq_question_01/g, `faq_question_${n}`).replace(/faq_answer_01/g, `faq_answer_${n}`).replace(/uid-faq-01/g, `uid-faq-${n}`).replace('data-faq-item="01"', `data-faq-item="${n}"`);
    }).join('');
    html = html.slice(0, start) + repeated + html.slice(end);
  }
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const values = { ...assets, ...bindings.text };
  html = html.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, slot) => {
    if (!Object.hasOwn(values, slot)) throw new Error('UNBOUND_TEMPLATE_SLOT');
    return escape(values[slot]);
  });
  return {
    status: 'BOUND_REQUIRES_VISUAL_QA', template_version: source.version,
    template_sha256: source.sha256, html, css: source.css,
    sha256: { html: createHash('sha256').update(html).digest('hex'), css: source.sha256.css },
    visual_qc_performed: false, content_approval: 'HOST_MUST_VERIFY_EXISTING_APPROVAL',
    instruction: 'Save this exact bound HTML beside unchanged styles.css and supplied assets, then render and inspect desktop/mobile. Do not insert or rewrite nodes after binding. A changed copy/asset requires a fresh binding. Binding validates structure/slots only, not product truth, asset bytes, content approval or visual quality. No content is stored, uploaded or published by this call.',
  };
}

export function attachOnepageUiTemplate(data: any, brand: string, branch: string) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const brandSlug = String(data.resolved?.brand || brand).toLowerCase().replace(/[^a-z0-9]/g, '');
  const branchSlug = String(data.resolved?.branch || branch).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!['pawfecthouse', 'giftsoul', 'soulprise'].includes(brandSlug) || !['onepage', 'onepagesystem'].includes(branchSlug)) return data;
  const quality = data.creative_quality_contract;
  const ruleCompiler = quality?.compiler_version === RULE_COMPILER;
  const currentCompiler = quality?.compiler_version === QUALITY_COMPILER || ruleCompiler;
  const hasRuleEnvelope = quality && (Object.hasOwn(quality, 'agent_rule_reviewed_supplemental_rules') || Object.hasOwn(quality, 'agent_rule_reviewed_supplemental_policy')) || Object.hasOwn(data, 'agent_rule_reviewed_supplemental_contract');
  const ownerCompiler = currentCompiler || quality?.compiler_version === '2026-10-13-owner-supplement-v1';
  const hasAgentEnvelope = quality && (Object.hasOwn(quality, 'agent_reviewed_supplemental_rules') || Object.hasOwn(quality, 'agent_reviewed_supplemental_policy')) || Object.hasOwn(data, 'agent_reviewed_supplemental_contract');
  const hasSupplementEnvelope = quality && (Object.hasOwn(quality, 'owner_supplemental_rules') || Object.hasOwn(quality, 'owner_supplemental_policy')) || Object.hasOwn(data, 'owner_supplemental_contract');
  const { contract_hash: _claimedHash, ...hashableQuality } = quality && typeof quality === 'object' ? quality : {};
  const supplementValid = ownerCompiler && Array.isArray(quality?.owner_supplemental_rules)
    && quality.owner_supplemental_rules.length <= MAX_OWNER_SUPPLEMENTS
    && quality.owner_supplemental_rules.every((rule: any) => ownerSupplementalShapeValid(rule,brandSlug,'onepage-system')
      && createHash('sha256').update(rule.canonical_text).digest('hex') === rule.source.canonical_text_hash)
    && new Set(quality.owner_supplemental_rules.map((r: any) => r.id)).size === quality.owner_supplemental_rules.length
    && quality.owner_supplemental_policy?.layer === 'OWNER_APPROVED_VERBATIM_SUPPLEMENT'
    && quality.owner_supplemental_policy?.precedence === OWNER_SUPPLEMENTAL_PRECEDENCE
    && quality.owner_supplemental_policy?.visual_qc_performed === false
    && quality.owner_supplemental_policy?.semantic_consistency === 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS'
    && createHash('sha256').update(stableJson(hashableQuality)).digest('hex') === quality.contract_hash
    && (!data.owner_supplemental_contract || stableJson(data.owner_supplemental_contract) === stableJson({ ...quality.owner_supplemental_policy, rules: quality.owner_supplemental_rules }));
  const agentSupplementValid = currentCompiler && Array.isArray(quality?.agent_reviewed_supplemental_rules) && Array.isArray(quality?.owner_supplemental_rules)
    && quality.agent_reviewed_supplemental_rules.length + (quality.owner_supplemental_rules?.length || 0) <= MAX_OWNER_SUPPLEMENTS
    && quality.agent_reviewed_supplemental_rules.every((rule: any) => agentReviewedSupplementalShapeValid(rule,brandSlug,'onepage-system')
      && createHash('sha256').update(rule.canonical_text).digest('hex') === rule.source.canonical_text_hash)
    && new Set([...quality.owner_supplemental_rules,...quality.agent_reviewed_supplemental_rules].map((r: any) => r.proposal_id)).size === quality.owner_supplemental_rules.length + quality.agent_reviewed_supplemental_rules.length
    && quality.agent_reviewed_supplemental_policy?.layer === 'OWNER_APPROVED_AGENT_REVIEWED_VERBATIM_SUPPLEMENT'
    && quality.agent_reviewed_supplemental_policy?.precedence === OWNER_SUPPLEMENTAL_PRECEDENCE
    && quality.agent_reviewed_supplemental_policy?.review_scope === AGENT_REVIEW_SCOPE
    && (!data.agent_reviewed_supplemental_contract || stableJson(data.agent_reviewed_supplemental_contract) === stableJson({ ...quality.agent_reviewed_supplemental_policy, rules: quality.agent_reviewed_supplemental_rules }));
  const compilerSupported = ownerCompiler ? supplementValid && (currentCompiler ? agentSupplementValid : !hasAgentEnvelope)
    : quality?.compiler_version === '2026-10-11-v2' && !hasSupplementEnvelope && !hasAgentEnvelope;
  const ruleSupplements=quality?.agent_rule_reviewed_supplemental_rules;
  const combinedSupplements=[...(Array.isArray(quality?.owner_supplemental_rules)?quality.owner_supplemental_rules:[]),...(Array.isArray(quality?.agent_reviewed_supplemental_rules)?quality.agent_reviewed_supplemental_rules:[]),...(Array.isArray(ruleSupplements)?ruleSupplements:[])];
  const ruleSupplementValidResult=ruleCompiler ? Array.isArray(ruleSupplements)
    && ruleSupplements.every((r:any)=>ruleSupplementValid(r,brandSlug,'onepage-system')&&createHash('sha256').update(r.canonical_text).digest('hex')===r.source.canonical_text_hash)
    && combinedSupplements.length<=MAX_OWNER_SUPPLEMENTS
    && new Set(combinedSupplements.map((r:any)=>r.proposal_id)).size===combinedSupplements.length
    && quality.agent_rule_reviewed_supplemental_policy?.review_scope===RULE_REVIEW_SCOPE
    && quality.agent_rule_reviewed_supplemental_policy?.visual_qc_performed===false
    && quality.agent_rule_reviewed_supplemental_policy?.precedence===OWNER_SUPPLEMENTAL_PRECEDENCE
    && (!data.agent_rule_reviewed_supplemental_contract||stableJson(data.agent_rule_reviewed_supplemental_contract)===stableJson({...quality.agent_rule_reviewed_supplemental_policy,rules:ruleSupplements}))
    : !hasRuleEnvelope;
  const qualityValid = quality?.schema_version === 'uid-creative-quality/1' && compilerSupported && ruleSupplementValidResult &&
    /^[a-f0-9]{64}$/.test(String(quality.contract_hash || '')) && ['COMPILED','BLOCKED'].includes(quality.status) &&
    (quality.status === 'BLOCKED' || (typeof quality.revision === 'string' && !!quality.revision.trim())) &&
    quality.route?.brand === brandSlug && quality.route?.branch === 'onepage-system' &&
    quality.gates && ['READY_WITH_SOURCE_RESEARCH','BLOCKED'].includes(quality.gates.content_authoring) &&
    ['BLOCKED','REQUIRES_PRODUCT_PIXEL_INSPECTION','REQUIRES_PRODUCT_AND_REFERENCE_PIXEL_INSPECTION'].includes(quality.gates.asset_generation) &&
    quality.gates.human_artistic_review === 'REQUIRED' && quality.gates.identical_pixels_guaranteed === false &&
    quality.reference_gate && ['BLOCKED_MISSING_REFERENCES','PIXEL_INSPECTION_REQUIRED','NO_REQUIRED_STYLE_REFERENCES'].includes(quality.reference_gate.status) &&
    Array.isArray(quality.rules) && quality.rules.every((rule: any) => rule && typeof rule === 'object' && typeof rule.id === 'string' && typeof rule.key === 'string' && typeof rule.instruction === 'string') && Array.isArray(quality.errors);
  const quality_execution_guard = qualityValid
    ? { status: quality.status, contract_hash: quality.contract_hash, gates: quality.gates, reference_gate: quality.reference_gate, errors: quality.errors }
    : { status: 'BLOCKED', reason: quality ? 'UPSTREAM_QUALITY_CONTRACT_INVALID' : 'UPSTREAM_QUALITY_CONTRACT_MISSING', instruction: 'The upstream compiler/resolver has not provided a valid current quality contract for this route. Do not claim quality consistency or silently use account memory. Retry after backend synchronization.' };
  const mappingFormat = qualityValid ? quality.rules.find((rule: any) => rule.key === 'delivery.mapping_format')?.value : undefined;
  const template_policy_compatibility = !qualityValid
    ? { status: 'BLOCKED_QUALITY_CONTRACT', stage: 'mapping', instruction: 'A valid current quality contract is required before checking template policy compatibility.' }
    : mappingFormat && mappingFormat !== 'PNG'
    ? { status: 'BLOCKED_POLICY_TEMPLATE_MISMATCH', stage: 'mapping', instruction: 'The active delivery policy differs from this immutable PNG template manifest. Publish a reviewed metadata/template revision before mapping; do not silently pick one format.' }
    : { status: 'COMPATIBLE', mapping_format: 'PNG', faq_variant: 'AVAILABLE', faq_version: faqTemplate.version };
  return { ...data,
    ...(data.post_story_section ? { post_story_section: { ...data.post_story_section,
      faq_template_status: 'AVAILABLE_IN_GATEWAY', faq_mapping_gate: 'SELECT_FAQ_TEMPLATE_AND_EXPAND_ALL_ANSWERS',
      faq_template_version: faqTemplate.version,
    } } : {}),
    ui_mapping_templates: { gtk: getOnepageUiTemplate(), faq: getOnepageUiTemplate(faqTemplate.version) },
    onepage_preview_contract: getOnepageReviewContract(),
    quality_execution_guard, template_policy_compatibility, ui_mapping_template: getOnepageUiTemplate(), instruction: `${data.instruction || ''}\nBefore rendering, call get_onepage_ui_template with bindings for the selected version, then use its returned bound HTML/CSS without adding nodes. This deterministic path rejects copy outside declared UI slots; never reconstruct a layout to fit an approved draft. Select exactly one ui_mapping_templates variant from the approved GTK/FAQ content decision; ui_mapping_template is the backward-compatible GTK default, not an FAQ fallback. For FAQ use the faq version, bind only approved questions and answers, keep every answer expanded, and omit GTK assets. UI mapping MUST use the selected template's backend-owned HTML/CSS download URLs; these supersede Library file IDs and split template feedback. Bind assets/copy and render without rebuilding the layout from a live page. Deliver the actual bound output in chat with grouped Feedback Onepage guidance using onepage_preview_contract, alongside the required PNG and production assets at their approved stages. Do not require or deliver a hosted web preview; preserve canonical layout and do not substitute the demo.`.trim() };
}
