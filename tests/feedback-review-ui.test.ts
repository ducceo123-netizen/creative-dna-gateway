import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanonicalComparison, EvaluationDetails, ResolvedFeedbackAudit } from '../src/components/FeedbackReviewPanel.tsx';
import { affectedBrands, candidateRuns, currentEvaluation, emptyReviewChecks, missingBaselineBrands, proposedLines, searchCoveredCandidates, validatePreflight } from '../src/components/feedback-review.ts';
import type { AutomaticReview, FeedbackPreflight } from '../src/components/feedback-review.ts';

const code=buildSync({entryPoints:['src/components/FeedbackReviewPanel.tsx'],bundle:true,format:'cjs',platform:'node',jsx:'automatic',write:false,external:['react','react/jsx-runtime']}).outputFiles[0].text;
type Node={type:string|symbol|((props:any)=>Node);props:Record<string,any>};
type Call={url:string;init:RequestInit;resolve:(response:Response)=>void;reject:(error:Error)=>void};
type Effect={create:()=>void|(()=>void);cleanup?:()=>void;deps?:unknown[]};
function nodes(value:any):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object'||!('props'in value))return [];return [value,...nodes(value.props.children)];}
function textOf(value:any):string{if(Array.isArray(value))return value.map(textOf).join('');if(value==null||typeof value==='boolean')return '';if(typeof value==='object')return textOf(value.props.children);return String(value);}
async function flush(){for(let i=0;i<50;i++)await Promise.resolve();}
const proposal={id:'synthetic-proposal',status:'pending',brand_name:'PawfectHouse',branch_slug:'onepage-system',proposed_scope:'global_system',raw_feedback:'Preserve the real product silhouette.',proposed_content_md:'Preserve the real product silhouette.\nDo not infer dimensions.'};
function automaticReview(overrides:Partial<AutomaticReview>={}):AutomaticReview {return {
 status:'needs_candidate',candidate_hash:'scope-v2:synthetic',evaluation_id:null,
 checks:{mechanical:'blocked',actual_review:'required'},
 blockers:[{code:'missing_candidate',message:'Chưa có candidate thật.',next_action:'Trình tạo kết quả cần lưu candidate.'}],
 evidence:[],candidate_runs:[],mechanical_results:[],mechanical_issues:[],
 host_review:{available:false,packet_version:'uid.review-packet.v1',instruction:'Inspect real sources and pixels.',required_capabilities:['actual_media_inspection'],packet:{}},...overrides,
};}
function preflight(overrides:Partial<FeedbackPreflight>={}):FeedbackPreflight{return {
  proposal,candidate_hash:'scope-v2:synthetic',review_intent_hash:'intent:synthetic',review_request:null,
  targets:[{id:'node-1',brand_id:'brand-1',brand_name:'PawfectHouse',slug:'onepage-system',title:'Onepage System',content_md:'Preserve the real product silhouette.',node_hash:'node-hash',version:3}],
  baselines:[{id:'base-1',brand_id:'brand-1',brand_name:'PawfectHouse',branch_slug:'onepage-system',case_key:'approved-product-visual',approved_at:'2026-10-11T00:00:00Z'}],
  automatic_review:automaticReview({candidate_hash:overrides.candidate_hash||'scope-v2:synthetic'}),evaluations:[],covered_candidates:[{id:'covered-1',summary:'Nolan · protect product truth',text:'Preserve the real product silhouette.',merged_at:'2026-10-10T00:00:00Z',candidate_hash:'covered-hash',brand_names:['PawfectHouse']}],issues:[],automatic_evaluation_id:null,...overrides,
};}
function directPreflight(overrides:Partial<FeedbackPreflight>={}):FeedbackPreflight {
 const data=preflight(overrides);
 return {...data,direct_rule:{schema_version:'uid.owner-rule-eligibility.v1',eligible:true,owner_authorized:true,
  rule_hash:'owner-rule-v1:synthetic',rule_class:'STRUCTURAL',blockers:[],
  check_scope:'STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY',visual_qc_performed:false},
  direct_rule_plan:{eligible:true,plan_hash:'plan-sha256:synthetic',blockers:[],visual_qc_performed:false,
   semantic_consistency:'NOT_PROVEN_BY_DETERMINISTIC_CHECKS',additions:data.targets.map(target=>({
    schema_version:'uid.owner-supplemental-rule.v1',id:`owner:${data.proposal.id}`,proposal_id:data.proposal.id,
    decision_kind:'owner_direct_rule',canonical_text:data.proposal.proposed_content_md!,declared_scope:data.proposal.proposed_scope!,
    scope:{brands:[target.brand_name.toLowerCase()],branches:[target.slug]},rule_class:'STRUCTURAL',confidence:'HIGH',
    precedence:'SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH',
    semantic_consistency:'NOT_PROVEN_BY_DETERMINISTIC_CHECKS',visual_qc_performed:false,
    source:{node:'branch',locator:`owner-rule:${data.proposal.id}`,canonical_text_hash:'canonical-sha256:synthetic'},
    accepted_source_hashes:{branch:target.node_hash,brand_dna:'brand-dna-sha256:synthetic'},
    target_node_ids:[target.id],affected_brands:[target.brand_name.toLowerCase()],
   }))},...overrides};
}
function directReceipt(data=directPreflight()) {return {
 status:'merged',proposal_id:data.proposal.id,proposal:{id:data.proposal.id,status:'merged',merged_at:'2026-10-13T04:00:00Z'},
 merged_at:'2026-10-13T04:00:00Z',decision_kind:'owner_direct_rule',visual_qc_performed:false,
 rule_decision_id:'synthetic-owner-decision',candidate_hash:data.candidate_hash,rule_hash:data.direct_rule!.rule_hash,
 plan_hash:data.direct_rule_plan!.plan_hash,canonical_changed:true,
};}
const passed={id:'evaluation-1',candidate_hash:'scope-v2:synthetic',evaluation_status:'passed',completed_at:'2026-10-11T00:00:00Z',critical_failures:0,baseline_ids:['base-1'],test_results:[{baseline_id:'base-1',status:'passed',issues:[],artifact_url:'https://example.test/output'}]};
function setup(path:'covered'|'merge'='covered'){
 const slots:any[]=[],effects:Effect[]=[],queued:Effect[]=[],calls:Call[]=[],completed:any[]=[],busyEvents:boolean[]=[];
 let cursor=0,tree:Node,scheduled=false,mounted=true,writes=0,lateWrites=0,closed=0;
 let props:any={proposal,path,request,onBusyChange:(busy:boolean)=>busyEvents.push(busy),onClose:()=>{closed++;unmount();},onComplete:(...result:any[])=>completed.push(result)};
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
 return {calls,completed,busyEvents,button,click,input,all,checkAll,candidateFields,unmount,text:()=>textOf(tree),changeProposal(next:any){props={...props,proposal:next};render();},get writes(){return writes;},get lateWrites(){return lateWrites;},get closed(){return closed;}};
}
async function ready(ui:ReturnType<typeof setup>,data=preflight()){ui.calls[0].resolve(Response.json(data));await flush();}
async function coveredReady(ui:ReturnType<typeof setup>){await ready(ui);ui.input('Quy chuẩn đã có','covered-1');await flush();ui.checkAll();ui.input('Lý do đóng feedback','Reviewed every affected brand and existing product safeguards.');await flush();}
async function mergeReady(ui:ReturnType<typeof setup>){await ready(ui,preflight({evaluations:[passed],automatic_evaluation_id:passed.id,automatic_review:automaticReview({status:'ready_to_merge',evaluation_id:passed.id,checks:{mechanical:'passed',actual_review:'verified'},blockers:[]})}));}

