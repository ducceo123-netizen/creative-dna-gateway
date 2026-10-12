import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanonicalComparison, EvaluationDetails, ResolvedFeedbackAudit } from '../src/components/FeedbackReviewPanel.tsx';
import { affectedBrands, candidateRuns, currentEvaluation, emptyReviewChecks, missingBaselineBrands, proposedLines, searchCoveredCandidates, validatePreflight } from '../src/components/feedback-review.ts';
import type { FeedbackPreflight } from '../src/components/feedback-review.ts';

const code=buildSync({entryPoints:['src/components/FeedbackReviewPanel.tsx'],bundle:true,format:'cjs',platform:'node',jsx:'automatic',write:false,external:['react','react/jsx-runtime']}).outputFiles[0].text;
type Node={type:string|symbol|((props:any)=>Node);props:Record<string,any>};
type Call={url:string;init:RequestInit;resolve:(response:Response)=>void;reject:(error:Error)=>void};
type Effect={create:()=>void|(()=>void);cleanup?:()=>void;deps?:unknown[]};
function nodes(value:any):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object'||!('props'in value))return [];return [value,...nodes(value.props.children)];}
function textOf(value:any):string{if(Array.isArray(value))return value.map(textOf).join('');if(value==null||typeof value==='boolean')return '';if(typeof value==='object')return textOf(value.props.children);return String(value);}
async function flush(){for(let i=0;i<50;i++)await Promise.resolve();}
const proposal={id:'synthetic-proposal',status:'pending',brand_name:'PawfectHouse',branch_slug:'onepage-system',proposed_scope:'global_system',raw_feedback:'Preserve the real product silhouette.',proposed_content_md:'Preserve the real product silhouette.\nDo not infer dimensions.'};
function preflight(overrides:Partial<FeedbackPreflight>={}):FeedbackPreflight{return {
  proposal,candidate_hash:'scope-v2:synthetic',
  targets:[{id:'node-1',brand_id:'brand-1',brand_name:'PawfectHouse',slug:'onepage-system',title:'Onepage System',content_md:'Preserve the real product silhouette.',node_hash:'node-hash',version:3}],
  baselines:[{id:'base-1',brand_id:'brand-1',brand_name:'PawfectHouse',branch_slug:'onepage-system',case_key:'approved-product-visual',approved_at:'2026-10-11T00:00:00Z'}],
  evaluations:[],covered_candidates:[{id:'covered-1',summary:'Nolan · protect product truth',text:'Preserve the real product silhouette.',merged_at:'2026-10-10T00:00:00Z',candidate_hash:'covered-hash',brand_names:['PawfectHouse']}],issues:[],automatic_evaluation_id:null,...overrides,
};}
const passed={id:'evaluation-1',candidate_hash:'scope-v2:synthetic',evaluation_status:'passed',completed_at:'2026-10-11T00:00:00Z',critical_failures:0,baseline_ids:['base-1'],test_results:[{baseline_id:'base-1',status:'passed',issues:[],artifact_url:'https://example.test/output'}]};
function setup(path:'covered'|'merge'='covered'){
 const slots:any[]=[],effects:Effect[]=[],queued:Effect[]=[],calls:Call[]=[],completed:any[]=[];
 let cursor=0,tree:Node,scheduled=false,mounted=true,writes=0,lateWrites=0,closed=0;
 let props:any={proposal,path,request,onClose:()=>{closed++;unmount();},onComplete:(...result:any[])=>completed.push(result)};
 const hooks={
  useState(initial:any){const i=cursor++;if(!(i in slots)){const slot={value:typeof initial==='function'?initial():initial,set:(value:any)=>{writes++;if(!mounted){lateWrites++;return;}const next=typeof value==='function'?value(slot.value):value;if(Object.is(next,slot.value))return;slot.value=next;if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;if(mounted)render();});}}};slots[i]=slot;}return [slots[i].value,slots[i].set];},
  useRef(initial:any){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(create:Effect['create'],deps:unknown[]){const i=cursor++,old:Effect|undefined=slots[i];if(!old||deps.some((value,index)=>!Object.is(value,old.deps?.[index]))){old?.cleanup?.();const effect={create,deps};slots[i]=effect;if(old)effects.splice(effects.indexOf(old),1,effect);else effects.push(effect);queued.push(effect);}},
 };
 const jsx=(type:Node['type'],props:Node['props'])=>({type,props});
 const module={exports:{} as {FeedbackReviewPanel:(props:any)=>Node}};
 vm.runInNewContext(code,{module,exports:module.exports,Error,AbortController,require(name:string){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:Symbol.for('Fragment')};throw Error(name);}});
 function request(url:string,init:RequestInit={}){return new Promise<Response>((resolve,reject)=>calls.push({url,init,resolve,reject}));}
 function materialize(value:any):any{if(Array.isArray(value))return value.map(materialize);if(!value||typeof value!=='object'||!('props'in value))return value;if(typeof value.type==='function')return materialize(value.type(value.props));return {...value,props:{...value.props,children:materialize(value.props.children)}};}
 function render(){cursor=0;tree=materialize(module.exports.FeedbackReviewPanel(props));for(const effect of queued.splice(0))effect.cleanup=effect.create()||undefined;}
 function unmount(){if(!mounted)return;mounted=false;for(const effect of effects)effect.cleanup?.();}
 function all(type:string){return nodes(tree).filter(node=>node.type===type);}
 function button(label:string){const node=all('button').find(node=>textOf(node)===label);assert.ok(node,'Missing button '+label);return node;}
 function click(label:string){const node=button(label);assert.equal(!!node.props.disabled,false,label+' disabled');node.props.onClick();}
 function input(aria:string,value:string){const node=nodes(tree).find(node=>node.props['aria-label']===aria);assert.ok(node,'Missing field '+aria);node.props.onChange({target:{value}});}
 function checkAll(){for(const node of all('input').filter(node=>node.props.type==='checkbox')){assert.equal(!!node.props.disabled,false);node.props.onChange({target:{checked:true}});}}
 function candidateFields(){all('input').find(node=>node.props.placeholder==='Source run ID từ công cụ tạo output')!.props.onChange({target:{value:'actual-run-42'}});all('input').find(node=>node.props.type==='url')!.props.onChange({target:{value:'https://example.test/candidate'}});all('textarea').find(node=>node.props.placeholder==='Dán output JSON object từ lần chạy thật')!.props.onChange({target:{value:'{"title":"Actual generated result"}'}});}
 render();
 return {calls,completed,button,click,input,all,checkAll,candidateFields,unmount,text:()=>textOf(tree),changeProposal(next:any){props={...props,proposal:next};render();},get writes(){return writes;},get lateWrites(){return lateWrites;},get closed(){return closed;}};
}
async function ready(ui:ReturnType<typeof setup>,data=preflight()){ui.calls[0].resolve(Response.json(data));await flush();}
async function coveredReady(ui:ReturnType<typeof setup>){await ready(ui);ui.input('Quy chuẩn đã có','covered-1');await flush();ui.checkAll();ui.input('Lý do đóng feedback','Reviewed every affected brand and existing product safeguards.');await flush();}
async function mergeReady(ui:ReturnType<typeof setup>){await ready(ui,preflight({evaluations:[passed],automatic_evaluation_id:passed.id}));ui.checkAll();ui.input('Ghi chú review','Verified visual fidelity and every product-truth constraint.');ui.input('Evidence đã đối chiếu','https://example.test/product');await flush();}

