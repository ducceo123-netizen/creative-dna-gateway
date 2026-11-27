import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, fullContext, readContextPath, stageContext, assertCoverage, compactPacket, restorePacket, OBSERVED_EXECUTION, type Packet } from './rules.ts';
import { compileCanonical, CANONICAL_COMPILER_URL, MAX_CANONICAL_RESPONSE_BYTES } from './compiler.ts';

const provenance={sourceUrl:CANONICAL_COMPILER_URL,observedAt:'2026-11-27T00:00:00Z',baselineCommit:'87bf39d1f38eb1d0baee159b921efbd7e3aaf923',visibility:'synthetic' as const};
function fixture(brand='pawfecthouse',sourceType='unknown',researchRevision=0):Packet {
  const supplement={id:'owner:synthetic',canonical_text:'Preserve this exact synthetic instruction.\nSecond line.',scope:{brands:[brand]},source:{locator:'synthetic-fixture'},precedence:'SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH'};
  const common={production_qc_contract:{pixel_review:'HOST_REQUIRED',banner_workflow:{generation_mode:'single_pass_integrated_final_banner'}},portable_quality_playbook:{instruction:'Test-only template instruction'},live_html_feedback:{instruction:'Version-bound final review'}};
  const gtk={version:'synthetic-gtk',...common,ui_content_contract:{required:'exact copy'},asset_slots:['banner_desktop','gtk_01']};
  return {resolved:{brand,branch:'onepage-system'},dynamic_job:{source_url:null,source_type:sourceType},execution:[...OBSERVED_EXECUTION],hard_gates:{product_physical_truth:'HARD_MULTI_SOURCE',content_approval:'AUTO_CONTINUE_NO_INTERMEDIATE_CONTENT_SIGNOFF'},assets:[{slot:'banner_desktop',size:'2560x960'},{slot:'gtk_01',condition:'ONLY_WHEN_GTK_SELECTED'}],
    creative_quality_contract:{status:'COMPILED',errors:[],revision:'synthetic:1',rules:[
      {id:'synthetic.canonical.1',instruction:'Exact verbatim café rule.',sources:[{locator:'canonical:synthetic',node:'branch'}],scope:{brands:[brand]},key:'test',category:'workflow',value:'HARD',requires:['synthetic.canonical.2'],unrecognized_metadata:{retained:true}},
      {id:'synthetic.canonical.2',instruction:'Second rule',sources:[{locator:'canonical:synthetic',node:'branch'}],scope:{brands:[brand]},key:'test2',category:'workflow',value:'HARD'},
    ],owner_supplemental_rules:[supplement]},owner_supplemental_contract:{precedence:supplement.precedence,rules:[supplement]},
    portable_quality_playbook:{instruction:'Different top-level playbook; never deduplicate by name.'},ui_mapping_template:gtk,
    ui_mapping_templates:{gtk,faq:{version:'synthetic-faq',...common,ui_content_contract:{required:'exact copy'},asset_slots:['banner_desktop']}},
    research_contract:{instruction:'Source evidence required'},research_validation:{status:researchRevision?'READY_WITH_LIMITATIONS':'AWAITING_RESEARCH',revision:researchRevision},
    unknown_future_contract:{instruction:'This unknown rule must remain visible.',extra:[1,null,'']},
  };
}