const actionLabel=(ui:ReturnType<typeof setup>)=>ui.text().includes('Đủ điều kiện merge sau khi bạn duyệt.')?'Merge outcome đã review':'Duyệt & giao dot review';

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
  assert.equal(ui.button(path==='covered'?'Xác nhận đã có trong quy chuẩn':'Duyệt & giao dot review').props.disabled,path==='covered');
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

test('reference-only and missing coverage show one server-derived blocker with no manual form',async t=>{
 const ui=setup('merge');t.after(ui.unmount);
 const data=preflight();data.baselines[0].is_reference_only=true;data.targets.push({...data.targets[0],id:'soul-node',brand_id:'soul',brand_name:'SoulPrise'});
 data.automatic_review=automaticReview({status:'needs_baseline',blockers:[{code:'missing_baseline',message:'Chưa có baseline chất lượng cho PawfectHouse, SoulPrise.',next_action:'Cần mẫu đã được duyệt; reference-only không đủ.'}]});
 await ready(ui,data);assert.match(ui.text(),/Chưa có baseline chất lượng cho PawfectHouse, SoulPrise/);
 assert.equal(ui.all('input').length,0);assert.equal(ui.all('textarea').length,0);assert.equal(ui.button(actionLabel(ui)).props.disabled,false);
});

