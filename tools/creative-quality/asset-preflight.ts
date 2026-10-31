import { createHash } from 'node:crypto';
import sharp from './sharp.ts';
export const ASSET_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, pixels: 32_000_000 });
export type PrintPlacement = { width_inches: number; height_inches: number; crop?: { left: number; top: number; width: number; height: number } };
export type SupplierSpec = { product_id: string; source_url: string; evidence_sha256: string; minimum_ppi: number; verification: 'verified' | 'unverified' };
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
/** Offline byte inspection. Does not fetch URLs, alter artwork, upscale or perform visual QC. */
export async function preflightAsset(bytes: Buffer, options: { expected_sha256?: string; placement?: PrintPlacement; supplier_spec?: SupplierSpec } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > ASSET_LIMITS.bytes) throw new Error('ASSET_BYTE_LIMIT');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (options.expected_sha256 !== undefined && (!/^[a-f0-9]{64}$/.test(options.expected_sha256) || options.expected_sha256 !== sha256)) throw new Error('ASSET_HASH_MISMATCH');
  const decoder = sharp(bytes, { limitInputPixels: ASSET_LIMITS.pixels, failOn: 'warning', sequentialRead: true });
  const meta = await decoder.metadata();
  if (!['png', 'jpeg', 'webp', 'avif'].includes(meta.format || '') || (meta.pages || 1) !== 1) throw new Error('UNSUPPORTED_OR_ANIMATED_ASSET');
  // Force full pixel decode, not merely metadata/header parsing. Orient before crop math.
  const { info } = await decoder.rotate().raw().toBuffer({ resolveWithObject: true });
  const blockers: string[] = [];
  let effective_ppi: { x: number; y: number; minimum: number } | null = null;
  if (options.placement) {
    const p = options.placement;
    if (!positive(p.width_inches) || !positive(p.height_inches)) throw new Error('INVALID_PRINT_PLACEMENT');
    const crop = p.crop || { left: 0, top: 0, width: info.width, height: info.height };
    if (![crop.left,crop.top,crop.width,crop.height].every(Number.isInteger) || crop.left < 0 || crop.top < 0 || crop.width <= 0 || crop.height <= 0 || crop.left + crop.width > info.width || crop.top + crop.height > info.height) throw new Error('INVALID_ORIENTED_PIXEL_CROP');
    // Actual retained pixels / physical placement, not DPI header or canvas dimensions.
    const x = crop.width / p.width_inches, y = crop.height / p.height_inches;
    effective_ppi = { x, y, minimum: Math.min(x, y) };
    const spec = options.supplier_spec;
    if (!spec) blockers.push('SUPPLIER_SPEC_MISSING');
    else {
      let url: URL;
      try { url = new URL(spec.source_url); } catch { throw new Error('INVALID_SUPPLIER_SPEC'); }
      if (!spec.product_id?.trim() || url.protocol !== 'https:' || url.username || url.password || !/^[a-f0-9]{64}$/.test(spec.evidence_sha256) || !positive(spec.minimum_ppi) || !['verified','unverified'].includes(spec.verification)) throw new Error('INVALID_SUPPLIER_SPEC');
      if (spec.verification !== 'verified') blockers.push('SUPPLIER_SPEC_NOT_VERIFIED');
      if (Math.min(x,y) < spec.minimum_ppi) blockers.push('INSUFFICIENT_EFFECTIVE_PPI');
    }
  } else if (options.supplier_spec) throw new Error('PRINT_PLACEMENT_REQUIRED');
  return { schema_version: 'uid.asset-byte-preflight.v1', status: blockers.length ? 'BLOCKED' : 'TECHNICAL_CHECKS_PASSED_NOT_VISUAL_QC', sha256,
    byte_length: bytes.length, decode: 'FULL_PIXEL_DECODE_PASSED', width: info.width, height: info.height,
    format: meta.format, channels: info.channels, has_alpha: meta.hasAlpha, color_space: meta.space,
    has_icc_profile: !!meta.icc?.length, embedded_density: meta.density ?? null,
    effective_ppi, supplier_spec: options.supplier_spec ?? null, supplier_evidence_independently_verified: false,
    blockers, visual_qc_performed: false, print_ready: false,
    limitations: 'Caller must verify supplier evidence matches this exact product and crop/placement, inspect pixels, and verify print color/profile requirements. Decode and PPI do not establish original detail or visual quality; upscaled pixels cannot prove source detail.' };
}