test('lossless structural roundtrip across brand, source and research variants, including unknown fields',()=>{
  for(const brand of ['pawfecthouse','giftsoul','soulprise'])for(const type of ['unknown','product','collection'])for(const revision of [0,1]) {
    const packet=fixture(brand,type,revision),compact=compactPacket(packet),snapshot=createSnapshot(packet,provenance);
    assert.deepEqual(restorePacket(compact),packet);
    assert.deepEqual(fullContext(snapshot),packet);
    assert.equal(snapshot.registry[0].text,'Exact verbatim café rule.');
    assert.deepEqual(snapshot.registry[0].raw,packet.creative_quality_contract.rules[0]);
    assert.deepEqual(readContextPath(snapshot,'rule:synthetic.canonical.1'),packet.creative_quality_contract.rules[0]);
    assert.deepEqual(readContextPath(snapshot,'/ui_mapping_template'),packet.ui_mapping_template);
    assert.deepEqual(readContextPath(snapshot,'/unknown_future_contract/extra'),[1,null,'']);
  }
});
test('equal values deduplicate only after equality; conflicting duplicate payload stays present',()=>{
  const packet=fixture();packet.owner_supplemental_contract.rules[0]={...packet.owner_supplemental_contract.rules[0],canonical_text:'Different text'};
  const compact=compactPacket(packet);
  assert.equal(compact.aliases['/owner_supplemental_contract/rules'],undefined);
  assert.deepEqual(restorePacket(compact),packet);
  assert.notDeepEqual(packet.portable_quality_playbook,packet.ui_mapping_templates.gtk.portable_quality_playbook);
  assert.deepEqual(compact.data.portable_quality_playbook,packet.portable_quality_playbook);
  const snapshot=createSnapshot(packet,provenance);
  assert.ok(snapshot.conflicts.some(c=>c.code==='CONFLICTING_RULE_ID'&&c.ruleIds.includes('owner:synthetic')));
  const bundle=stageContext(snapshot,'content');
  assert.throws(()=>assertCoverage(snapshot,'content',bundle.receipt),/CANONICAL_CONTEXT_CONFLICT/);
});
test('every stage exposes complete canonical rules, dependency closure and unknown metadata',()=>{
  const snapshot=createSnapshot(fixture(),provenance);
  for(const stage of OBSERVED_EXECUTION) {
    const bundle=stageContext(snapshot,stage,{templateMode:'gtk'});
    assert.equal(bundle.coverage.ruleCoverage,1);
    assert.deepEqual(bundle.coverage.requiredRuleIds,['owner:synthetic','synthetic.canonical.1','synthetic.canonical.2']);
    assert.deepEqual(bundle.data.unknown_future_contract,snapshot.packet.unknown_future_contract);
    assert.equal(bundle.data.creative_quality_contract.rules[0].instruction,'Exact verbatim café rule.');
    assert.equal(assertCoverage(snapshot,stage,bundle.receipt,{templateMode:'gtk'}).status,'COVERED');
    assert.deepEqual(restorePacket({data:bundle.data,aliases:bundle.aliases}).creative_quality_contract,snapshot.packet.creative_quality_contract);
  }
  const bundle=stageContext(snapshot,'content');
  assert.ok(bundle.templateContextRecords.some((r:any)=>r.paths.includes('/ui_mapping_templates/gtk/ui_content_contract')));
  assert.ok(bundle.templateContextRecords.some((r:any)=>r.paths.includes('/ui_mapping_templates/gtk/production_qc_contract')));
});
test('unknown template metadata is universal; selected layout loads only after GTK/FAQ decision',()=>{
  const packet=fixture();packet.ui_mapping_templates.faq.future_gate={rule:'Must not disappear'};
  const snapshot=createSnapshot(packet,provenance);
  assert.throws(()=>stageContext(snapshot,'mapping'),/TEMPLATE_DECISION_REQUIRED/);
  assert.ok(stageContext(snapshot,'content').templateContextRecords.some((r:any)=>r.value.rule==='Must not disappear'));
  const faq=stageContext(snapshot,'mapping',{templateMode:'faq'});
  assert.deepEqual(Object.keys(faq.data.ui_mapping_templates),['faq']);
  assert.equal(faq.data.ui_mapping_templates.faq.asset_slots.includes('gtk_01'),false);
  assert.deepEqual(fullContext(snapshot).ui_mapping_templates,packet.ui_mapping_templates);
});
test('unequal legacy template is never silently treated as the GTK alias',()=>{
  const packet=fixture();packet.ui_mapping_template={...packet.ui_mapping_template,legacy_instruction:'Distinct retained requirement'};
  const snapshot=createSnapshot(packet,provenance),bundle=stageContext(snapshot,'content');
  assert.deepEqual(bundle.data.ui_mapping_template,packet.ui_mapping_template);
  assert.equal(bundle.aliases['/ui_mapping_template'],undefined);
});
test('stale coverage, packet corruption and rule-ID tampering are rejected',()=>{
  const old=createSnapshot(fixture(),provenance),receipt=stageContext(old,'content').receipt;
  const updated=createSnapshot(fixture('pawfecthouse','unknown',1),provenance);
  assert.notEqual(updated.hash,old.hash);
  assert.throws(()=>assertCoverage(updated,'content',receipt),/STALE_OR_INCOMPLETE/);
  assert.throws(()=>assertCoverage(old,'content',{...receipt,requiredRuleIds:[]}),/STALE_OR_INCOMPLETE/);
  const corrupt=structuredClone(old);corrupt.packet.hard_gates={};
  assert.throws(()=>fullContext(corrupt),/SNAPSHOT_HASH_MISMATCH/);
  const tamper=structuredClone(old);tamper.registry[0].text='changed';
  assert.throws(()=>fullContext(tamper),/SNAPSHOT_REGISTRY_MISMATCH/);
});
test('missing dependencies, rule conflicts, upstream errors and new execution steps fail closed',()=>{
  const cases:Packet[]=[];
  const missing=fixture();missing.creative_quality_contract.rules[0].requires=['absent'];cases.push(missing);
  const duplicate=fixture();duplicate.creative_quality_contract.rules.push({...duplicate.creative_quality_contract.rules[0],instruction:'conflicting'});cases.push(duplicate);
  const upstream=fixture();upstream.creative_quality_contract.status='BLOCKED';upstream.creative_quality_contract.errors=['QUALITY_CONTRACT_STALE'];cases.push(upstream);
  const step=fixture();step.execution.push('FUTURE_UNCLASSIFIED_STEP');cases.push(step);
  const cyclic=fixture();cyclic.creative_quality_contract.rules[1].requires=['synthetic.canonical.1'];cases.push(cyclic);
  const shape=fixture();shape.creative_quality_contract.rules[0].requires='synthetic.canonical.2';cases.push(shape);
  for(const packet of cases){const snapshot=createSnapshot(packet,provenance),bundle=stageContext(snapshot,'content');assert.ok(bundle.conflicts.length);assert.throws(()=>assertCoverage(snapshot,'content',bundle.receipt),/CANONICAL_CONTEXT_CONFLICT/);}
});
test('explicit contradictory banner modes stay retrievable and block affected stages',()=>{
  const packet=fixture();packet.ui_mapping_templates.faq.production_qc_contract={banner_workflow:{generation_mode:'scene-first-typography-second'}};
  const snapshot=createSnapshot(packet,provenance),bundle=stageContext(snapshot,'materials');
  assert.ok(bundle.conflicts.some(c=>c.code==='BANNER_WORKFLOW_CONFLICT'));
  assert.equal(readContextPath(snapshot,'/ui_mapping_templates/faq/production_qc_contract/banner_workflow/generation_mode'),'scene-first-typography-second');
  assert.throws(()=>assertCoverage(snapshot,'materials',bundle.receipt),/CANONICAL_CONTEXT_CONFLICT/);
});
test('unsafe paths, prototype keys, forged aliases and non-JSON values are rejected',()=>{
  const snapshot=createSnapshot(fixture(),provenance);
  for(const path of ['/__proto__','/constructor/prototype','/a~2b','../secret','/creative_quality_contract/toString'])assert.throws(()=>readContextPath(snapshot,path));
  assert.throws(()=>createSnapshot(JSON.parse('{"__proto__":{"polluted":true}}'),provenance),/UNSAFE_JSON_KEY/);
  assert.throws(()=>createSnapshot({...fixture(),invalid:undefined},provenance),/NON_JSON_VALUE/);
  assert.throws(()=>restorePacket({data:{},aliases:{'/__proto__/x':'/anything'}}),/UNKNOWN_ALIAS/);
  assert.equal(({} as any).polluted,undefined);
});
test('compiler sends only exact allowed read-only operation; no bearer forwarding',async()=>{
  let calls=0;
  const fetcher:typeof fetch=async(url,init)=>{calls++;assert.equal(url,CANONICAL_COMPILER_URL);assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).has('authorization'),false);assert.deepEqual(JSON.parse(String(init?.body)),{brand:'pawfecthouse'});return Response.json(fixture());};
  const packet=await compileCanonical({brand:'pawfecthouse'},fetcher);
  assert.equal(packet.resolved.brand,'pawfecthouse');assert.equal(calls,1);
  for(const source_url of ['http://localhost/products/x','https://169.254.169.254/products/x','https://pawfecthouse.com.evil.example/products/x','https://user:pass@pawfecthouse.com/products/x','https://giftsoul.co/products/x'])await assert.rejects(()=>compileCanonical({brand:'pawfecthouse',source_url},fetcher));
  await assert.rejects(()=>compileCanonical({brand:'pawfecthouse',endpoint:'https://evil.example'} as any,fetcher));
  assert.equal(calls,1);
});
test('compiler rejects invalid route, body size, JSON and upstream failures',async()=>{
  await assert.rejects(()=>compileCanonical({brand:'pawfecthouse'},async()=>Response.json(fixture('giftsoul'))),/CANONICAL_ROUTE_MISMATCH/);
  await assert.rejects(()=>compileCanonical({brand:'pawfecthouse'},async()=>new Response('x',{headers:{'content-length':String(MAX_CANONICAL_RESPONSE_BYTES+1)}})),/TOO_LARGE/);
  await assert.rejects(()=>compileCanonical({brand:'pawfecthouse'},async()=>new Response('not JSON')),/INVALID_JSON/);
  await assert.rejects(()=>compileCanonical({brand:'pawfecthouse'},async()=>new Response('private backend detail',{status:500})),/^Error: CANONICAL_READ_HTTP_500$/);
  await assert.rejects(()=>compileCanonical({brand:'pawfecthouse'},async()=>{throw new Error('sensitive backend detail');}),/^Error: CANONICAL_READ_UNAVAILABLE$/);
});
test('compiler preserves exact name-only product line and rejects missing canonical exact-type requirements',async()=>{
  const product_line='Travel Case';let calls=0;
  const packet={...fixture(),named_product_scope:{requested_product_type:product_line,match_policy:'SHOPIFY_PRODUCT_TYPE_EXACT',requires_store_catalog_scan:true,evaluator:'evaluate_onepage_product_type_scope',no_title_or_handle_contains_fallback:true}};
  const fetcher:typeof fetch=async(url,init)=>{calls++;assert.equal(url,CANONICAL_COMPILER_URL);assert.deepEqual(JSON.parse(String(init?.body)),{brand:'pawfecthouse',product_line});assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json(packet);};
  assert.equal((await compileCanonical({brand:'pawfecthouse',product_line},fetcher)).named_product_scope.requested_product_type,product_line);assert.equal(calls,1);
  await assert.rejects(compileCanonical({brand:'pawfecthouse',product_line},async()=>Response.json(fixture())),/CANONICAL_NAMED_SCOPE_MISMATCH/);
  await assert.rejects(compileCanonical({brand:'pawfecthouse',product_line},async()=>Response.json({...packet,named_product_scope:{...packet.named_product_scope,no_title_or_handle_contains_fallback:false}})),/CANONICAL_NAMED_SCOPE_MISMATCH/);
});
test('public compiler never forwards private research, binary media or credentials',async()=>{
  let called=false;
  const fetcher:typeof fetch=async()=>{called=true;return Response.json(fixture());};
  for(const research of [
    {sources:[{access:'team',observations:'private context'}]},
    {references:[{visibility:'private'}]}, {attachments:[{data_base64:'AAAA'}]},
    {authorization:'Bearer secret'}, {source:'https://example.test/image?token=secret'},
    {image:'data:image/png;base64,AAAA'},
  ])await assert.rejects(()=>compileCanonical({brand:'pawfecthouse',research},fetcher));
  assert.equal(called,false);
});
