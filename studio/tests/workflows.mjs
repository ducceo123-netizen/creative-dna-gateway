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
 document,console,URL,Blob,Date,Promise,clearTimeout,setTimeout,localStorage:{getItem:()=>null,setItem:()=>{}},
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
element('composerBrief').value='';
run("navigate('dashboard')");
run("createFromComposer()");
assert.match(element('view').innerHTML,/custom pet ornaments/);
console.log('Interactive workflow routing and draft prefill checks passed');