const queueRequest=(status='queued')=>({id:'request-1',proposal_id:proposal.id,status,created_at:'2026-10-13T01:00:00Z',updated_at:'2026-10-13T01:00:00Z',expires_at:'2026-10-14T01:00:00Z',blockers:[],outcome:null});
test('one processing intent persists a queue request without manual inputs or immediate execution claims',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await ready(ui);
 const action=ui.button(actionLabel(ui)).props.onClick;action();action();await flush();assert.equal(ui.calls.length,2);
 assert.equal(ui.calls[1].url,`/api/admin/feedback/${proposal.id}/process`);
 assert.deepEqual(JSON.parse(String(ui.calls[1].init.body)),{approve:true,review_intent_hash:'intent:synthetic'});
 assert.equal(ui.button('Đang tự kiểm tra…').props.disabled,true);assert.equal(ui.button('Đóng / Cancel').props.disabled,true);
 ui.calls[1].resolve(Response.json({status:'queued',review_request:queueRequest(),canonical_changed:false,background_task_started:false,approval_recorded:true}));await flush();
 assert.match(ui.text(),/Đã lưu duyệt · Chờ dot review/);assert.match(ui.text(),/không khởi chạy review tức thì/);assert.equal(ui.completed.length,0);
 assert.equal(ui.button(actionLabel(ui)).props.disabled,true);assert.equal(ui.all('textarea').length,0);assert.equal(ui.calls.length,2);
 ui.click('Hủy yêu cầu');await flush();assert.equal(ui.calls[2].url,`/api/admin/feedback/${proposal.id}/cancel-review`);
 assert.deepEqual(JSON.parse(String(ui.calls[2].init.body)),{request_id:'request-1'});
 ui.calls[2].resolve(Response.json({review_request:queueRequest('cancelled'),canonical_changed:false}));await flush();
 assert.match(ui.text(),/Đã hủy yêu cầu/);assert.equal(ui.button(actionLabel(ui)).props.disabled,false);
});

test('saved queue survives reopening and blocked requests do not require reapproval on the same intent',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await ready(ui,preflight({review_request:{...queueRequest('blocked'),status:'blocked',blockers:[{message:'Cần baseline thật.'}]}}));
 assert.match(ui.text(),/Đang chờ phần còn thiếu/);assert.match(ui.text(),/Cần baseline thật/);assert.equal(ui.button(actionLabel(ui)).props.disabled,true);
 ui.click('Tải lại / Retry');ui.calls[1].resolve(Response.json(preflight({review_request:{...queueRequest('leased'),status:'leased'}})));await flush();
 assert.match(ui.text(),/dot đang review/);assert.equal(ui.button(actionLabel(ui)).props.disabled,true);assert.equal(ui.calls.length,2);
});

test('approval uses the displayed hash once and stale rejection requires refreshed review',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await mergeReady(ui);
 const action=ui.button(actionLabel(ui)).props.onClick;action();action();await flush();assert.equal(ui.calls.length,2);
 assert.deepEqual(JSON.parse(String(ui.calls[1].init.body)),{approve:true,review_intent_hash:'intent:synthetic'});
 ui.calls[1].resolve(Response.json({error:'Evaluation no longer current',issues:['Canonical has changed']},{status:409}));await flush();
 assert.equal(ui.button(actionLabel(ui)).props.disabled,true);assert.match(ui.text(),/Evaluation no longer current/);assert.match(ui.text(),/Canonical has changed/);assert.equal(ui.completed.length,0);
 ui.click('Tải lại / Retry');ui.calls[2].resolve(Response.json(preflight({candidate_hash:'scope-v2:new',review_intent_hash:'intent:new'})));await flush();
 ui.click(actionLabel(ui));await flush();assert.equal(JSON.parse(String(ui.calls[3].init.body)).review_intent_hash,'intent:new');
});