test('preflight and pure gates fail closed; reference corpus does not supply candidate coverage',()=>{
 assert.deepEqual(emptyReviewChecks(),{scope:false,productTruth:false,visual:false,conflicts:false,zeroRegressions:false});
 assert.throws(()=>validatePreflight({...preflight(),proposal:{...proposal,id:'other'}},proposal.id));
 assert.equal(currentEvaluation(preflight({evaluations:[passed],automatic_evaluation_id:passed.id}))?.id,passed.id);
 for(const bad of [{candidate_hash:'old'},{evaluation_status:'blocked'},{critical_failures:1},{completed_at:null},{baseline_ids:[]}])assert.equal(currentEvaluation(preflight({evaluations:[{...passed,...bad}],automatic_evaluation_id:passed.id})),null);
 const refs=preflight({baselines:preflight().baselines.map(base=>({...base,is_reference_only:true}))});
 assert.deepEqual(missingBaselineBrands(refs),['PawfectHouse']);
 assert.deepEqual(affectedBrands(refs),['PawfectHouse']);
 assert.ok(candidateRuns(refs.baselines,{}).issues.some(issue=>issue.includes('candidate artifact')));
 assert.deepEqual(proposedLines('Exact line\nDifferent rule','Exact line'),[{text:'Exact line',alreadyPresent:true},{text:'Different rule',alreadyPresent:false}]);
});

