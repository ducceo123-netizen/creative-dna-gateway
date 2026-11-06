import { createHash } from 'node:crypto';
import { getOnepageUiTemplate } from './onepage-ui-template.ts';
import { stableJson } from './supabase/functions/_shared/creative-quality.ts';
import { ONEPAGE_DELIVERY_ROLES } from './supabase/functions/_shared/onepage-packaging.ts';
import { WORKSPACE_IMAGE_MODEL, type WorkspaceImageCapability } from './uid-workspace-image.ts';
import type { WorkspaceAssetSizingStrategy } from './uid-workspace-image-assets.ts';

/** Offline proposal only. No provider, review registry, credential, store, clock,
 * resize or authorization adapters exist in this module. A proposal deliberately
 * lacks the evidence_ref required by WorkspaceAssetSizingStrategy. */
export const WORKSPACE_IMAGE_SIZING_VERSION = 'uid.workspace-image-sizing.v1' as const;
export const WORKSPACE_IMAGE_SIZING_RULES = Object.freeze({
  min_side: 256, max_side: 2560, max_pixels: 2560 * 1440,
  side_multiple: 16, max_aspect_ratio: 3,
});
type Dimensions = { width: number; height: number };
export type WorkspaceImageSizingBlocker = { code: string; detail: string; canonical_slot?: string };
export type WorkspaceCanvasProposal = {
  canonical_size: string;
  ratio?: Dimensions;
  minimum_provider_size?: string;
  provider_size?: string;
  mode?: WorkspaceAssetSizingStrategy['mode'];
  blockers: WorkspaceImageSizingBlocker[];
};
export type WorkspaceImageSizingPin = {
  /** SHA-256 of stableJson(packet), not an untrusted provider claim. */
  packet_sha256: string;
  /** Canonical compiler's hash of stableJson(contract without contract_hash). */
  canonical_contract_sha256: string;
  template_version: string; template_html_sha256: string; template_css_sha256: string;
};
export type WorkspaceSizingSourceEvidence = {
  source: 'html' | 'css'; byte_offset: number; byte_length: number; sha256: string; excerpt: string;
};
export type WorkspaceImageSizingProposal = {
  canonical_slot: string; declared_size: string;
  status: 'review_required' | 'blocked';
  /** Intentionally not assignable to the executable sizing strategy type. */
  proposed_strategy?: Omit<WorkspaceAssetSizingStrategy, 'evidence_ref' | 'ui_display_size'>;
  geometry?: WorkspaceCanvasProposal;
  template_evidence: WorkspaceSizingSourceEvidence[];
  blockers: WorkspaceImageSizingBlocker[];
};
export type WorkspaceImageSizingPlan = {
  schema_version: typeof WORKSPACE_IMAGE_SIZING_VERSION;
  status: 'review_required' | 'blocked';
  authorization_granted: false; independent_review_required: true;
  quality_verified: false; provider_calls_performed: 0;
  pins?: WorkspaceImageSizingPin & { contract_document_sha256: string; assets_sha256: string };
  capability?: { verification_ref: string; project_id: string; sha256: string; evaluated_at: string };
  proposals: WorkspaceImageSizingProposal[];
  blockers: WorkspaceImageSizingBlocker[];
};
export type WorkspaceImageSizingInput = {
  packet: unknown; section: 'gtk' | 'faq'; pin: WorkspaceImageSizingPin;
  /** An existing independently verified attestation, never generated here.
   * Omission still produces geometry candidates, but blocks executable use. */
  capability?: WorkspaceImageCapability;
  /** Explicit caller time keeps this pure and reproducible. Required with capability. */
  evaluated_at?: string;
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => sha(stableJson(value));
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const block = (code: string, detail: string): WorkspaceImageSizingBlocker => ({ code, detail });
const size = ({ width, height }: Dimensions) => `${width}x${height}`;
function dimensions(value: unknown): Dimensions | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,3}x[1-9]\d{0,3}$/.test(value)) return null;
  const [width, height] = value.split('x').map(Number); return { width, height };
}
function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }
function validProviderSize(value: unknown): value is string {
  const d = dimensions(value), r = WORKSPACE_IMAGE_SIZING_RULES;
  return !!d && d.width >= r.min_side && d.height >= r.min_side && d.width <= r.max_side && d.height <= r.max_side
    && d.width * d.height <= r.max_pixels && d.width % r.side_multiple === 0 && d.height % r.side_multiple === 0
    && d.width <= r.max_aspect_ratio * d.height && d.height <= r.max_aspect_ratio * d.width;
}