test('old server and malformed preparation fail closed without reviving a legacy checklist',async t=>{
 for(const automatic_review of [undefined,{candidate_hash:'wrong'}]) await t.test(automatic_review?'malformed':'old server',async t=>{
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,preflight({automatic_review:automatic_review as AutomaticReview}));
  if(automatic_review)assert.match(ui.text(),/không đầy đủ hoặc đã cũ/);else assert.equal(ui.button(actionLabel(ui)).props.disabled,true);
  assert.equal(ui.all('textarea').length,0);assert.equal(ui.calls.length,1);
 });
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
  const ui=setup('merge');t.after(ui.unmount);await mergeReady(ui);ui.click(actionLabel(ui));
  ui.calls[1].resolve(Response.json(complete?{status:'merged',proposal:{id:proposal.id,status:'merged'},merged_nodes:1,canonical_changed:true}:{status:'merged'}));await flush();
  assert.equal(ui.completed.length,complete?1:0);
  if(complete)assert.match(ui.completed[0][0],/Quy chuẩn đã được cập nhật/);
  else{assert.match(ui.text(),/Chưa xác nhận trạng thái merged/);assert.equal(ui.button(actionLabel(ui)).props.disabled,true);}
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

test('direct-rule preview shows exact guidance and scope without manual forms or fabricated QC claims',async t=>{
 const ui=setup('merge');t.after(ui.unmount);const data=directPreflight();await ready(ui,data);
 assert.equal(ui.calls.length,1);assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,false);
 assert.equal(ui.button('Duyệt & giao dot review').props.disabled,false);
 assert.match(ui.text(),/Hướng dẫn bổ sung do bạn duyệt/);assert.match(ui.text(),/Phạm vi đầy đủ: PawfectHouse/);
 assert.match(ui.text(),/không chứng nhận outcome hay QC hình ảnh/);assert.match(ui.text(),/không bảo đảm phát hiện mọi xung đột ngữ nghĩa/);
 assert.ok(ui.text().includes(data.proposal.proposed_content_md!));
 assert.equal(ui.all('input').length,0);assert.equal(ui.all('textarea').length,0);assert.equal(ui.all('select').length,0);
 assert.equal(ui.completed.length,0);
});

test('direct-rule approval sends only explicit intent and displayed hashes once, then accepts the normalized real receipt',async t=>{
 const ui=setup('merge');t.after(ui.unmount);const data=directPreflight();await ready(ui,data);
 const action=ui.button('Duyệt rule & merge ngay').props.onClick;action();action();await flush();
 assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].url,`/api/admin/feedback/${proposal.id}/accept-rule`);
 assert.deepEqual(JSON.parse(String(ui.calls[1].init.body)),{approve_rule:true,candidate_hash:data.candidate_hash,rule_hash:data.direct_rule!.rule_hash,plan_hash:data.direct_rule_plan!.plan_hash});
 assert.equal(ui.button('Đang merge rule…').props.disabled,true);assert.equal(ui.button('Đóng / Cancel').props.disabled,true);
 assert.equal(ui.button('Duyệt & giao dot review').props.disabled,true);
 ui.calls[1].resolve(Response.json(directReceipt(data)));await flush();
 assert.equal(ui.completed.length,1);assert.match(ui.completed[0][0],/Đã merge rule do bạn duyệt trực tiếp/);
 assert.match(ui.completed[0][0],/không phải kết quả QC hình ảnh/);
 assert.equal(ui.completed[0][1].decision_kind,'owner_direct_rule');assert.equal(ui.completed[0][1].visual_qc_performed,false);
});

test('direct-rule owner or configuration blockers keep approval disabled without requiring evidence forms',async t=>{
 for(const owner_authorized of [false,true])await t.test(owner_authorized?'configuration disabled':'not owner',async t=>{
  const ui=setup('merge');t.after(ui.unmount);const data=directPreflight();
  data.direct_rule={...data.direct_rule!,eligible:false,owner_authorized,blockers:[{code:'owner_denial',message:'Chưa được phép duyệt rule.',next_action:'Kiểm tra owner và cấu hình.'}]};
  await ready(ui,data);assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,true);
  assert.match(ui.text(),/Chưa được phép duyệt rule/);assert.equal(ui.all('input').length,0);assert.equal(ui.all('textarea').length,0);
  assert.equal(ui.calls.length,1);assert.equal(ui.completed.length,0);
 });
});

