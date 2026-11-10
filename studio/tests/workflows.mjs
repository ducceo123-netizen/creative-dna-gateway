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
assert.match(element('view').innerHTML,/data-action="createFiltered"/);
run("startWorkflow('LDP')");
assert.match(element('view').innerHTML,/id="workflow"[^>]*value="LDP"/);
run("navigate('dashboard')");
element('composerBrief').value='Create a Christmas Onepage for custom pet ornaments.';
run("createFromComposer()");
assert.match(element('view').innerHTML,/Create a Christmas Onepage/);
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
element('composerBrief').value='';
run("createFromComposer()");
assert.equal(run("state.page"),'dashboard','empty composer must not open a task');
assert.equal(element('composerBrief').focused,true,'empty composer prompts the user');
element('composerBrief').value='New UGC photo concepts for personalized ornaments';
run("createFromComposer()");
assert.equal(run("state.page"),'create');
assert.match(element('view').innerHTML,/New UGC photo concepts/);
console.log('Interactive workflow routing and draft prefill checks passed');
