import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const paths=['bun.lock','package.json','scripts/agent-review-compiler.bundle.mjs','scripts/compile-agent-review-plan.mjs','supabase/functions/_shared/agent-review-plan.ts','supabase/functions/_shared/creative-quality.ts','supabase/functions/_shared/owner-rule-plan.ts'].sort();

/** Exercise the historical SQL-pinned standalone release, not today's gateway
 * dependency manifest. The package fixture is byte-exact from commit 3f485fc.
 * All five executable/source files come from the current working checkout.
 * bun.lock comes only from HEAD's committed blob: dependency installation may
 * rewrite the working lock, which is not the released compiler input. All seven
 * bytes must match immutable SQL hashes; no pin or compiler guard is rewritten. */
export function withPinnedAgentCompilerRelease(manifest, run, {checkoutRoot=root}={}) {
  assert.ok(Array.isArray(manifest));
  assert.deepEqual(manifest.map(file=>file.path).sort(),paths);
  const verified=manifest.map(file=>{
    let bytes;
    if(file.path==='bun.lock'){
      const committed=spawnSync('git',['-C',checkoutRoot,'show','HEAD:bun.lock'],{maxBuffer:1024*1024,timeout:5000});
      assert.equal(committed.status,0,'Committed HEAD:bun.lock unavailable; no mutable-lock fallback is permitted');
      bytes=committed.stdout;
    }else{
      const input=file.path==='package.json'?'tests/fixtures/agent-compiler-package-v1.json':file.path;
      bytes=readFileSync(join(checkoutRoot,input));
    }
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,`Immutable compiler release drift: ${file.path}`);
    return {path:file.path,bytes};
  });
  const release=mkdtempSync(join(tmpdir(),'uid-pinned-agent-compiler-'));
  try {
    for(const file of verified){const target=join(release,file.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,file.bytes);}
    return run(release);
  } finally {rmSync(release,{recursive:true,force:true});}
}