test('direct-rule stale response requires reload and reapproval of fresh candidate, rule and plan hashes',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await ready(ui,directPreflight());ui.click('Duyệt rule & merge ngay');
 ui.calls[1].resolve(Response.json({error:'Effective rule plan changed',issues:['Affected canonical version is newer']},{status:409}));await flush();
 assert.equal(ui.completed.length,0);assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,true);
 assert.match(ui.text(),/Effective rule plan changed/);assert.match(ui.text(),/Affected canonical version is newer/);
 ui.click('Tải lại / Retry');const newer=directPreflight({candidate_hash:'scope-v2:new'});
 newer.direct_rule!.rule_hash='owner-rule-v1:new';newer.direct_rule_plan!.plan_hash='plan-sha256:new';
 ui.calls[2].resolve(Response.json(newer));await flush();ui.click('Duyệt rule & merge ngay');await flush();
 assert.deepEqual(JSON.parse(String(ui.calls[3].init.body)),{approve_rule:true,candidate_hash:'scope-v2:new',rule_hash:'owner-rule-v1:new',plan_hash:'plan-sha256:new'});
 assert.equal(ui.completed.length,0);
});

test('direct-rule display fails closed for missing, malformed, wrong-text or incomplete-scope plans',async t=>{
 const missing=directPreflight();delete missing.direct_rule_plan;
 const noHash=directPreflight();noHash.direct_rule_plan!.plan_hash=null;
 const wrongText=directPreflight();wrongText.direct_rule_plan!.additions[0].canonical_text='An unrelated proposed rule.';
 const wrongScope=directPreflight();wrongScope.direct_rule_plan!.additions[0].declared_scope='different scope';
 const incomplete=directPreflight();incomplete.targets.push({...incomplete.targets[0],id:'node-2',brand_id:'brand-2',brand_name:'GiftSoul'});
 const fakeQc=directPreflight();(fakeQc.direct_rule_plan as any).visual_qc_performed=true;
 for(const data of [missing,noHash,wrongText,wrongScope,incomplete,fakeQc]) {
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,data);
  assert.equal(ui.calls.length,1);assert.equal(ui.completed.length,0);
  assert.match(ui.text(),/Hãy tải lại/);
  assert.equal(ui.all('button').some(button=>textOf(button)==='Duyệt rule & merge ngay'&&!button.props.disabled),false);
  assert.equal(ui.all('input').length,0);assert.equal(ui.all('textarea').length,0);
 }
});

test('direct-rule malformed HTTP success never completes or allows blind duplicate submission',async t=>{
 const valid=directReceipt();
 for(const response of [
  {status:'merged'}, {...valid,proposal:undefined}, {...valid,proposal:{...valid.proposal,id:'another-proposal'}},
  {...valid,canonical_changed:false}, {...valid,decision_kind:'owner_rule_accept'}, {...valid,visual_qc_performed:true},
  {...valid,rule_decision_id:undefined}, {...valid,candidate_hash:'another-candidate'}, {...valid,rule_hash:'another-rule'},
  {...valid,plan_hash:'another-plan'},
  {...valid,proposal:{...valid.proposal,merged_at:undefined}},
  {...valid,proposal:{...valid.proposal,merged_at:'not-a-date'}},
 ]) {
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,directPreflight());ui.click('Duyệt rule & merge ngay');
  ui.calls[1].resolve(Response.json(response));await flush();
  assert.equal(ui.completed.length,0,JSON.stringify(response));assert.equal(ui.calls.length,2);
  assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,true);assert.match(ui.text(),/Chưa xác nhận/);
 }
});

test('late direct-rule success after unmount or proposal navigation is ignored',async t=>{
 for(const navigate of [false,true])await t.test(navigate?'new proposal':'unmounted',async t=>{
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,directPreflight());ui.click('Duyệt rule & merge ngay');
  if(navigate){ui.changeProposal({...proposal,id:'new-proposal'});await flush();}else ui.unmount();
  const writes=ui.writes;ui.calls[1].resolve(Response.json(directReceipt()));await flush();
  assert.equal(ui.completed.length,0);assert.equal(ui.writes,writes);assert.equal(ui.lateWrites,0);
 });
});

function canonicalAppendPreflight():FeedbackPreflight {
 const data=directPreflight();
 data.proposal={...data.proposal,branch_slug:'ldp-system'};
 data.targets=data.targets.map(target=>({...target,slug:'ldp-system',title:'Landing page system'}));
 data.direct_rule_plan={...data.direct_rule_plan!,plan_kind:'canonical_append',compiler_version:null,compiled:[],
  additions:data.direct_rule_plan!.additions.map(addition=>{
   const {accepted_source_hashes:_,...plain}=addition;
   return {...plain,schema_version:'uid.owner-canonical-append.v1',scope:{...plain.scope,branches:['ldp-system']}};
  })};
 return data;
}

