import { createHash } from 'node:crypto';
/** Exact captured control selectors; no layout, font, arbitrary selector or CSS inputs. */
export const BRAND_COLOR_TARGETS = Object.freeze({
  preview_background: ['.tee-btn--preview', 'background-color'],
  preview_text: ['.tee-btn--preview', 'color'],
  cart_background: ['#teeAtcButton', 'background-color'],
  cart_text: ['#teeAtcButton', 'color'],
  upload_background: ['.tee-btn--upload', 'background-color'],
  upload_text: ['.tee-btn--upload', 'color'],
} as const);
export function compileBrandColors(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('INVALID_BRAND_COLORS');
  const colors = input as Record<string, unknown>;
  if (!Object.keys(colors).length || Object.keys(colors).some(k => !Object.hasOwn(BRAND_COLOR_TARGETS, k))) throw new Error('UNKNOWN_OR_EMPTY_COLOR_TOKEN');
  const css = Object.keys(colors).sort().map(key => {
    const value = colors[key];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('COLOR_MUST_BE_OPAQUE_HEX');
    const [selector, property] = BRAND_COLOR_TARGETS[key as keyof typeof BRAND_COLOR_TARGETS];
    return `${selector}{${property}:${value.toLowerCase()} !important;}`;
  }).join('\n');
  return { schema_version: 'uid.brand-colors.v1', css, sha256: createHash('sha256').update(css).digest('hex'),
    scope: 'CAPTURED_TEEINBLUE_FORM_COLORS_ONLY', visual_qc_performed: false,
    required_checks: ['source_form_identity', 'selector_presence', 'desktop_mobile_geometry', 'interaction_state_parity', 'color_contrast'],
    instruction: 'Apply only to the captured source form. Never reconstruct fields, alter text/font/layout or change native handlers. Missing selectors or unsupported source variants block application; do not invent replacements.' };
}