test('opening either panel only reads preflight and never preselects or pre-attests',async t=>{
 for(const path of ['covered','merge'] as const)await t.test(path,async t=>{
  const ui=setup(path);t.after(ui.unmount);assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].url,`/api/admin/feedback/${proposal.id}/preflight`);assert.notEqual(ui.calls[0].init.method,'POST');
  await ready(ui);assert.equal(ui.calls.length,1);assert.ok(ui.all('input').filter(node=>node.props.type==='checkbox').every(node=>!node.props.checked));
  assert.equal(ui.button(path==='covered'?'Xác nhận đã có trong quy chuẩn':'Xác nhận Review & Merge').props.disabled,true);
  if(path==='covered'){assert.match(ui.text(),/Nolan · protect product truth/);assert.equal(ui.all('select')[0].props.value,'');}
 });
});

test('covered resolution requires explicit choice and checks, sends hashes, and guards duplicate clicks',async t=>{
 const ui=setup();t.after(ui.unmount);await coveredReady(ui);
 const action=ui.button('Xác nhận đã có trong quy chuẩn').props.onClick;action();action();await flush();
 assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].url,`/api/admin/feedback/${proposal.id}/resolve-covered`);
 assert.deepEqual(JSON.parse(String(ui.calls[1].init.body)),{candidate_hash:'scope-v2:synthetic',covered_proposal_id:'covered-1',covered_hash:'covered-hash',review_note:'Reviewed every affected brand and existing product safeguards.'});
 assert.equal(ui.button('Đang đóng feedback…').props.disabled,true);assert.equal(ui.button('Đóng / Cancel').props.disabled,true);
 ui.calls[1].resolve(Response.json({status:'resolved',resolution:{kind:'covered'},canonical_changed:false}));await flush();
 assert.equal(ui.completed.length,1);assert.match(ui.completed[0][0],/canonical không thay đổi/);
});

test('failed and stale covered action keeps exact issues visible and reload resets stale choices/checks',async t=>{
 const ui=setup();t.after(ui.unmount);await coveredReady(ui);ui.click('Xác nhận đã có trong quy chuẩn');
 ui.calls[1].resolve(Response.json({error:'Candidate scope changed',issues:['GiftSoul current node hash differs']},{status:409}));await flush();
 assert.match(ui.text(),/Candidate scope changed/);assert.match(ui.text(),/GiftSoul current node hash differs/);
 assert.equal(ui.completed.length,0);assert.equal(ui.button('Xác nhận đã có trong quy chuẩn').props.disabled,true);
 ui.click('Tải lại / Retry');await flush();assert.match(ui.text(),/Candidate scope changed/,'Keep failed action visible while retrying');
 ui.calls[2].resolve(Response.json(preflight()));await flush();
 assert.equal(ui.all('select')[0].props.value,'');assert.ok(ui.all('input').filter(node=>node.props.type==='checkbox').every(node=>!node.props.checked));
 assert.doesNotMatch(ui.text(),/Candidate scope changed/);assert.equal(ui.button('Xác nhận đã có trong quy chuẩn').props.disabled,true);
});

