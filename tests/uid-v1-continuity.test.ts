import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { UID_LAUNCHER_SOURCE_SCRIPT, UID_DIRECT_OUTCOME_GUIDANCE } from '../uid-brands-actions.ts';
import { UID_EMBEDDED_UI_HTML } from '../uid-embedded-task-ui.ts';
import { UID_HOST_CONTINUITY_GUIDANCE, withUidProgress, operationPromptGuide } from '../uid-brands-progress.ts';
import { buildChatReview } from '../uid-brands-chat.ts';
import { REVIEW_INPUT_SCHEMA, createReviewContext } from '../uid-brands-review-contract.ts';

const review = (extra: Record<string, unknown> = {}) => {
  const input = REVIEW_INPUT_SCHEMA.parse({ stage: 'content_approval', branch: 'onepage-system', task_id: 'actual-task', content_version: 'v1', ...extra });
  return buildChatReview(input, createReviewContext(input));
};

test('Onepage full and unspecified scope avoid a content approval handoff while partial/review-first intent survives', () => {
  for (const execution_mode of [undefined, 'full_outcome']) {
    const result = review({ execution_mode });
    assert.deepEqual(result.next_actions, []);
    assert.match(result.text, /tiếp tục tạo materials/);
    assert.match(result.text, /research-only, content-only hoặc review-first/);
    assert.doesNotMatch(result.text, /Bạn có thể gửi một trong|onepage-panel\.html/);
    assert.equal(result.guide_data.execution_guidance?.execution, 'not_dispatched');
  }
  for (const execution_mode of ['research_only', 'content_only']) {
    const result = review({ execution_mode });
    assert.deepEqual(result.next_actions, []);
    assert.match(result.text, /không tự tạo assets/);
    assert.ok(result.text.includes(execution_mode));
    assert.deepEqual(review({ stage:'asset_review', execution_mode, assets:[{id:'actual-asset',name:'Actual asset'}] }).next_actions, []);
  }
  assert.deepEqual(review({ execution_mode: 'review_first' }).next_actions.map(a => a.action), ['revise', 'regenerate', 'approve']);
  for (const branch of [undefined, 'ldp-system']) assert.deepEqual(review({ branch }).next_actions.map(a => a.action), ['revise', 'regenerate', 'approve']);
});

test('in-progress and recoverable failures retain host continuation without requesting a user check-status turn', () => {
  for (const status of ['in_progress', 'blocked', 'failed']) {
    const result = review({ workflow_state: { status, message: 'Verified source remains unavailable.' } });
    assert.deepEqual(result.next_actions, []);
    assert.match(result.text, /Verified source remains unavailable/);
    assert.doesNotMatch(result.text, /Bạn có thể gửi một trong/);
  }
  assert.match(review({ workflow_state: { status: 'in_progress' } }).text, /không tạo bản chạy trùng/);
  assert.match(review({ workflow_state: { status: 'failed' } }).text, /write trước chưa rõ kết quả.*không tự gửi lại/);
  assert.match(UID_HOST_CONTINUITY_GUIDANCE, /real missing capability\/permission/);
  assert.match(UID_HOST_CONTINUITY_GUIDANCE, /final outcome review/);
  assert.match(UID_DIRECT_OUTCOME_GUIDANCE, /explicit user request for research-only, content-only or review-first/);
});

test('late QC/reference reads do not reset research, and progress preserves the exact original evidence and errors', () => {
  for (const payload of [{status:'PASS'}, {status:'unavailable',continue_task:true}]) {
    const original = { content: [{type:'text' as const,text:JSON.stringify(payload)}], isError:false };
    const result = withUidProgress(original, 'research');
    assert.equal(result.content[0], original.content[0]); assert.equal(result.isError, false);
    assert.match(result.content[1].text, /không khởi động lại research/);
    assert.doesNotMatch(result.content[1].text, /Ví dụ:|Bạn có thể nhắn/);
  }
  const unknown = { content: [{type:'text' as const,text:'Uncertain write receipt'}], isError:true };
  assert.match(operationPromptGuide('write', unknown), /không tự gửi lại/);
  assert.doesNotMatch(operationPromptGuide('write', unknown), /Lượt đọc\/kiểm tra/);
  assert.match(operationPromptGuide('training', unknown), /đừng gửi lại nếu chưa rõ kết quả/);
  assert.equal(withUidProgress(unknown, 'training').content[0], unknown.content[0]);
});

