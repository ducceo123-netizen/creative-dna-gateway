/** Read-only local gate. node --import tsx scripts/preflight-creative-package.ts manifest.json
 * Local files only, no URL fetches or service writes. Prints evidence; exits nonzero on blocked.
 */
import { realpath } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { preflightAsset, ASSET_LIMITS } from '../uid-asset-preflight.ts';
import { compileBrandColors } from '../uid-brand-colors.ts';
import { bindOnepageUiTemplate } from '../onepage-ui-template.ts';
import { readBoundedPackageFile } from './quality/bounded-file.ts';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export async function preflightCreativePackage(manifestPath: string) {
  const root = await realpath(dirname(resolve(manifestPath)));
  const manifest = JSON.parse((await readBoundedPackageFile(root, basename(manifestPath), 1024 * 1024)).toString('utf8'));
  if (manifest.schema_version !== 'uid.creative-package-input.v1' || !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 100) throw new Error('INVALID_PACKAGE_MANIFEST');
  if (Object.keys(manifest).some(k => !['schema_version','assets','brand_colors','onepage'].includes(k))) throw new Error('UNKNOWN_MANIFEST_FIELD');
  const ids = new Set<string>();
  const inspected = [];
  for (const a of manifest.assets) {
    if (typeof a.id !== 'string' || !a.id.trim() || ids.has(a.id) || typeof a.path !== 'string') throw new Error('INVALID_ASSET_ID_OR_PATH');
    ids.add(a.id);
    const bytes = await readBoundedPackageFile(root, a.path, ASSET_LIMITS.bytes);
    const read_at = new Date().toISOString();
    const report = await preflightAsset(bytes, { expected_sha256: a.sha256, placement: a.placement, supplier_spec: a.supplier_spec });
    inspected.push({ reference: a.path, id: a.id, read_at, ...report });
  }
  // Revalidate the whole inventory after all decodes, immediately before binding.
  const receipts = [];
  for (const { reference, ...report } of inspected) {
    const revalidated = await readBoundedPackageFile(root, reference, ASSET_LIMITS.bytes);
    if (sha(revalidated) !== report.sha256) throw new Error('ASSET_BYTES_CHANGED_DURING_PREFLIGHT');
    receipts.push({ ...report, revalidated_at: new Date().toISOString() });
  }
  const branding = manifest.brand_colors === undefined ? null : compileBrandColors(manifest.brand_colors);
  let onepage = null;
  if (manifest.onepage) {
    if (Object.keys(manifest.onepage).some(k => !['template_version','bindings'].includes(k))) throw new Error('UNKNOWN_ONEPAGE_FIELD');
    const b = manifest.onepage.bindings;
    if (!b || !b.assets || Object.keys(b.assets).length !== manifest.assets.length || manifest.assets.some((a: {id: string; path: string}) => b.assets[a.id] !== a.path)) throw new Error('ONEPAGE_ASSETS_MUST_MATCH_DECODED_MANIFEST');
    if (!receipts.some(r => r.status === 'BLOCKED')) onepage = bindOnepageUiTemplate(manifest.onepage.template_version, b);
  }
  return { schema_version: 'uid.creative-package-preflight.v1', status: receipts.some(r => r.status === 'BLOCKED') ? 'BLOCKED' : 'TECHNICAL_CHECKS_PASSED_REQUIRES_BROWSER_AND_VISUAL_QC', receipts, branding, onepage, visual_qc_performed: false, publish_authorized: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!process.argv[2]) throw new Error('MANIFEST_PATH_REQUIRED'); const result = await preflightCreativePackage(process.argv[2]); console.log(JSON.stringify(result, null, 2)); if (result.status === 'BLOCKED') process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({ status: 'BLOCKED', error: error instanceof Error ? error.message : String(error), visual_qc_performed: false })); process.exitCode = 1; }
}