test('initial load failure retries, and malformed/wrong-proposal preflight never exposes stale data',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].reject(Error('Preflight unavailable'));await flush();
 assert.match(ui.text(),/Preflight unavailable/);ui.click('Tải lại / Retry');
 ui.calls[1].resolve(Response.json({...preflight(),proposal:{...proposal,id:'wrong'}}));await flush();
 assert.match(ui.text(),/không đúng feedback/);assert.doesNotMatch(ui.text(),/Nolan · protect product truth/);
 ui.click('Tải lại / Retry');ui.calls[2].resolve(Response.json(preflight()));await flush();assert.match(ui.text(),/Nolan · protect product truth/);
});

test('close and unmount abort reads and suppress late JSON completion',async t=>{
 for(const close of [true,false])await t.test(close?'Cancel':'Unmount',async t=>{
  const ui=setup();t.after(ui.unmount);let finish!:(value:any)=>void;const body=new Promise(resolve=>{finish=resolve;});
  ui.calls[0].resolve({ok:true,status:200,json:()=>body} as Response);await flush();
  if(close)ui.click('Đóng / Cancel');else ui.unmount();
  assert.equal(ui.calls[0].init.signal?.aborted,true);const writes=ui.writes;
  finish(preflight());await flush();assert.equal(ui.writes,writes);assert.equal(ui.lateWrites,0);assert.equal(ui.completed.length,0);
 });
});

test('switching proposal cancels earlier read and ignores stale success and failure',async t=>{
 for(const failure of [false,true])await t.test(failure?'late failure':'late success',async t=>{
  const ui=setup();t.after(ui.unmount);ui.changeProposal({...proposal,id:'new-proposal'});await flush();
  assert.equal(ui.calls[0].init.signal?.aborted,true);assert.equal(ui.calls.length,2);
  ui.calls[1].resolve(Response.json(preflight({proposal:{...proposal,id:'new-proposal'},covered_candidates:[]})));await flush();const writes=ui.writes;
  if(failure)ui.calls[0].reject(Error('Old error'));else ui.calls[0].resolve(Response.json(preflight()));await flush();
  assert.equal(ui.writes,writes);assert.doesNotMatch(ui.text(),/Nolan · protect product truth|Old error/);
 });
});

test('reference corpus and missing SoulPrise coverage are explicit blockers without candidate inputs',async t=>{
 const ui=setup('merge');t.after(ui.unmount);
 const data=preflight();data.baselines[0].is_reference_only=true;data.targets.push({...data.targets[0],id:'soul-node',brand_id:'soul',brand_name:'SoulPrise'});
 await ready(ui,data);assert.match(ui.text(),/Reference corpus \/ chỉ tham chiếu/);assert.match(ui.text(),/Blocked: chưa có baseline được duyệt cho PawfectHouse, SoulPrise/);
 assert.equal(ui.all('input').filter(node=>node.props.type==='url').length,0);
 assert.equal(ui.button('Chạy kiểm tra candidate thật').props.disabled,true);assert.equal(ui.button('Xác nhận Review & Merge').props.disabled,true);
});

