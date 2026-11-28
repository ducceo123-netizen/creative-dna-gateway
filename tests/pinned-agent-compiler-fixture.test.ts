import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {withPinnedAgentCompilerRelease} from './fixtures/pinned-agent-compiler.fixture.mjs';

const sql=readFileSync('supabase/migrations/20261013044328_uid_agent_review_compiler_finalize.sql','utf8');
const capability=JSON.parse(sql.match(/select '(\{"schema_version":"uid.agent-compiler-capability.v1".*?\})'::jsonb/s)![1]);

test('SQL compiler fixture validates seven immutable files and runs exact standalone release without dependencies',()=>{
  let releasePath='';
  withPinnedAgentCompilerRelease(capability.source_manifest,(release:string)=>{
    releasePath=release;assert.equal(existsSync(release+'/node_modules'),false);
    const result=spawnSync(process.execPath,['scripts/compile-agent-review-plan.mjs','--print-manifest'],{cwd:release,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const actual=JSON.parse(result.stdout);
    assert.deepEqual(actual.source_manifest,capability.source_manifest);
    assert.equal(actual.compiler_bundle_hash,capability.compiler_bundle_hash);
  });
  assert.equal(existsSync(releasePath),false,'release is cleaned up after use');
});

test('SQL compiler fixture rejects manifest drift or unknown paths before executing code',()=>{
  for(const index of capability.source_manifest.keys()){
    const changed=structuredClone(capability.source_manifest);changed[index].sha256='0'.repeat(64);
    assert.throws(()=>withPinnedAgentCompilerRelease(changed,()=>assert.fail('must not execute')),/Immutable compiler release drift/);
  }
  const changed=structuredClone(capability.source_manifest);changed[0].path='../outside';
  assert.throws(()=>withPinnedAgentCompilerRelease(changed,()=>assert.fail('must not execute')));
});