/** Minimum area at an EXACT rational ratio. Candidate axes are integral multiples
 * of the reduced ratio. Provider alignment defines the multiplier's LCM, so no
 * floating-point ratio rounding, crop, padding, stretching or upscaling occurs.
 * With an allowlist, select its smallest fitting canvas, not an unlisted size. */
export function deriveWorkspaceImageCanvas(canonicalSize: string, allowedSizes?: readonly string[]): WorkspaceCanvasProposal {
  const result: WorkspaceCanvasProposal = { canonical_size: canonicalSize, blockers: [] };
  const target = dimensions(canonicalSize), rules = WORKSPACE_IMAGE_SIZING_RULES;
  if (!target) { result.blockers.push(block('CANONICAL_SIZE_INVALID', 'Expected positive integer dimensions, at most four digits per axis, without leading zeros.')); return result; }
  const divisor = gcd(target.width, target.height), ratio = { width: target.width / divisor, height: target.height / divisor }; result.ratio = ratio;
  if (ratio.width > rules.max_aspect_ratio * ratio.height || ratio.height > rules.max_aspect_ratio * ratio.width) {
    result.blockers.push(block('ASPECT_RATIO_UNSUPPORTED', `Exact ratio ${ratio.width}:${ratio.height} is outside 1:3 through 3:1.`)); return result;
  }
  const wa = rules.side_multiple / gcd(ratio.width, rules.side_multiple), ha = rules.side_multiple / gcd(ratio.height, rules.side_multiple);
  const alignment = wa * ha / gcd(wa, ha);
  const multiplier = Math.ceil(Math.max(divisor, Math.ceil(rules.min_side / ratio.width), Math.ceil(rules.min_side / ratio.height)) / alignment) * alignment;
  const minimum = size({ width: ratio.width * multiplier, height: ratio.height * multiplier });
  if (!validProviderSize(minimum)) {
    result.blockers.push(block('EXACT_CANVAS_EXCEEDS_PROVIDER_LIMITS', `Smallest aligned canvas ${minimum} exceeds the 2560-side or 3686400-pixel limit; a smaller canvas would change the ratio or upscale.`)); return result;
  }
  result.minimum_provider_size = minimum;
  if (allowedSizes !== undefined && (!Array.isArray(allowedSizes) || allowedSizes.length > 32 || allowedSizes.some(s => !validProviderSize(s)))) {
    result.blockers.push(block('PROVIDER_SIZE_ALLOWLIST_INVALID', 'Every allowed size must satisfy the existing transport size rules, with at most 32 entries.')); return result;
  }
  const candidates = (allowedSizes === undefined ? [minimum] : [...new Set(allowedSizes)]).filter(candidate => {
    const source = dimensions(candidate)!;
    return source.width >= target.width && source.height >= target.height && source.width * target.height === source.height * target.width;
  }).sort((a, b) => { const x = dimensions(a)!, y = dimensions(b)!; return x.width * x.height - y.width * y.height || x.width - y.width; });
  if (!candidates.length) {
    result.blockers.push(block('EXACT_CANVAS_NOT_ATTESTED', `No listed provider size can fit ${canonicalSize} at exact ratio without upscaling; geometric minimum is ${minimum}.`)); return result;
  }
  result.provider_size = candidates[0]; result.mode = candidates[0] === canonicalSize ? 'exact' : 'same_aspect_downscale'; return result;
}

function evidence(source: 'html' | 'css', bytes: string, excerpt: string): WorkspaceSizingSourceEvidence[] {
  const offset = bytes.indexOf(excerpt);
  return offset < 0 ? [] : [{ source, byte_offset: Buffer.byteLength(bytes.slice(0, offset)), byte_length: Buffer.byteLength(excerpt), sha256: sha(excerpt), excerpt }];
}
function iconEvidence(html: string, css: string, slot: string) {
  const out: WorkspaceSizingSourceEvidence[] = [];
  const tag = html.match(new RegExp(`<img\\b[^>]*data-asset-slot="${slot}"[^>]*>`))?.[0];
  if (tag) out.push(...evidence('html', html, tag));
  const selector = '.uid-product-occasions .uid-occasions__content-image';
  for (const match of css.matchAll(/\.uid-product-occasions \.uid-occasions__content-image\s*\{[^}]*\}/g)) out.push(...evidence('css', css, match[0]));
  // Include the enclosing mobile range and all intervening overrides, not just
  // the misleading first (desktop) width declaration. These are quotations,
  // not a general CSS engine or a claim to have resolved computed layout.
  const mediaStart = css.indexOf('@media only screen and (max-width: 798px)');
  const mobileRule = mediaStart < 0 ? -1 : css.indexOf(selector, mediaStart);
  if (mobileRule >= 0) out.push(...evidence('css', css, css.slice(mediaStart, css.indexOf('}', mobileRule) + 1)));
  return out;
}