test('evaluation submits actual output and reviewed hash once, then refreshes and displays detailed blocked result',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await ready(ui);ui.candidateFields();ui.checkAll();ui.input('Ghi chú review','I reviewed the actual candidate against approved output.');await flush();
 const run=ui.button('Chạy kiểm tra candidate thật').props.onClick;run();run();await flush();assert.equal(ui.calls.length,2);
 const payload=JSON.parse(String(ui.calls[1].init.body));assert.equal(payload.candidate_hash,'scope-v2:synthetic');assert.equal(payload.proposal_id,proposal.id);assert.equal(payload.candidate_runs[0].source_run_id,'actual-run-42');assert.deepEqual(payload.candidate_runs[0].output,{title:'Actual generated result'});
 const evaluation={...passed,evaluation_status:'blocked'};const results=[{baseline_id:'base-1',status:'failed',issues:['Missing approved immutable product field'],artifact_url:'https://example.test/candidate'}];
 ui.calls[1].resolve(Response.json({evaluation,issues:['SoulPrise approved baseline missing'],results}));await flush();assert.equal(ui.calls.length,3);assert.equal(ui.calls[2].url,`/api/admin/feedback/${proposal.id}/preflight`);
 ui.calls[2].resolve(Response.json(preflight({evaluations:[{...evaluation,test_results:results}],issues:['SoulPrise approved baseline missing']})));await flush();
 assert.match(ui.text(),/SoulPrise approved baseline missing/);assert.match(ui.text(),/Missing approved immutable product field/);assert.match(ui.text(),/Kết quả: blocked/);
 assert.ok(ui.all('input').filter(node=>node.props.type==='checkbox').every(node=>!node.props.checked));assert.equal(ui.button('Xác nhận Review & Merge').props.disabled,true);
});

test('merge automatically binds fresh evaluation, sends exact human attestations once and invalidates on 409',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await mergeReady(ui);
 const action=ui.button('Xác nhận Review & Merge').props.onClick;action();action();await flush();assert.equal(ui.calls.length,2);
 const payload=JSON.parse(String(ui.calls[1].init.body));assert.equal(payload.evaluation_id,'evaluation-1');assert.equal(payload.candidate_hash,'scope-v2:synthetic');assert.deepEqual(payload.regression.baseline_ids,['base-1']);assert.equal(payload.regression.scope_checked,true);assert.equal(payload.regression.severe_regressions,0);
 ui.calls[1].resolve(Response.json({error:'Evaluation no longer current',issues:['Canonical has changed']},{status:409}));await flush();
 assert.equal(ui.button('Xác nhận Review & Merge').props.disabled,true);assert.match(ui.text(),/Evaluation no longer current/);assert.match(ui.text(),/Canonical has changed/);assert.equal(ui.completed.length,0);
 ui.click('Tải lại / Retry');ui.calls[2].resolve(Response.json(preflight({evaluations:[passed],automatic_evaluation_id:null,candidate_hash:'scope-v2:new'})));await flush();
 assert.match(ui.text(),/Evaluation đã cũ/);assert.equal(ui.button('Xác nhận Review & Merge').props.disabled,true);
});