test('canonical append preview stays literal and owner-approved without a compiled-quality claim',async t=>{
 const ui=setup('merge');t.after(ui.unmount);const data=canonicalAppendPreflight();await ready(ui,data);
 assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,false);
 assert.match(ui.text(),/Rule thêm nguyên văn vào nhánh đã chọn/);
 assert.match(ui.text(),/Phạm vi đầy đủ: PawfectHouse/);
 assert.doesNotMatch(ui.text(),/GiftSoul|SoulPrise/);
 assert.match(ui.text(),/không tạo quality catalog/);
 assert.match(ui.text(),/không gắn nhãn đã biên dịch chất lượng hay QC hình ảnh/);
 assert.equal(ui.all('input').length,0);assert.equal(ui.all('textarea').length,0);
 ui.click('Duyệt rule & merge ngay');await flush();
 assert.deepEqual(JSON.parse(String(ui.calls[1].init.body)),{approve_rule:true,candidate_hash:data.candidate_hash,rule_hash:data.direct_rule!.rule_hash,plan_hash:data.direct_rule_plan!.plan_hash});
 ui.calls[1].resolve(Response.json(directReceipt(data)));await flush();
 assert.equal(ui.completed.length,1);assert.match(ui.completed[0][0],/không phải kết quả QC hình ảnh/);
});

test('canonical append display rejects invented compilation, catalog source hashes and Onepage fallback',async t=>{
 const compiled=canonicalAppendPreflight();compiled.direct_rule_plan!.compiled=[{status:'COMPILED'}];
 const compiler=canonicalAppendPreflight();compiler.direct_rule_plan!.compiler_version='pretend-quality-compiler';
 const hashes=canonicalAppendPreflight();hashes.direct_rule_plan!.additions[0].accepted_source_hashes={branch:'invented',brand_dna:'invented'};
 const onepage=canonicalAppendPreflight();onepage.targets[0].slug='onepage-system';
 const wrongSchema=canonicalAppendPreflight();wrongSchema.direct_rule_plan!.additions[0].schema_version='uid.owner-supplemental-rule.v1';
 for(const data of [compiled,compiler,hashes,onepage,wrongSchema]){
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,data);
  assert.match(ui.text(),/Hãy tải lại/);
  assert.equal(ui.all('button').some(button=>textOf(button)==='Duyệt rule & merge ngay'&&!button.props.disabled),false);
  assert.equal(ui.completed.length,0);assert.equal(ui.calls.length,1);
 }
});
test('queue approval and direct-rule approval remain distinct in the same owner panel',async t=>{
 const ui=setup('merge');t.after(ui.unmount);const data=directPreflight();await ready(ui,data);
 ui.click('Duyệt & giao dot review');await flush();
 assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,true);
 assert.deepEqual(JSON.parse(String(ui.calls[1].init.body)),{approve:true,review_intent_hash:data.review_intent_hash});
 ui.calls[1].resolve(Response.json({status:'queued',review_request:queueRequest(),canonical_changed:false,approval_recorded:true,background_task_started:false}));await flush();
 assert.equal(ui.button('Duyệt & giao dot review').props.disabled,true);
 assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,false);
 assert.match(ui.text(),/Lịch kiểm tra mỗi giờ áp dụng cho tài khoản đã bật xử lý/);
 assert.equal(ui.completed.length,0);assert.equal(ui.all('textarea').length,0);
 ui.click('Duyệt rule & merge ngay');await flush();
 assert.equal(ui.button('Hủy yêu cầu').props.disabled,true);
 assert.equal(ui.calls[2].url,`/api/admin/feedback/${proposal.id}/accept-rule`);
 assert.deepEqual(JSON.parse(String(ui.calls[2].init.body)),{approve_rule:true,candidate_hash:data.candidate_hash,rule_hash:data.direct_rule!.rule_hash,plan_hash:data.direct_rule_plan!.plan_hash});
 ui.calls[2].resolve(Response.json(directReceipt(data)));await flush();
 assert.equal(ui.completed.length,1);assert.equal(ui.completed[0][1].decision_kind,'owner_direct_rule');
});