/** Pin the actual local canonical templates and canonical JSON packet, then
 * produce a complete GTK/FAQ slot inventory. A hash match establishes identity,
 * not source authority, product truth, independent review or permission to spend. */
export function planWorkspaceCanonicalImageSizing(input: WorkspaceImageSizingInput): WorkspaceImageSizingPlan {
  const result: WorkspaceImageSizingPlan = { schema_version: WORKSPACE_IMAGE_SIZING_VERSION, status: 'blocked', authorization_granted: false,
    independent_review_required: true, quality_verified: false, provider_calls_performed: 0, proposals: [], blockers: [] };
  const stop = (code: string, detail: string) => { result.blockers.push(block(code, detail)); return result; };
  if (!record(input) || !['gtk', 'faq'].includes(input.section) || !record(input.pin) || !record(input.packet)) return stop('SIZING_INPUT_INVALID', 'A packet, explicit GTK/FAQ section and expected pins are required.');
  const { packet, pin } = input;
  if (![pin.packet_sha256, pin.canonical_contract_sha256, pin.template_html_sha256, pin.template_css_sha256].every(isHash)) return stop('SIZING_PIN_INVALID', 'All expected pins must be lowercase SHA-256 hashes.');
  let packetHash: string;
  try { packetHash = digest(packet); } catch { return stop('PACKET_NOT_CANONICAL_JSON', 'Packet must be serializable as canonical stable JSON.'); }
  if (packetHash !== pin.packet_sha256) return stop('PACKET_PIN_MISMATCH', 'The packet bytes under canonical stableJson serialization changed.');
  const contract = packet.creative_quality_contract;
  if (!record(contract) || contract.status !== 'COMPILED' || contract.contract_hash !== pin.canonical_contract_sha256) return stop('CANONICAL_CONTRACT_REQUIRED', 'A compiled contract matching the expected contract hash is required.');
  const { contract_hash: _hash, ...body } = contract;
  if (digest(body) !== pin.canonical_contract_sha256) return stop('CONTRACT_BYTES_MISMATCH', 'The actual contract body does not reproduce its compiler hash.');
  const current = getOnepageUiTemplate();
  if (pin.template_version !== current.variants[input.section]) return stop('CANONICAL_TEMPLATE_VERSION_MISMATCH', 'Pin the current canonical template for the explicitly selected GTK/FAQ section.');
  const template = getOnepageUiTemplate(pin.template_version, 'source');
  if (!('html' in template) || !('css' in template) || typeof template.html !== 'string' || typeof template.css !== 'string' || sha(template.html) !== pin.template_html_sha256 || sha(template.css) !== pin.template_css_sha256
    || template.sha256.html !== pin.template_html_sha256 || template.sha256.css !== pin.template_css_sha256) return stop('TEMPLATE_BYTES_MISMATCH', 'Pinned HTML/CSS hashes must match both the actual canonical bytes and template manifest.');
  const slots = Object.keys(ONEPAGE_DELIVERY_ROLES).filter(slot => input.section === 'gtk' || !slot.startsWith('gtk_'));
  const allSlots = Object.keys(ONEPAGE_DELIVERY_ROLES);
  if (!Array.isArray(packet.assets) || packet.assets.length > 128 || packet.assets.some(a => !record(a) || typeof a.slot !== 'string' || typeof a.size !== 'string')
    || new Set(packet.assets.map(a => a.slot)).size !== packet.assets.length || slots.some(slot => !packet.assets.some((a: { slot: string }) => a.slot === slot))
    || packet.assets.some(a => !allSlots.includes(a.slot) && a.slot !== 'ui_mapping_preview')) return stop('CANONICAL_ASSET_INVENTORY_INVALID', 'Require unique canonical production slots; only the deterministic full-page mapping is a non-image slot.');
  const templateSlots = new Set(template.asset_slots.map(slot => packet.template_asset_bindings?.[slot] ?? slot));
  if (slots.some(slot => !templateSlots.has(slot)) || [...templateSlots].some(slot => !slots.includes(slot))) return stop('TEMPLATE_ASSET_BINDING_MISMATCH', 'Packet aliases must map the pinned template to exactly the selected production inventory.');
  result.pins = { packet_sha256: pin.packet_sha256, canonical_contract_sha256: pin.canonical_contract_sha256, template_version: pin.template_version,
    template_html_sha256: pin.template_html_sha256, template_css_sha256: pin.template_css_sha256, contract_document_sha256: digest(contract), assets_sha256: digest(packet.assets) };
  let allowed: string[] | undefined;
  if (input.capability === undefined) result.blockers.push(block('IMAGE_CAPABILITY_REQUIRED', 'Geometry candidates are not a verified project/model size attestation. Supply an existing current capability before use.'));
  else {
    const c = input.capability, at = Date.parse(input.evaluated_at ?? ''), checked = Date.parse(c?.checked_at), expires = Date.parse(c?.expires_at);
    if (!record(c) || c.verified !== true || c.model !== WORKSPACE_IMAGE_MODEL || c.api !== 'images' || !isId(c.project_id) || !isId(c.verification_ref)
      || !Number.isFinite(at) || !Number.isFinite(checked) || !Number.isFinite(expires) || checked > at || expires <= at || checked >= expires
      || !Array.isArray(c.sizes) || !c.sizes.length || c.sizes.length > 32 || c.sizes.some(s => !validProviderSize(s))
      || !Array.isArray(c.operations) || !c.operations.includes('edit') || c.operations.length > 2 || c.operations.some(v => !['generate', 'edit'].includes(v))
      || !Array.isArray(c.accepted_response_models) || !c.accepted_response_models.includes(WORKSPACE_IMAGE_MODEL) || c.accepted_response_models.length > 8 || c.accepted_response_models.some(v => !/^gpt-image-2\.5-flare(?:-\d{4}-\d{2}-\d{2})?$/.test(v))
      || !Array.isArray(c.qualities) || !c.qualities.some(v => ['medium', 'high'].includes(v)) || c.qualities.length > 3 || c.qualities.some(v => !['low', 'medium', 'high'].includes(v))
      || !Array.isArray(c.output_formats) || !c.output_formats.includes('webp') || c.output_formats.length > 3 || c.output_formats.some(v => !['png', 'jpeg', 'webp'].includes(v))) return stop('IMAGE_CAPABILITY_INVALID_OR_EXPIRED', 'Require a current verified Image 2.5 Flare edit/WebP capability, supported quality and valid size allowlist at an explicit evaluation time.');
    allowed = [...c.sizes]; result.capability = { verification_ref: c.verification_ref, project_id: c.project_id, sha256: digest(c), evaluated_at: input.evaluated_at! };
  }
  for (const slot of slots) {
    const asset = packet.assets.find(a => a.slot === slot)!;
    const proposal: WorkspaceImageSizingProposal = { canonical_slot: slot, declared_size: asset.size, status: 'blocked', template_evidence: [], blockers: [] };
    if (asset.size === '3x_UI_DISPLAY_SIZE') {
      proposal.template_evidence = iconEvidence(template.html, template.css, slot);
      const quoted = proposal.template_evidence.map(e => e.excerpt).join('\n');
      const currentResponsiveGeometry = /width:\s*25%/.test(quoted) && /width:\s*40%/.test(quoted) && /max-width:\s*798px/.test(quoted) && /width="" height=""/.test(quoted);
      proposal.blockers.push(block('ICON_DISPLAY_GEOMETRY_UNPROVEN', currentResponsiveGeometry
        ? 'Pinned occasion icons use 25% container width on desktop and 40% at max-width 798px. Image width/height attributes are empty; no fixed pixel height or aspect ratio is established. A single integer display size and its 3x raster cannot be derived without an additional reviewed viewport/geometry specification.'
        : 'No supported fixed integer display geometry was proven for this slot from the pinned HTML/CSS. Review the actual responsive layout and intrinsic aspect requirements; no fallback pixel dimensions are assumed.'));
    } else {
      const geometry = deriveWorkspaceImageCanvas(asset.size, allowed); proposal.geometry = geometry; proposal.blockers.push(...geometry.blockers);
      if (geometry.provider_size && geometry.mode) {
        proposal.status = 'review_required'; proposal.proposed_strategy = { canonical_contract_sha256: pin.canonical_contract_sha256,
          canonical_slot: slot, canonical_size: asset.size, provider_size: geometry.provider_size, mode: geometry.mode };
      }
    }
    proposal.blockers = proposal.blockers.map(b => ({ ...b, canonical_slot: slot })); result.blockers.push(...proposal.blockers); result.proposals.push(proposal);
  }
  if (!result.blockers.length) result.status = 'review_required';
  return result;
}