test('shared launcher parser accepts exact Onepage names without invented URLs and enforces actual brand scope', () => {
  const context: any = {URL}; vm.runInNewContext(UID_LAUNCHER_SOURCE_SCRIPT, context);
  const parse = context.uidBriefSource;
  const named = parse('Personalized Ornament', 'PawfectHouse', 'onepage-system');
  assert.equal(named.kind, 'product_line'); assert.equal(named.value, 'Personalized Ornament');
  assert.match(named.promptLine, /^product_line:/); assert.doesNotMatch(named.promptLine, /https?:/);
  assert.match(named.promptLine, /full catalog pagination/);
  for (const [brand, domain] of [['PawfectHouse','pawfecthouse.com'],['GiftSoul','giftsoul.co'],['SoulPrise','soulprise.co']]) {
    assert.equal(parse('https://'+domain+'/products/example', brand, 'onepage-system').kind, 'url');
  }
  for (const value of ['https://giftsoul.co/products/x','https://pawfecthouse.com.evil.test/x','https://user:secret@pawfecthouse.com/x','https:broken','javascript:alert(1)','www.pawfecthouse.com/x']) {
    assert.throws(() => parse(value,'pawfecthouse','onepage-system'));
  }
  assert.throws(() => parse('Personalized Ornament','pawfecthouse','ldp-system'));
  assert.throws(() => parse('Personalized Ornament','unknown','onepage-system'));
  assert.equal(parse('x'.repeat(160),'pawfecthouse','onepage-system').value.length,160);
  assert.throws(() => parse('x'.repeat(161),'pawfecthouse','onepage-system'),/160/);
});

test('source acquisition guards precede research readiness and never hand off a partial catalog', () => {
  const next_action={action:'CONTINUE_CATALOG_SCAN',tool:'compile_onepage_job',arguments:{brand:'PawfectHouse',product_line:'Ornament',research:{catalog_scan_id:'a'.repeat(64)}},preserve_existing_research:true};
  const packet=(status:string)=>({content:[{type:'text' as const,text:JSON.stringify({source_execution_guard:{status,next_action},research_validation:{status:'READY'},readiness:{content_authoring:'BLOCKED_NAMED_PRODUCT_SCOPE'}})}]});
  for(const status of ['BLOCKED','BLOCKED_CATALOG_UNAVAILABLE']){
    const original=packet(status),result=withUidProgress(original,'research');
    assert.equal(result.content[0],original.content[0]);
    assert.match(result.content[1].text,/Chỉ thực hiện safe source recovery.*source_execution_guard.next_action/);
    assert.match(result.content[1].text,/không tạo content\/assets phụ thuộc nguồn/);
    assert.doesNotMatch(result.content[1].text,/Dữ liệu research còn cần/);
  }
  const progress=operationPromptGuide('research',packet('IN_PROGRESS'));
  assert.match(progress,/host gọi ngay.*arguments chính xác/);assert.match(progress,/gộp catalog_scan_id opaque vào research hiện có/);
  assert.match(progress,/Không yêu cầu member nhắn tiếp tục/);assert.match(progress,/không phải background job/);
  assert.match(progress,/Chưa tạo content\/assets.*RESOLVED/);
  for(const blocked of [{readiness:{content_authoring:'BLOCKED_NAMED_PRODUCT_SCOPE'}},{creative_quality_contract:{status:'BLOCKED_STALE'}}]){
    assert.match(operationPromptGuide('research',{content:[],structuredContent:{...blocked,research_validation:{status:'READY'}}}),/Chưa thể tạo content\/assets/);
  }
});

class Element {
  value='';textContent='';disabled=false;children:any[]=[];style:Record<string,string>={};onclick?:()=>unknown;onchange?:()=>unknown;
  classes=new Set<string>();classList={add:(s:string)=>this.classes.add(s),remove:(s:string)=>this.classes.delete(s),toggle:(s:string,v:boolean)=>v?this.classes.add(s):this.classes.delete(s)};
  replaceChildren(...items:any[]){this.children=items;if(items.length&&this.value==='')this.value=items[0].value??'';}
  append(item:any){this.children.push(item);}focus(){}select(){}
}
function embedded(data:any) {
  const nodes=new Map<string,Element>(),events:Record<string,(e:any)=>void>={},sent:any[]=[];
  const $=(id:string)=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)!;};
  const window={openai:{toolOutput:data,sendFollowUpMessage:async(message:any)=>{sent.push(message);}},addEventListener:(name:string,cb:any)=>{events[name]=cb;}};
  const document={getElementById:$,createElement:()=>new Element(),querySelectorAll:()=>['start','approve','revise','package','copy'].map($)};
  const script=UID_EMBEDDED_UI_HTML.match(/<script>([\s\S]*?)<\/script>/)![1];
  vm.runInNewContext(script,{window,document,URL,Option:class extends Element{constructor(text:string,value:string){super();this.textContent=text;this.value=value;}},navigator:{clipboard:{writeText:async()=>{}}}});
  return {$,sent,update:(value:any)=>events['openai:set_globals']({detail:{globals:{toolOutput:value}}}),click:async(id:string)=>{if(!$(id).disabled)await $(id).onclick?.();}};
}

