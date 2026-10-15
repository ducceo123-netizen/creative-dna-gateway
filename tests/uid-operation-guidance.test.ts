import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationPromptGuide, withUidProgress } from '../uid-brands-progress.ts';
const response=(data:Record<string,unknown>={},isError=false)=>({content:[{type:'text' as const,text:JSON.stringify(data)}],isError});

test('research guidance follows actual blocking/readiness while preserving host review and QC',()=>{
 assert.match(operationPromptGuide('research',response({research_validation:{status:'AWAITING_RESEARCH'}})),/kiểm tra nguồn/);
 assert.match(operationPromptGuide('research',response({research_validation:{status:'READY'}})),/còn cần đối chiếu bằng chứng/);
 assert.match(operationPromptGuide('research',response({research_validation:{status:'READY'},readiness:{content_authoring:'BLOCKED'}})),/Chưa thể tạo content/);
 assert.match(operationPromptGuide('research',response({creative_quality_contract:{status:'BLOCKED'}})),/chưa tạo content khi chưa đạt/);
});
test('every operation provides a usable next prompt without interpreting reads as completed work',()=>{
 for(const op of ['research','training','routes','attachment','template'] as const){
  assert.match(operationPromptGuide(op,response()),/‘[^’]+’/);
  assert.match(operationPromptGuide(op,response({},true)),/‘[^’]+’/);
 }
 assert.match(operationPromptGuide('training',response({},true)),/đừng gửi lại nếu chưa rõ kết quả/);
 assert.match(operationPromptGuide('training',response()),/không coi là đã duyệt/);
 assert.match(operationPromptGuide('attachment',response()),/file ID.*đã nhìn thấy ảnh/);
 assert.match(operationPromptGuide('template',response()),/chưa phải kết quả đã tạo/);
});
test('operation guidance retains payload/error untouched and never dispatches a tool',()=>{
 const original=response({ok:false,error:{code:'WAIT_FOR_RECEIPT',retry:false}},true);
 const result=withUidProgress(original,'training');
 assert.equal(result.isError,true);assert.equal(result.content[0],original.content[0]);
 assert.equal(result.content.length,2);assert.equal(original.content.length,1);
 assert.match(result.content[1].text,/không.*gửi lại|đừng gửi lại/);
});
