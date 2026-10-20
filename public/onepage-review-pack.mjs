/** Offline packaging only. No uploads, generation, canonical changes or layout rewrite.
 * node onepage-review-pack.mjs bound.html manifest.json review.html
 * Keep the review beside bound.html so relative image/CSS URLs retain their meaning.
 */
import {readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
export function packageOnepageReview(html, input, runtime, css) {
  if (!input || input.schema_version !== 'uid-onepage-preview/1') throw new Error('INVALID_ONEPAGE_MANIFEST');
  const identityType = input.identity_type || 'task';
  if (!['task','outcome'].includes(identityType)) throw new Error('INVALID_IDENTITY_TYPE');
  const identityKey = identityType === 'task' ? 'task_id' : 'outcome_id';
  if (identityType === 'outcome' && input.task_id) throw new Error('OUTCOME_MUST_NOT_FABRICATE_TASK_ID');
  for (const key of [identityKey, 'content_version', 'brand', 'template_version']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error('MISSING_' + key.toUpperCase());
  }
  if (!Array.isArray(input.asset_manifest) || !input.asset_manifest.length) throw new Error('ACTUAL_ASSET_INVENTORY_REQUIRED');
  const slots = new Set();
  for (const asset of input.asset_manifest) {
    if (!asset || !['slot','asset_id','file_url'].every(k => typeof asset[k] === 'string' && asset[k].trim()) || !/^sha256:[a-f0-9]{64}$/.test(asset.checksum)) throw new Error('INVALID_ASSET_MAPPING');
    if (slots.has(asset.slot)) throw new Error('DUPLICATE_ASSET_SLOT');
    if (/^(?:javascript|vbscript|data):/i.test(asset.file_url.trim())) throw new Error('UNSAFE_ASSET_URL');
    slots.add(asset.slot);
  }
  if (!/<\/body\s*>/i.test(html) || /id\s*=\s*["']onepage-review-(?:manifest|styles|runtime)["']/i.test(html)) throw new Error('MISSING_BODY_OR_ALREADY_INSTRUMENTED');
  if (/\{\{[^}]+\}\}/.test(html)) throw new Error('UNBOUND_TEMPLATE_PLACEHOLDERS');
  if (/<\/script/i.test(runtime) || /<\/style/i.test(css)) throw new Error('INVALID_REVIEW_RUNTIME');
  const renderHash = hash(html);
  if (input.render_hash && input.render_hash !== renderHash) throw new Error('STALE_RENDER_HASH');
  const manifest = {...input, identity_type: identityType, render_hash: renderHash, source_html_sha256:renderHash};
  const controls = `\n<template id="onepage-review-styles"><style>${css}</style></template>\n<script type="application/json" id="onepage-review-manifest">${json(manifest)}</script>\n<script id="onepage-review-runtime">${runtime}</script>\n`;
  return {html: html.replace(/<\/body\s*>/i, match => controls + match), manifest};
}
function main() {
  const [source, manifestPath, destination] = process.argv.slice(2);
  if (!source || !manifestPath || !destination) throw new Error('Usage: node onepage-review-pack.mjs bound.html manifest.json review.html');
  if (resolve(source) === resolve(destination)) throw new Error('PRESERVE_ORIGINAL_MAPPING_USE_DISTINCT_OUTPUT');
  if (realpathSync(dirname(resolve(source))) !== realpathSync(dirname(resolve(destination)))) throw new Error('REVIEW_MUST_STAY_BESIDE_SOURCE_TO_PRESERVE_RELATIVE_URLS');
  const root = dirname(fileURLToPath(import.meta.url));
  const input = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const result = packageOnepageReview(readFileSync(source, 'utf8'), input, readFileSync(resolve(root, 'onepage-review.js'), 'utf8'), readFileSync(resolve(root, 'onepage-review.css'), 'utf8'));
  writeFileSync(destination, result.html, {flag:'wx'});
  console.log(JSON.stringify({status:'REVIEW_PACKAGED_REQUIRES_BROWSER_QA', file:basename(destination), identity_type:result.manifest.identity_type, task_id:result.manifest.task_id, outcome_id:result.manifest.outcome_id, content_version:result.manifest.content_version, render_hash:result.manifest.render_hash, visual_qc_performed:false, auto_send:false}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