test('queue outcome action never accepts a direct owner-rule receipt as genuine outcome QC',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await ready(ui,directPreflight());ui.click('Duyệt & giao dot review');
 ui.calls[1].resolve(Response.json(directReceipt()));await flush();
 assert.equal(ui.completed.length,0);assert.match(ui.text(),/không phải kết quả review outcome/);
 assert.equal(ui.button('Duyệt & giao dot review').props.disabled,true);
 assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,true);
});

test('saved queue can be cancelled even after target or proposal eligibility changes',async t=>{
 const ui=setup('merge');t.after(ui.unmount);
 await ready(ui,preflight({targets:[],proposal:{...proposal,status:'rejected'},review_request:{...queueRequest('blocked'),status:'blocked'}}));
 assert.equal(ui.button('Duyệt & giao dot review').props.disabled,true);
 assert.equal(ui.button('Hủy yêu cầu').props.disabled,false);
 const cancel=ui.button('Hủy yêu cầu').props.onClick;cancel();cancel();await flush();
 assert.equal(ui.calls.length,2);assert.deepEqual(JSON.parse(String(ui.calls[1].init.body)),{request_id:'request-1'});
 ui.calls[1].resolve(Response.json({review_request:queueRequest('cancelled'),canonical_changed:false}));await flush();
 assert.match(ui.text(),/Đã hủy yêu cầu/);assert.equal(ui.completed.length,0);
 assert.equal(ui.button('Duyệt & giao dot review').props.disabled,true);
});

test('malformed or wrong queue receipts fail closed and do not invite duplicate approval',async t=>{
 const valid={status:'queued',review_request:queueRequest(),canonical_changed:false,approval_recorded:true};
 for(const result of [
  {},{...valid,review_request:null},{...valid,approval_recorded:false},{...valid,canonical_changed:true},
  {...valid,status:'blocked'}, {...valid,review_request:{...queueRequest(),proposal_id:'another-proposal'}},
  {...valid,review_request:{...queueRequest(),id:''}}, {...valid,review_request:{...queueRequest(),expires_at:'not-a-date'}},
  {...valid,review_request:{...queueRequest(),blockers:[null]}}, {...valid,review_request:{...queueRequest(),blockers:{message:'invalid'}}},
  {...valid,review_request:queueRequest('merged')},
 ]) {
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,directPreflight());ui.click('Duyệt & giao dot review');
  ui.calls[1].resolve(Response.json(result));await flush();
  assert.equal(ui.calls.length,2);assert.equal(ui.completed.length,0);
  assert.equal(ui.button('Duyệt & giao dot review').props.disabled,true);
  assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,true);
  assert.match(ui.text(),/Hãy tải lại|Tải lại để kiểm tra/);
 }
});

test('cancel only acknowledges the selected saved request and handles uncertain results by reload',async t=>{
 for(const result of [
  {review_request:{...queueRequest('cancelled'),id:'different-request'},canonical_changed:false},
  {review_request:queueRequest('queued'),canonical_changed:false},
  {review_request:queueRequest('cancelled'),canonical_changed:true},
 ]) {
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,preflight({review_request:{...queueRequest(),status:'queued'}}));
  ui.click('Hủy yêu cầu');ui.calls[1].resolve(Response.json(result));await flush();
  assert.equal(ui.completed.length,0);assert.match(ui.text(),/Chưa xác nhận trạng thái hàng đợi/);
  assert.equal(ui.button('Hủy yêu cầu').props.disabled,true);assert.equal(ui.button('Duyệt & giao dot review').props.disabled,true);
  ui.click('Tải lại / Retry');ui.calls[2].resolve(Response.json(preflight({review_request:{...queueRequest('cancelled'),status:'cancelled'}})));await flush();
  assert.match(ui.text(),/Đã hủy yêu cầu/);assert.equal(ui.button('Duyệt & giao dot review').props.disabled,false);
 }
});

