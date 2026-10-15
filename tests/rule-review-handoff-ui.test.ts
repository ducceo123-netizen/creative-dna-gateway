import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
const code=buildSync({entryPoints:['src/components/RuleReviewHandoff.tsx'],bundle:true,format:'cjs',platform:'node',jsx:'automatic',write:false,external:['react','react/jsx-runtime']}).outputFiles[0].text;
type Node={type:string|symbol|((props:any)=>Node);props:Record<string,any>};
type Call={url:string;init:RequestInit;resolve:(response:Response)=>void;reject:(error:Error)=>void};
type Effect={create:()=>void|(()=>void);cleanup?:()=>void;deps?:unknown[]};
function nodes(value:any):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object'||!('props'in value))return [];return [value,...nodes(value.props.children)];}
function textOf(value:any):string{if(Array.isArray(value))return value.map(textOf).join('');if(value==null||typeof value==='boolean')return '';if(typeof value==='object')return textOf(value.props.children);return String(value);}
async function flush(){for(let i=0;i<50;i++)await Promise.resolve();}
function setup(storage=new Map<string,string>()){
 const deadlines=new Map<number,()=>void>(),polls=new Map<number,()=>void>();let timerId=0;
 const document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const slots:any[]=[],effects:Effect[]=[],queued:Effect[]=[],calls:Call[]=[],completed:any[]=[],busyEvents:boolean[]=[];
 let cursor=0,tree:Node,scheduled=false,mounted=true,writes=0,lateWrites=0,closed=0;
 let props:any={proposalId:'synthetic-proposal',request,onBusyChange:(busy:boolean)=>busyEvents.push(busy),onClose:()=>{closed++;unmount();},onMerged:()=>completed.push(true)};
 const hooks={
  useState(initial:any){const i=cursor++;if(!(i in slots)){const slot={value:typeof initial==='function'?initial():initial,set:(value:any)=>{writes++;if(!mounted){lateWrites++;return;}const next=typeof value==='function'?value(slot.value):value;if(Object.is(next,slot.value))return;slot.value=next;if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;if(mounted)render();});}}};slots[i]=slot;}return [slots[i].value,slots[i].set];},
  useRef(initial:any){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(create:Effect['create'],deps:unknown[]){const i=cursor++,old:Effect|undefined=slots[i];if(!old||deps.some((value,index)=>!Object.is(value,old.deps?.[index]))){old?.cleanup?.();const effect={create,deps};slots[i]=effect;if(old)effects.splice(effects.indexOf(old),1,effect);else effects.push(effect);queued.push(effect);}},
 };
 const jsx=(type:Node['type'],props:Node['props'])=>({type,props});
 const module={exports:{} as {RuleReviewHandoff:(props:any)=>Node}};
 vm.runInNewContext(code,{module,exports:module.exports,Error,AbortController,Response,setTimeout:(run:()=>void)=>{const id=++timerId;deadlines.set(id,run);return id;},clearTimeout:(id:number)=>deadlines.delete(id),
 document,
 window:{setInterval(run:()=>void){const id=++timerId;polls.set(id,run);return id;},clearInterval(id:number){polls.delete(id);},addEventListener(){},removeEventListener(){}},
 crypto:{randomUUID:()=>`11111111-1111-4111-8111-${String(++timerId).padStart(12,"0")}`},sessionStorage:{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},require(name:string){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:Symbol.for('Fragment')};throw Error(name);}});
 function request(url:string,init:RequestInit={}){return new Promise<Response>((resolve,reject)=>calls.push({url,init,resolve,reject}));}
 function materialize(value:any):any{if(Array.isArray(value))return value.map(materialize);if(!value||typeof value!=='object'||!('props'in value))return value;if(typeof value.type==='function')return materialize(value.type(value.props));return {...value,props:{...value.props,children:materialize(value.props.children)}};}
 function render(){cursor=0;tree=materialize(module.exports.RuleReviewHandoff(props));for(const effect of queued.splice(0))effect.cleanup=effect.create()||undefined;}
 function unmount(){if(!mounted)return;mounted=false;for(const effect of effects)effect.cleanup?.();}
 function all(type:string){return nodes(tree).filter(node=>node.type===type);}
 function button(label:string){const node=all('button').find(node=>textOf(node)===label);assert.ok(node,'Missing button '+label);return node;}
 function click(label:string){const node=button(label);assert.equal(!!node.props.disabled,false,label+' disabled');node.props.onClick();}
 render();
 return {timeout:()=>{for(const run of [...deadlines.values()])run();},poll:()=>{for(const run of polls.values())run();},visibility:(state:string)=>{document.visibilityState=state;},calls,completed,busyEvents,button,click,all,unmount,text:()=>textOf(tree),changeProposal(next:any){props={...props,proposal:next};render();},get writes(){return writes;},get lateWrites(){return lateWrites;},get closed(){return closed;}};
}
const intent='sha256:'+'a'.repeat(64),key='11111111-1111-4111-8111-111111111111';
const request=(extra:any={})=>({proposal_id:'synthetic-proposal',review_mode:'agent_rule_review',intent_hash:intent,idempotency_key:key,status:'queued',created_at:'2026-10-15T00:00:00Z',expires_at:'2026-10-16T00:00:00Z',blockers:[],...extra});
const preflight=()=>({proposal_id:'synthetic-proposal',review_mode:'agent_rule_review',available:true,eligible:true,intent_hash:intent,proposed_content_md:'Preserve brand-specific product identity.',scope:{branch_slug:'onepage-system',cross_brand:true},blockers:[],review_request:null});
async function ready(ui:ReturnType<typeof setup>,saved:any=null){ui.calls[0].resolve(Response.json({review_request:saved}));await flush();ui.calls[1].resolve(Response.json(preflight()));await flush();}
const label='Giao AI xem xét & merge';
test('opening only reads; one explicit click sends exact delegation without a second approval or baselines',async t=>{
 const ui=setup();t.after(ui.unmount);assert.match(ui.calls[0].url,/rule-review\/status$/);await ready(ui);
 assert.equal(ui.calls.length,2);assert.ok(ui.calls.every(c=>c.init.method!=='POST'));assert.equal(ui.all('input').length,0);
 const click=ui.button(label).props.onClick;click();click();await flush();assert.equal(ui.calls.length,3);
 const payload=JSON.parse(String(ui.calls[2].init.body));assert.equal(payload.delegate,true);assert.equal(payload.intent_hash,intent);assert.match(payload.idempotency_key,/^[a-f0-9-]{36}$/);assert.match(ui.calls[2].url,/rule-review\/handoff$/);
});
test('disabled capability displays precise unavailable reason without fallback or mutation',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(Response.json({review_request:null}));await flush();ui.calls[1].resolve(Response.json({error:'Backend rule-review v3 chưa kích hoạt'},{status:503}));await flush();
 assert.match(ui.text(),/Backend rule-review v3 chưa kích hoạt/);assert.equal(ui.button(label).props.disabled,true);assert.equal(ui.calls.length,2);
});
test('polling active handoff only reads and cancellation binds current intent',async t=>{
 const ui=setup();t.after(ui.unmount);await ready(ui,request());assert.match(ui.text(),/Đang chờ AI/);
 ui.click('Hủy bàn giao');await flush();assert.deepEqual(JSON.parse(String(ui.calls[2].init.body)),{intent_hash:intent,idempotency_key:key});assert.match(ui.calls[2].url,/rule-review\/cancel$/);
});
test('unknown handoff survives remount and cannot reconcile against different key',async t=>{
 const storage=new Map<string,string>(),ui=setup(storage);await ready(ui);ui.click(label);await flush();
 const payload=JSON.parse(String(ui.calls[2].init.body));ui.calls[2].reject(Error('Network interrupted'));await flush();ui.unmount();
 const retry=setup(storage);t.after(retry.unmount);await ready(retry,request({status:'cancelled',idempotency_key:key}));assert.equal(retry.button(label).props.disabled,true);assert.match(retry.text(),/Kết quả chưa rõ/);assert.equal(retry.calls.filter(c=>c.init.method==='POST').length,0);
 retry.poll();await flush();retry.calls[2].resolve(Response.json({review_request:request({idempotency_key:payload.idempotency_key})}));await flush();retry.calls[3].resolve(Response.json(preflight()));await flush();assert.doesNotMatch(retry.text(),/Kết quả chưa rõ/);assert.match(retry.text(),/Đang chờ AI/);
});
test('explicit re-delegation after terminal state creates fresh key, never renews on polling',async t=>{
 const ui=setup();t.after(ui.unmount);await ready(ui,request({status:'expired'}));ui.click(label);await flush();const payload=JSON.parse(String(ui.calls[2].init.body));assert.notEqual(payload.idempotency_key,key);assert.equal(payload.intent_hash,intent);
});
test('cancel is still usable with existing request after capability disabled',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(Response.json({review_request:request()}));await flush();ui.calls[1].resolve(Response.json({error:'Release disabled'},{status:503}));await flush();assert.equal(ui.button('Hủy bàn giao').props.disabled,false);ui.click('Hủy bàn giao');assert.match(ui.calls[2].url,/cancel$/);
});
test('old v2 response cannot enable AI rule handoff',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(Response.json({review_request:request({review_mode:'agent_outcome_review'})}));await flush();assert.equal(ui.button(label).props.disabled,true);assert.equal(ui.calls.length,1);
});
test('unmounted request does not update state or emit completion',async()=>{
 const ui=setup();await ready(ui);ui.click(label);await flush();ui.unmount();ui.calls[2].resolve(Response.json({review_request:request(),canonical_changed:false}));await flush();assert.equal(ui.lateWrites,0);assert.equal(ui.completed.length,0);
});
test('verified merged status ends monitoring view without requiring another approval',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(Response.json({review_request:request({status:'merged',outcome:{canonical_changed:true,visual_qc_performed:false,review_scope:'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'}})}));await flush();assert.equal(ui.completed.length,1);assert.match(ui.text(),/Đã merge/);assert.equal(ui.calls.length,1);assert.equal(ui.all('input').length,0);
});
test('pre-server failure has explicit recovery: read first then retry exact stored hash and key',async t=>{
 const ui=setup();t.after(ui.unmount);await ready(ui);ui.click(label);await flush();const original=JSON.parse(String(ui.calls[2].init.body));
 ui.calls[2].reject(Error('Disconnected before send'));await flush();ui.calls[3].resolve(Response.json({review_request:null}));await flush();ui.calls[4].resolve(Response.json(preflight()));await flush();
 assert.equal(ui.calls.filter(c=>c.init.method==='POST').length,1);ui.click('Thử lại đúng yêu cầu đã gửi');await flush();assert.match(ui.calls[5].url,/status$/);assert.notEqual(ui.calls[5].init.method,'POST');assert.equal(ui.calls.length,6);
 ui.calls[5].resolve(Response.json({review_request:null}));await flush();assert.deepEqual(JSON.parse(String(ui.calls[6].init.body)),original);assert.equal(ui.calls.filter(c=>c.init.method==='POST').length,2);
});
test('explicit recovery finds prior successful handoff and sends no duplicate write',async t=>{
 const ui=setup();t.after(ui.unmount);await ready(ui);ui.click(label);await flush();const original=JSON.parse(String(ui.calls[2].init.body));ui.calls[2].reject(Error('Response lost'));await flush();ui.calls[3].resolve(Response.json({review_request:null}));await flush();ui.calls[4].resolve(Response.json(preflight()));await flush();ui.click('Thử lại đúng yêu cầu đã gửi');await flush();ui.calls[5].resolve(Response.json({review_request:request({idempotency_key:original.idempotency_key})}));await flush();assert.equal(ui.calls.filter(c=>c.init.method==='POST').length,1);assert.doesNotMatch(ui.text(),/Kết quả chưa rõ/);
});
test('uncertain cancellation A cannot reconcile against cancelled delegation B with same intent',async t=>{
 const storage=new Map<string,string>(),ui=setup(storage);await ready(ui,request());ui.click('Hủy bàn giao');await flush();ui.calls[2].reject(Error('Response lost'));await flush();ui.unmount();
 const nextKey='22222222-2222-4222-8222-222222222222',retry=setup(storage);t.after(retry.unmount);await ready(retry,request({status:'cancelled',idempotency_key:nextKey}));assert.match(retry.text(),/Kết quả chưa rõ/);assert.equal(retry.button(label).props.disabled,true);
 retry.click('Thử lại đúng yêu cầu đã gửi');await flush();retry.calls[2].resolve(Response.json({review_request:request({status:'queued',idempotency_key:nextKey})}));await flush();assert.deepEqual(JSON.parse(String(retry.calls[3].init.body)),{intent_hash:intent,idempotency_key:key});assert.match(retry.calls[3].url,/cancel$/);
});