test('actual embedded launcher sends the verified line-name brief and preserves explicit review-first text', async () => {
  const ui=embedded({stage:'launcher',routes:[{brand:'pawfecthouse',branch:'onepage-system'}]});
  ui.$('url').value='Personalized Ornament';ui.$('theme').value='Chỉ research, chưa tạo ảnh; review-first khi viết content.';
  await ui.click('start');assert.equal(ui.sent.length,1);
  assert.match(ui.sent[0].prompt,/product_line: Personalized Ornament/);
  assert.match(ui.sent[0].prompt,/Chỉ research, chưa tạo ảnh/);
  assert.doesNotMatch(ui.sent[0].prompt,/KHÔNG có bước duyệt content/);
  ui.$('url').value='https://giftsoul.co/products/x';await ui.click('start');assert.equal(ui.sent.length,1);
});

test('actual embedded review reads nested identity and preserves state gating without early material handoff', async () => {
  const state={stage:'asset_review',review_context:{task_id:'real-task',content_version:'v1',branch:'onepage-system'},workflow_state:{status:'ready'},result_links:[{label:'Actual overall preview',url:'https://example.test/real.html'}]};
  const ui=embedded(state);assert.equal(ui.$('package').disabled,false);
  await ui.click('package');assert.equal(ui.sent.length,1);assert.match(ui.sent[0].prompt,/real-task \/ version v1/);
  for(const status of ['in_progress','blocked','failed']){ui.update({...state,workflow_state:{status}});assert.equal(ui.$('package').disabled,true);await ui.click('package');}
  assert.equal(ui.sent.length,1);
  ui.update({...state,stage:'content_approval',execution_mode:'full_outcome'});
  assert.equal(ui.$('materials').classes.has('hidden'),true);assert.equal(ui.$('package').disabled,true);
  assert.match(ui.$('intro').textContent,/không cần gửi lời tiếp tục/);
  ui.update({...state,execution_mode:'content_only'});assert.equal(ui.$('package').disabled,true);
  ui.update({...state,task_id:'conflicting-task'});assert.equal(ui.$('package').disabled,true);
});

test('actual embedded LDP launch and content stage preserve branch approval and explicit partial scope', async () => {
  const ui=embedded({stage:'launcher',routes:[{brand:'pawfecthouse',branch:'ldp-system'}]});
  ui.$('url').value='https://pawfecthouse.com/collections/example';
  await ui.click('start');assert.equal(ui.sent.length,1);
  assert.match(ui.sent[0].prompt,/Giữ các bước content approval và review theo quy tắc hiện hành/);
  assert.doesNotMatch(ui.sent[0].prompt,/tiếp tục qua content nội bộ/);
  const state={stage:'content_approval',review_context:{task_id:'real-ldp',content_version:'v1',branch:'ldp-system'}};
  ui.update(state);assert.match(ui.$('intro').textContent,/Duyệt content trong chat/);
  assert.doesNotMatch(ui.$('intro').textContent,/không cần gửi lời tiếp tục/);
  for(const execution_mode of ['research_only','content_only'])for(const stage of ['content_approval','asset_review']){
    ui.update({...state,stage,execution_mode});
    assert.match(ui.$('intro').textContent,/bàn giao đúng phần được yêu cầu/);
    assert.ok(ui.$('intro').textContent.includes(execution_mode));assert.equal(ui.$('package').disabled,true);
    assert.doesNotMatch(ui.$('intro').textContent,/Trợ lý tiếp tục/);
    if(stage==='asset_review')assert.match(ui.$('previewLinks').children[0].textContent,/không yêu cầu tạo thêm materials/);
  }
});