test('queue preflight validates saved statuses and intent without adding manual reapproval forms',async t=>{
 for(const review_intent_hash of [undefined,'','   ',7]) {
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,preflight({review_intent_hash:review_intent_hash as string}));
  assert.equal(ui.all('button').some(button=>textOf(button)==='Duyệt & giao dot review'&&!button.props.disabled),false);
  assert.equal(ui.all('input').length,0);assert.equal(ui.all('textarea').length,0);assert.equal(ui.calls.length,1);
 }
 for(const status of ['cancelled','expired','superseded'] as const) {
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,preflight({review_request:{...queueRequest(status),status}}));
  assert.equal(ui.button('Duyệt & giao dot review').props.disabled,false);
  assert.equal(ui.all('button').some(button=>textOf(button)==='Hủy yêu cầu'),false);
  assert.equal(ui.all('input').length,0);assert.equal(ui.all('textarea').length,0);assert.equal(ui.calls.length,1);
 }
});

test('queue save and cancellation ignore late results after close or newer proposal navigation',async t=>{
 for(const action of ['process','cancel'] as const)for(const navigate of [false,true])await t.test(`${action}: ${navigate?'new proposal':'unmount'}`,async t=>{
  const ui=setup('merge');t.after(ui.unmount);await ready(ui,preflight(action==='cancel'?{review_request:{...queueRequest(),status:'queued'}}:{}));
  ui.click(action==='cancel'?'Hủy yêu cầu':'Duyệt & giao dot review');
  if(navigate){ui.changeProposal({...proposal,id:'new-proposal'});await flush();}else ui.unmount();
  const writes=ui.writes;
  ui.calls[1].resolve(Response.json(action==='cancel'?{review_request:queueRequest('cancelled'),canonical_changed:false}:
   {status:'queued',review_request:queueRequest(),canonical_changed:false,approval_recorded:true}));await flush();
  assert.equal(ui.completed.length,0);assert.equal(ui.writes,writes);assert.equal(ui.lateWrites,0);
 });
});

test('returning to the same proposal does not let an old mutation replace freshly loaded queue state',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await ready(ui,directPreflight());ui.click('Duyệt & giao dot review');
 ui.changeProposal({...proposal,id:'new-proposal'});await flush();
 ui.changeProposal(proposal);await flush();
 assert.equal(ui.calls.length,4);assert.equal(ui.calls[2].init.signal?.aborted,true);
 ui.calls[3].resolve(Response.json(directPreflight({review_request:{...queueRequest('blocked'),status:'blocked',blockers:['Need current product evidence.']}})));await flush();
 const writes=ui.writes;
 ui.calls[1].resolve(Response.json({status:'queued',review_request:queueRequest(),canonical_changed:false,approval_recorded:true}));await flush();
 assert.equal(ui.writes,writes);assert.equal(ui.completed.length,0);
 assert.match(ui.text(),/Need current product evidence/);assert.match(ui.text(),/Đang chờ phần còn thiếu/);
 assert.equal(ui.button('Duyệt rule & merge ngay').props.disabled,false);
 assert.equal(ui.button('Hủy yêu cầu').props.disabled,false);
});


test('non-owner fallback preserves general read and covered workflow without queue authority',async t=>{
 const data=preflight({queue_available:false,review_intent_hash:null,review_request:null});
 assert.equal(validatePreflight(data,proposal.id).queue_available,false);
 for(const invalid of [{...data,review_intent_hash:'forged'},{...data,review_request:{id:'forged'}}])
  assert.throws(()=>validatePreflight(invalid,proposal.id));
 const ui=setup('merge');t.after(ui.unmount);await ready(ui,data);
 assert.match(ui.text(),/Hàng đợi review chỉ dành cho owner/);
 assert.doesNotMatch(ui.text(),/Máy chủ chưa cung cấp luồng tự kiểm tra/);
 assert.equal(ui.button('Duyệt & giao dot review').props.disabled,true);
 const covered=setup('covered');t.after(covered.unmount);await ready(covered,data);
 covered.input('Quy chuẩn đã có','covered-1');await flush();covered.checkAll();
 covered.input('Lý do đóng feedback','Reviewed every affected brand and existing product safeguards.');await flush();
 assert.equal(covered.button('Xác nhận đã có trong quy chuẩn').props.disabled,false);
});


test('review mutation synchronously locks its host drawer and unlocks after an error',async t=>{
 const ui=setup('merge');t.after(ui.unmount);await ready(ui);assert.deepEqual(ui.busyEvents,[]);
 ui.click('Duyệt & giao dot review');assert.deepEqual(ui.busyEvents,[true]);
 ui.calls[1].resolve(Response.json({error:'Synthetic conflict'},{status:409}));await flush();
 assert.deepEqual(ui.busyEvents,[true,false]);assert.match(ui.text(),/Synthetic conflict/);
});
