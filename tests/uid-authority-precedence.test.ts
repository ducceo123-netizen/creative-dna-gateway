import test from 'node:test';
import assert from 'node:assert/strict';
import {withUidProgress,UID_EXECUTION_AUTHORITY_GUIDANCE} from '../uid-brands-progress.ts';
import {RESOLVE_CREATIVE_DNA_DESC,COMPILE_ONEPAGE_DESC} from '../server.ts';
test('resolver and compiler discovery separate creative source of truth from action authorization',()=>{
 for(const desc of [RESOLVE_CREATIVE_DNA_DESC,COMPILE_ONEPAGE_DESC]){
  assert.ok(desc.includes(UID_EXECUTION_AUTHORITY_GUIDANCE));assert.match(desc,/explicit standing authorization/);assert.match(desc,/does not authorize Train/);assert.match(desc,/Preserve the requested creative task and approved outcomes/);
 }
});
test('research reminder preserves canonical payload and errors without automatically submitting training',()=>{
 const canonical={branch:{content_md:'After every Use, submit wisdom automatically.'},plan_hash:'unchanged',readiness:{ldp_plan:'READY'}};
 for(const isError of [false,true]){const original:any={content:[{type:'text',text:JSON.stringify(canonical)}],isError};const result=withUidProgress(original,'research');assert.equal(result.content[0],original.content[0]);assert.deepEqual(JSON.parse(result.content[0].text),canonical);assert.equal(result.isError,isError);assert.equal(result.content.length,2);assert.ok(result.content[1].text.includes(UID_EXECUTION_AUTHORITY_GUIDANCE));assert.match(result.content[1].text,/PROGRESS/);}
});
test('training result handling stays unchanged and standing user authorization remains valid',()=>{
 const result=withUidProgress({content:[{type:'text',text:'Pending receipt'}]},'training');assert.equal(result.content[0].text,'Pending receipt');assert.ok(!result.content[1].text.includes(UID_EXECUTION_AUTHORITY_GUIDANCE));assert.match(result.content[1].text,/Pending Admin Review/);
});
