import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const elements=new Map();
function element(id){
 if(!elements.has(id))elements.set(id,{id,style:{},value:'',innerHTML:'',textContent:'',focus(){this.focused=true;}});
 return elements.get(id);
}
const document={
 getElementById:element,
 querySelectorAll:()=>[],
 addEventListener:()=>{},
};
const context=vm.createContext({
 document,console,URL,Blob,Date,Promise,clearTimeout,setTimeout,window:{tt:null},localStorage:{getItem:()=>null,setItem:()=>{}},
 fetch:async()=>({json:async()=>({aiConfigured:false,cloudConfigured:false})}),
});
vm.runInContext(script,context,{timeout:1000});
const run=source=>vm.runInContext(source,context,{timeout:1000});
run("openWorkflow('UGC')");
assert.match(element('view').innerHTML,/UGC materials/);
assert.doesNotMatch(element('view').innerHTML,/data-action="createFiltered"/);
run("startWorkflow('LDP')");
assert.equal(run("state.page"),'dashboard');
assert.equal(run("state.composerWorkflow"),'LDP');
run("navigate('dashboard')");
run("state.composerWorkflow=null");
element('composerBrief').value='Create a Christmas Onepage for custom pet ornaments.';
run("createFromComposer()");
assert.match(element('view').innerHTML,/custom pet ornaments · Onepage/);
assert.match(element('view').innerHTML,/custom pet ornaments/);
assert.equal(run("state.prefillWorkflow"),'Onepage');
assert.equal(run("state.prefillSource"),'custom pet ornaments');
assert.match(element('view').innerHTML,/custom pet ornaments · Onepage/);
const parsed=run("parseTaskRequest('Anh cần làm Onepage cho - LED Bottle Light Topper')");
assert.equal(parsed.workflow,'Onepage');
assert.equal(parsed.source,'LED Bottle Light Topper');
assert.equal(parsed.title,'LED Bottle Light Topper · Onepage');
assert.equal(run("parseTaskRequest('Build UGC for besties').workflow"),'UGC');
assert.equal(run("parseTaskRequest('Make an LDP for kids').workflow"),'LDP');
assert.equal(run("parseTaskRequest('Scale Store Brand for GiftSoul').brand"),'GiftSoul');

run("navigate('dashboard')");
run("state.composerWorkflow=null");
element('composerBrief').value='';
run("createFromComposer()");
assert.equal(run("state.page"),'dashboard','empty composer must not open a task');
assert.equal(element('composerBrief').focused,true,'empty composer prompts the user');
element('composerBrief').value='New UGC photo concepts for personalized ornaments';
run("createFromComposer()");
assert.equal(run("state.page"),'create');
assert.match(element('view').innerHTML,/New UGC photo concepts/);

run("navigate('dashboard')");
run("state.composerWorkflow=null");
element('composerBrief').value='Anh cần làm Onepage cho - LED Bottle Light Topper';
run("navigate('create')");
assert.equal(run("state.prefillSource"),'LED Bottle Light Topper','Header/sidebar create must extract source from Home prompt');
assert.equal(run("state.prefillTitle"),'LED Bottle Light Topper · Onepage');
assert.equal(run("state.prefillBrief"),'Anh cần làm Onepage cho - LED Bottle Light Topper');
run("navigate('dashboard')");
run("state.composerWorkflow=null");
element('composerBrief').value='Anh cần làm Landing page cho - Gifts for Kids & Babies';
run("selectComposerWorkflow('LDP')");
run("createFromComposer()");
assert.equal(run("state.prefillWorkflow"),'LDP');
assert.equal(run("state.prefillSource"),'Gifts for Kids & Babies');
assert.equal(run("state.prefillTitle"),'Gifts for Kids & Babies · LDP');
assert.equal(run("parseTaskRequest('Anh cần làm Onepage cho - LED Bottle Light Topper').source"),'LED Bottle Light Topper');
assert.equal(run("parseTaskRequest('Anh cần làm Onepage cho - LED Bottle Light Topper', 'UGC').workflow"),'UGC');
assert.match(run("intentPreviewMarkup(parseTaskRequest('Anh cần làm Onepage cho - LED Bottle Light Topper'))"), /LED Bottle Light Topper/);
const collection=run("parseTaskRequest('Anh cần làm Onepage cho dòng sản phẩm Christmas Bone Stockings')");
assert.equal(collection.source,'Christmas Bone Stockings');
assert.equal(collection.title,'Christmas Bone Stockings · Onepage');
assert.equal(collection.kind,'collection');
assert.equal(run("parseTaskRequest('Anh cần làm Onepage cho collection Christmas Bone Stockings').source"),'Christmas Bone Stockings');
assert.equal(run("parseTaskRequest('Anh cần làm Onepage cho - LED Bottle Light Topper').source"),'LED Bottle Light Topper');
run("navigate('dashboard')");
run("state.composerWorkflow=null");
element('composerBrief').value='Anh cần làm Onepage cho dòng sản phẩm Christmas Bone Stockings';
run("createFromComposer()");
assert.equal(run("state.prefillTitle"),'Christmas Bone Stockings · Onepage');
assert.equal(run("state.prefillSource"),'Christmas Bone Stockings');
assert.equal(run("state.prefillKind"),'collection');
assert.doesNotMatch(element('view').innerHTML,/dòng sản phẩm Christmas Bone Stockings · Onepage/);
assert.doesNotMatch(element('view').innerHTML,/TASK SETUP/);
assert.doesNotMatch(html,/id="newTask"/);
const handoff=run("buildHandoff({id:'UID-TEST',brand:'PawfectHouse',workflow:'Onepage',title:'Christmas Bone Stockings · Onepage',url:'https://pawfecthouse.com/collections/christmas-bone-stockings',brief:'Need a Onepage'}, {snapshot:{status:'partial',scanned_at:'2026-11-11',task_source:'https://pawfecthouse.com/collections/christmas-bone-stockings',products:[{title:'Christmas Bone Stockings',url:'https://pawfecthouse.com/products/custom-stockings',variantCount:1,images:['https://cdn.shopify.com/stocking.jpg'],variants:[{title:'Red'}],description:'Actual public PDP description'}]}})");
assert.match(handoff,/Task ID: UID-TEST/);
assert.match(handoff,/cdn.shopify.com\/stocking.jpg/);
assert.match(handoff,/Not verified: external reviews/);
const savedTaskPanel=run("taskEditor({id:'UID-TEST',title:'Christmas Bone Stockings · Onepage',brand:'PawfectHouse',workflow:'Onepage',url:'https://pawfecthouse.com/collections/christmas-bone-stockings',brief:'Test',content:'',feedback:'',status:'Draft'})");
assert.match(savedTaskPanel,/Scan product data/);
assert.match(savedTaskPanel,/Copy handoff \+ sync token/);
console.log('Interactive task intake and prompt extraction checks passed');
