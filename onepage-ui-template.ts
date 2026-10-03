import { createHash } from 'node:crypto';
import originalTemplate from './templates/onepage-ui-v1.json' with { type: 'json' };

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
const templates: Record<string, typeof originalTemplate> = {
  [originalTemplate.version]: originalTemplate,
  [paddedTemplate.version]: paddedTemplate,
};
export const ONEPAGE_TEMPLATE_VERSION = paddedTemplate.version;
export const TEMPLATE_PRODUCTION_ORIGIN = 'https://creative-dna-gateway.vercel.app';
export const ONEPAGE_TEMPLATE_DESC = 'Read the versioned, shared Onepage UI mapping template. Returns stable download URLs, SHA-256 hashes, required asset/text slots and exact-layout instructions. Download template.html and styles.css into the same folder, bind approved assets/copy using a DOM parser, then render. No ChatGPT Library access is needed. Use format=source only when inline HTML/CSS is necessary; source is large. Never redraw the mapping or reload the live PDP to reconstruct the layout.';

export function getOnepageUiTemplate(version = ONEPAGE_TEMPLATE_VERSION, format: 'manifest' | 'source' = 'manifest') {
  const template = Object.hasOwn(templates, version) ? templates[version] : undefined;
  if (!template) throw new Error('Unknown Onepage UI template version');
  if (format !== 'manifest' && format !== 'source') throw new Error('Invalid template format');
  const base = `${TEMPLATE_PRODUCTION_ORIGIN}/api/onepage-ui-template/${version}`;
  const manifest = {
    id: template.id, version, scope: template.scope,
    reference_url: template.reference_url, captured_at: template.captured_at,
    urls: { html: `${base}/template.html`, css: `${base}/styles.css`, bundle: `${base}/bundle.json`, manifest: `${base}/manifest.json` },
    sha256: { html: template.html_sha256, css: template.css_sha256, original_app_css: template.app_css_sha256 },
    asset_slots: template.asset_slots, text_slots: template.text_slots,
    verification: template.verification,
    canvas_gutter: version === paddedTemplate.version ? { desktop_px: 32, mobile_px: 16, mobile_max_width_px: 798 } : null,
    layout_lock: 'HARD: preserve captured DOM/classes/section order, widths, columns, gaps, padding, typography, borders, backgrounds, masks, object-fit, object-position and responsive CSS. Preserve the approved outer canvas gutters in this version. Substitute approved images and exact copy only. Render mapping from this template; never use imagegen to redraw the page.',
    loading: 'Download html + css into the same folder (styles.css is relative to template.html), or use bundle.json. Fonts and fixed UI checkmarks are embedded. This backend-owned template supersedes libfile/ZIP references and split feedback payloads as the executable UI source. Do not fetch the live PDP to rebuild layout. If unavailable, report template retrieval failure without guessing.',
    binding: 'Use a DOM parser. Set img[src] and source[srcset] using data-asset-slot; delete stale img[srcset]. Set textContent of data-text-slot elements using exact approved copy. ui_checkmark is a fixed embedded UI dependency. Resolve supplied asset paths relative to output HTML. Do not alter other DOM/style properties.',
    qa: 'Compare at the same viewport; inspect desktop, mobile and 798/799px breakpoints. Check circular Product Details masks, rounded Good To Know masks, full badge readability and final-package assets. Downloadability/source hashes do not certify pixel parity. Ship the existing WebP mapping only in the normal creative package.'
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

export function attachOnepageUiTemplate(data: any, brand: string, branch: string) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const brandSlug = String(data.resolved?.brand || brand).toLowerCase().replace(/[^a-z0-9]/g, '');
  const branchSlug = String(data.resolved?.branch || branch).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!['pawfecthouse', 'giftsoul', 'soulprise'].includes(brandSlug) || !['onepage', 'onepagesystem'].includes(branchSlug)) return data;
  return { ...data, ui_mapping_template: getOnepageUiTemplate(), instruction: `${data.instruction || ''}\nUI mapping MUST use ui_mapping_template's backend-owned HTML/CSS download URLs; these supersede Library file IDs and split template feedback. Bind assets/copy and render without rebuilding the layout from a live page.`.trim() };
}
