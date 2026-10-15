import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreativeDna } from '../server.ts';
import { ldpFixture,approve } from './fixtures/ldp-v1.fixture.ts';
import { fingerprint } from '../uid-ldp-contract.ts';
test('existing resolver carries LDP initialization, validation and optional Figma descriptor without mutations/new tools',async()=>{
 const original=globalThis.fetch,f=ldpFixture(),requests:any[]=[];
 try{globalThis.fetch=async(url:any,init:any)=>{requests.push(JSON.parse(init.body));return Response.json(f.canonical);};
 const initial=await resolveCreativeDna('PawfectHouse','LDP',{source_url:f.context.source_url});assert.equal(initial.data.ldp_validation.status,'AUTO_RESEARCH_AND_PLAN_REQUIRED');assert.equal(initial.data.ldp_validation.pending_owner,'EXECUTING_HOST');assert.deepEqual(initial.data.ldp_workflow_contract.required_inputs,['collection_url']);assert.match(initial.data.ldp_workflow_contract.host_intake.discovery,/resolve current canonical LDP rules first/);assert.equal(initial.data.ldp_figma_contract.execution,'HOST_TOOL_EXECUTION_ONLY');assert.ok(initial.data.ldp_figma_contract.receipt_input_shape);assert.equal(initial.data.ldp_workflow_contract.canonical_snapshot,f.snapshot);
 approve(f.job);f.research.ldp_job=f.job;const result=await resolveCreativeDna('PawfectHouse','LDP',f.context);assert.equal(result.data.ldp_validation.status,'REQUIRES_HOST_EVIDENCE_AND_PLAN_REVIEW');assert.equal(result.data.ldp_validation.approval_matches,true);
 f.research.ldp_asset_outputs=f.job.assets.map(a=>({asset_id:a.id,content_version:f.job.content_version,file_url:`https://assets.example/${a.id}.png`,checksum:fingerprint(a.id),width:a.dimensions.width,height:a.dimensions.height,pixel_review:'passed',review_note:'Synthetic reviewed pixels'}));
 const planned=await resolveCreativeDna('PawfectHouse','LDP',f.context);assert.equal(planned.data.ldp_figma_adapter.status,'EXECUTION_PLAN_ONLY');assert.equal(planned.data.ldp_figma_adapter.actual_execution,false);
 assert.ok(requests.every(r=>r.action==='resolve'&&r.brand==='PawfectHouse'&&r.branch==='LDP'));assert.deepEqual(planned.data.branch,f.canonical.branch);
 }finally{globalThis.fetch=original;}
});
test('stale policy and malformed optional Figma output cannot produce plan',async()=>{const f=ldpFixture(),original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({...f.canonical,creative_quality_contract:{status:'BLOCKED'}});f.research.ldp_job=f.job;f.research.ldp_asset_outputs=[];const r=await resolveCreativeDna('PawfectHouse','LDP',f.context);assert.equal(r.data.ldp_figma_adapter.status,'BLOCKED');}finally{globalThis.fetch=original;}});
