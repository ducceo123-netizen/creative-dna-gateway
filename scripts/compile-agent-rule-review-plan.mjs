#!/usr/bin/env node
/** No network, credentials, models or database writes. Bootstrap MUST first verify
 * this file against the SQL-pinned source manifest using a trusted hash utility. */
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = [
  'bun.lock', 'package.json', 'scripts/agent-rule-review-compiler.bundle.mjs',
  'scripts/compile-agent-rule-review-plan.mjs', 'supabase/functions/_shared/agent-rule-review-plan.ts', 'supabase/functions/_shared/agent-rule-policy.ts', 'supabase/functions/_shared/agent-rule-quality.ts',
  'supabase/functions/_shared/creative-quality.ts', 'supabase/functions/_shared/owner-rule-plan.ts',
].sort();
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}' : JSON.stringify(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const blocked = (code, message) => ({ status: 'BLOCKED', compiler_plan: null, compiler_receipt: null,
  blockers: [{ code, message, next_action: 'Keep the proposal pending. Obtain the exact trusted compiler release and a current complete review before retrying.' }] });
function manifest() {
  return paths.map(path => {
    const fullPath = resolve(root, path);
    if (!lstatSync(fullPath).isFile() || lstatSync(fullPath).isSymbolicLink()) throw new Error('Compiler file is missing, not regular, or a symlink: ' + path);
    return { path, sha256: hash(readFileSync(fullPath)) };
  });
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24 || !globalThis.crypto?.subtle) return blocked('compiler_runtime_unavailable', 'This pinned host compiler requires Node 24 with built-in Web Crypto.');
  const sourceManifest = manifest(), bundleHash = hash(stable(sourceManifest));
  if (process.argv.includes('--print-manifest')) return { source_manifest: sourceManifest, compiler_bundle_hash: bundleHash };
  if (process.argv.length !== 2) return blocked('compiler_arguments_invalid', 'Read the fixed claim and genuine review JSON from standard input; arbitrary source paths and flags are not supported.');
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 8000000) return blocked('compiler_input_too_large', 'The bounded compiler input exceeds eight megabytes.'); chunks.push(chunk); }
  let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return blocked('compiler_input_invalid', 'Expected JSON containing claim and genuine review.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'claim,review') return blocked('compiler_input_invalid', 'Input must contain exactly claim and review.');
  const capability = input.claim?.snapshot?.compiler_capability;
  if (!capability || capability.compiler_bundle_hash !== bundleHash || stable(capability.source_manifest) !== stable(sourceManifest))
    return blocked('compiler_source_mismatch', 'The available compiler files do not match the immutable SQL-pinned manifest. No compiler code was imported.');
  // Only fixed, hash-verified local release code is imported. Input cannot choose code.
  let compiler; try { compiler = await import('./agent-rule-review-compiler.bundle.mjs'); } catch { return blocked('compiler_import_failed', 'The verified standalone compiler artifact could not load in this runtime.'); }
  const result = await compiler.buildAgentRuleReviewPlan(input.claim, input.review);
  if (result.status === 'COMPILED' && result.compiler_receipt.compiler_bundle_hash !== bundleHash) return blocked('compiler_receipt_mismatch', 'The compiler receipt is not bound to the verified runtime artifact.');
  return result;
}
try {
  const result = await main(); process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status === 'BLOCKED') process.exitCode = 2;
} catch {
  process.stdout.write(JSON.stringify(blocked('compiler_host_unavailable', 'The pinned compiler source or local runtime is unavailable. No network or finalization was attempted.')) + '\n');
  process.exitCode = 2;
}
