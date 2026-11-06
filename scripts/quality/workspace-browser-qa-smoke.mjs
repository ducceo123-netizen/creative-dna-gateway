/** Local-only bundle checks; no browser/provider calls. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '/workspace/scratch/7fb7706bedc6/uid-browser-qa-bundle');
const dir = path.join(root, '.smoke-test');
await mkdir(dir, { recursive: true });
for (const name of ['server.cjs','ui','fixtures']) await symlink(path.join(root,name),path.join(dir,name)).catch(error=>{if(error.code!=='EEXIST')throw error;});
const origin='http://127.0.0.1:4319';
const server=spawn(process.execPath,['server.cjs'],{cwd:dir,env:{...process.env,PORT:'4319'},stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',chunk=>output+=chunk);server.stderr.on('data',chunk=>output+=chunk);
try {
  for(let i=0;i<60;i++) {try {const r=await fetch(origin+'/api/workspace/config');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const page=await fetch(origin+'/workspace?task=qa-preview-current');
  assert.equal(page.status,200);assert.match(await page.text(),/LOCAL QA SYNTHETIC ONLY/);
  const cookie=page.headers.get('set-cookie').split(';')[0];
  const request=async(route,body,method=body?'POST':'GET')=>{
    const response=await fetch(origin+'/api/workspace'+route,{method,headers:{Cookie:cookie,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {response,data:await response.json()};
  };
  const config=(await request('/config')).data;
  assert.equal(config.execution.ready,false);assert.equal(config.login_supported,false);assert.equal(config.storage.production_ready,false);
  const tasks=await request('/tasks');assert.equal(tasks.data.tasks.length,4);assert.equal(tasks.data.owner_id,'synthetic-qa-owner');
  assert.equal((await fetch(origin+'/api/workspace/tasks')).status,401);
  const record=(await request('/tasks/qa-preview-current')).data.task;
  const preview=await request('/tasks/qa-preview-current/preview');assert.equal(preview.response.status,200);
  assert.match(preview.data.html,/SYNTHETIC QA|Synthetic QA/);assert.equal(preview.data.manifest.task_id,'qa-preview-current');
  assert.ok(page.headers.get('content-security-policy').includes(`nonce-${preview.data.channel_nonce}`));
  const revisions=(await request('/tasks/qa-preview-current/revisions')).data;
  assert.equal(revisions.revisions.length,2);
  const old=await request('/tasks/qa-preview-current/revisions/qa-snapshot-before/preview');assert.equal(old.response.status,200);
  assert.notEqual(old.data.manifest.render_hash,preview.data.manifest.render_hash);
  assert.ok(page.headers.get('content-security-policy').includes(`nonce-${old.data.channel_nonce}`));
  const artifact=record.artifacts.find(file=>file.artifact_id==='qa-download-readme');
  const download=await fetch(origin+artifact.download_url,{headers:{Cookie:cookie}});assert.equal(download.status,200);
  const bytes=Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.length,artifact.size_bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
  assert.match(bytes.toString(),/LOCAL QA SYNTHETIC ONLY/);
  const recovery=(await request('/tasks/qa-recovery-unknown/recovery')).data;assert.equal(recovery.status,'unknown');assert.equal(recovery.can_reconcile,false);
  const key=randomUUID();
  const create=await request('/tasks',{idempotency_key:key,brief:{brand:'PawfectHouse',material:'onepage',source_url:'https://example.com/qa',title:'SYNTHETIC smoke draft'}});
  assert.equal(create.response.status,201);assert.equal(create.data.task.stage,'draft');
  const duplicate=await request('/tasks',{idempotency_key:key,brief:{brand:'PawfectHouse',material:'onepage',source_url:'https://example.com/qa',title:'SYNTHETIC smoke draft'}});
  assert.equal(duplicate.data.duplicate,true);
  const task=create.data.task;
  const action={type:'start',idempotency_key:randomUUID(),expected_state_version:task.state_version,content_revision:task.snapshot.content_revision};
  const disabled=await request(`/tasks/${task.task_id}/actions`,action);assert.equal(disabled.response.status,503);assert.equal(disabled.data.error.code,'EXECUTION_UNAVAILABLE');
  const stale=await request(`/tasks/${task.task_id}/actions`,{...action,expected_state_version:99});assert.equal(stale.response.status,409);assert.equal(stale.data.error.code,'STALE_ACTION');
  const unchanged=(await request(`/tasks/${task.task_id}`)).data.task;assert.equal(unchanged.actions.length,0);assert.equal(unchanged.state_version,0);
  const errors=await request('/tasks?cursor=wrong');assert.equal(errors.response.status,400);
  const event=(await request('/tasks/qa-preview-current/events?after=0')).data;assert.equal(event.events.length,1);assert.equal(event.events[0].type,'synthetic_fixture_seeded');
  console.log('PASS: actual UI/API bundle; owner session, no-AI config, canonical preview & CSP nonces, history, real checksum download, unknown recovery, draft idempotency, disabled execution, stale version, cursor validation, event replay.');
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve=>server.once('exit',resolve));
  await rm(dir,{recursive:true,force:true});
}
