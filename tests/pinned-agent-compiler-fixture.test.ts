import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
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

test('historical compiler uses only the exact committed lock, never a generated working lock or another ref',()=>{
  const checkoutRoot=mkdtempSync(join(tmpdir(),'uid-compiler-checkout-'));
  const git=(...args:string[])=>{
    const result=spawnSync('git',['-C',checkoutRoot,...args],{encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  const commit=()=>git('-c','user.name=Synthetic fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Synthetic pinned compiler lock');
  try{
    for(const file of capability.source_manifest){
      const input=file.path==='package.json'?'tests/fixtures/agent-compiler-package-v1.json':file.path;
      const target=join(checkoutRoot,input);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(input));
    }
    git('init','-q');
    assert.throws(()=>withPinnedAgentCompilerRelease(capability.source_manifest,()=>assert.fail('must not execute'),{checkoutRoot}),/Committed HEAD:bun.lock unavailable/);
    // Use the trusted tracked release bytes, regardless of a prior local install.
    const released=spawnSync('git',['show','HEAD:bun.lock'],{timeout:5000,maxBuffer:1024*1024});
    assert.equal(released.status,0);writeFileSync(join(checkoutRoot,'bun.lock'),released.stdout);
    git('add','bun.lock');commit();
    writeFileSync(join(checkoutRoot,'bun.lock'),'Synthetic dependency-manager rewrite');
    withPinnedAgentCompilerRelease(capability.source_manifest,(release:string)=>{
      assert.deepEqual(readFileSync(join(release,'bun.lock')),released.stdout);
    },{checkoutRoot});
    const code='supabase/functions/_shared/creative-quality.ts';
    writeFileSync(join(checkoutRoot,code),'Synthetic changed executable');
    assert.throws(()=>withPinnedAgentCompilerRelease(capability.source_manifest,()=>assert.fail('must not execute'),{checkoutRoot}),/Immutable compiler release drift: supabase\/functions\/_shared\/creative-quality.ts/);
    writeFileSync(join(checkoutRoot,code),readFileSync(code));
    git('add','bun.lock');commit();
    writeFileSync(join(checkoutRoot,'bun.lock'),released.stdout);
    assert.throws(()=>withPinnedAgentCompilerRelease(capability.source_manifest,()=>assert.fail('must not execute'),{checkoutRoot}),/Immutable compiler release drift: bun.lock/);
  }finally{rmSync(checkoutRoot,{recursive:true,force:true});}
});