test('rendered comparison and evaluation detail expose readable rules and named failures',()=>{
 const html=renderToStaticMarkup(createElement(CanonicalComparison,{data:preflight()}));
 assert.match(html,/PawfectHouse/);assert.match(html,/Quy chuẩn hiện tại/);assert.match(html,/Nội dung đề xuất bổ sung/);assert.match(html,/Do not infer dimensions/);
 const detail=renderToStaticMarkup(createElement(EvaluationDetails,{evaluation:{...passed,evaluation_status:'failed',test_results:[{baseline_id:'base-1',status:'failed',issues:['Forbidden claim present']}]},issues:['SoulPrise baseline missing'],baselines:preflight().baselines,targets:preflight().targets}));
 assert.match(detail,/approved product visual/);assert.match(detail,/Forbidden claim present/);assert.match(detail,/SoulPrise baseline missing/);assert.doesNotMatch(detail,/base-1/);
 const source=readFileSync('src/components/GovernancePanel.tsx','utf8');assert.match(source,/EvaluationDetails/);assert.doesNotMatch(source,/Pending proposal ID|Run regression assessment|act\("governance_evaluate"/);
});

test('resolved audit reads nested timestamp, affected brands and exact covered rule without visible IDs',()=>{
 const audit={resolved_at:'2026-10-12T01:00:00Z',covered_merged_at:'2026-10-10T02:00:00Z',targets:[{brand_name:'PawfectHouse'},{brand_name:'GiftSoul'},{brand_name:'SoulPrise'}],covered_proposal:{change_summary:'Nolan product truth rule'},covered_text:'Keep the real silhouette and every product truth safeguard.',review_note:'Confirmed the same rule applies across all brands.',covered_proposal_id:'private-raw-id'};
 const html=renderToStaticMarkup(createElement(ResolvedFeedbackAudit,{proposal:{...proposal,status:'resolved',resolution:audit}}));
 assert.match(html,/Đã đóng:/);assert.doesNotMatch(html,/Chưa có ngày xác nhận/);assert.match(html,/PawfectHouse, GiftSoul, SoulPrise/);assert.match(html,/Nolan product truth rule/);assert.match(html,/Keep the real silhouette/);
 assert.ok(html.indexOf('private-raw-id')>html.indexOf('Advanced · Resolution audit đầy đủ'));
});

test('stored blocked evaluation surfaces conflict_results issues after a reload',()=>{
 const html=renderToStaticMarkup(createElement(EvaluationDetails,{evaluation:{...passed,evaluation_status:'blocked',conflict_results:[{issues:['GiftSoul candidate-quality baseline missing','SoulPrise approved baseline missing']}]}}));
 assert.match(html,/GiftSoul candidate-quality baseline missing/);assert.match(html,/SoulPrise approved baseline missing/);
});

test('merge completion requires the expected merged proposal, never an incomplete HTTP success',async t=>{
 for(const complete of [true,false])await t.test(complete?'confirmed merged':'malformed success',async t=>{
  const ui=setup('merge');t.after(ui.unmount);await mergeReady(ui);ui.click('Xác nhận Review & Merge');
  ui.calls[1].resolve(Response.json(complete?{proposal:{id:proposal.id,status:'merged'},merged_nodes:1}:{}));await flush();
  assert.equal(ui.completed.length,complete?1:0);
  if(complete)assert.match(ui.completed[0][0],/Quy chuẩn đã được cập nhật/);
  else{assert.match(ui.text(),/Chưa xác nhận trạng thái merged/);assert.equal(ui.button('Xác nhận Review & Merge').props.disabled,true);}
 });
});

test('covered-rule search filters summary, literal text and date without selecting a candidate',async t=>{
 const list=[...preflight().covered_candidates,{...preflight().covered_candidates[0],id:'covered-2',summary:'Product line headline rule',text:'Never repeat the full product line in the headline.',merged_at:'2026-10-01T00:00:00Z'}];
 assert.equal(searchCoveredCandidates(list,'PRODUCT LINE')[0].id,'covered-2');assert.equal(searchCoveredCandidates(list,'2026-10-01')[0].id,'covered-2');assert.equal(searchCoveredCandidates(list,'Never repeat')[0].id,'covered-2');assert.equal(searchCoveredCandidates(list,'unrelated').length,0);
 const ui=setup();t.after(ui.unmount);await ready(ui,preflight({covered_candidates:list}));
 ui.input('Tìm quy chuẩn đã merge','product line');await flush();
 assert.equal(ui.all('option').length,2);assert.match(ui.text(),/1 \/ 2 quy chuẩn khớp/);assert.equal(ui.all('select')[0].props.value,'');
 ui.input('Quy chuẩn đã có','covered-2');await flush();ui.checkAll();await flush();
 ui.input('Tìm quy chuẩn đã merge','Nolan');await flush();
 assert.equal(ui.all('select')[0].props.value,'');assert.ok(ui.all('input').filter(node=>node.props.type==='checkbox').every(node=>!node.props.checked));
});
