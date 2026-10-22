import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import {boundedFetch,reconcilesReview} from '../src/request-recovery.ts';

async function flush(){for(let i=0;i<80;i++)await Promise.resolve();}
function nodes(v:any):any[]{return Array.isArray(v)?v.flatMap(nodes):v?.props?[v,...nodes(v.props.children)]:[];}
function text(v:any):string{return Array.isArray(v)?v.map(text).join(''):v?.props?text(v.props.children):v==null||typeof v==='boolean'?'':String(v);}
function harness(entry:string,name:string){
 const code=buildSync({entryPoints:[entry],bundle:true,format:'cjs',platform:'node',write:false,external:['react','react/jsx-runtime','lucide-react']}).outputFiles[0].text;
 const slots:any[]=[],effects:any[]=[],queue:any[]=[],calls:any[]=[],timeouts=new Map<number,()=>void>();let cursor=0,id=0,tree:any,mounted=true,scheduled=false;
 const hooks={useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,(value:any)=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;if(!scheduled&&mounted){scheduled=true;queueMicrotask(()=>{scheduled=false;if(mounted)render();});}}];},useRef(initial:any){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useMemo(make:any,deps:any[]){const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j]))slots[i]={deps,value:make()};return slots[i].value;},useEffect(make:any,deps:any[]){const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j])){slots[i]?.cleanup?.();const effect={deps,make,cleanup:undefined};slots[i]=effect;effects.push(effect);queue.push(effect);}}};
 const jsx=(type:any,props:any)=>({type,props});const module={exports:{} as any};
 class Reader{result='data:image/png;base64,c3ludGhldGlj';onload:any;onerror:any;onabort:any;readAsDataURL(){queueMicrotask(()=>this.onload());}abort(){this.onabort?.();}}
 vm.runInNewContext(code,{module,exports:module.exports,Error,Response,AbortController,FileReader:Reader,performance:{now:()=>0},sessionStorage:{getItem(){return null;}},requestAnimationFrame:(fn:any)=>fn(),navigator:{clipboard:{writeText:async()=>{}}},document:{visibilityState:'visible',getElementById:()=>null,addEventListener(){},removeEventListener(){}},window:{location:{pathname:'/'},history:{pushState(){}},scrollTo(){},addEventListener(){},removeEventListener(){},setInterval(){return 1;},clearInterval(){}},setTimeout:(fn:()=>void)=>{const next=++id;timeouts.set(next,fn);return next;},clearTimeout:(id:number)=>timeouts.delete(id),fetch:(url:string,init:any)=>new Promise<Response>((resolve,reject)=>{calls.push({url,init,resolve,reject});if(url==='/api/routes')resolve(Response.json({routes:[]}));}),require(name:string){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='lucide-react')return new Proxy({},{get:(_,name)=>String(name)});throw Error(name);}});
 function render(){cursor=0;tree=module.exports[name]({onBack(){}});for(const effect of queue.splice(0))effect.cleanup=effect.make();}
 render();return {calls,all:(type:string)=>nodes(tree).filter(n=>n.type===type),text:()=>text(tree),click(label:string){const node=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(node,label);assert.ok(!node.props.disabled,label);node.props.onClick();},timeout(){for(const fn of [...timeouts.values()])fn();},unmount(){mounted=false;effects.forEach(e=>e.cleanup?.());}};
}

test('switching material discards old resolve and enables fresh request; Live Preview makes zero requests',async t=>{
 const ui=harness('src/App.tsx','default');t.after(ui.unmount);await flush();ui.click('Advanced / DebugCanonical spec & MCP endpoint — chỉ mở khi cần kiểm tra.Mở');await flush();ui.click('View canonical spec');await flush();const old=ui.calls.find(c=>c.url==='/api/resolve');assert.ok(old);
 ui.click('LDP Hero');await flush();assert.equal(old.init.signal.aborted,true);ui.click('View canonical spec');await flush();const fresh=ui.calls.filter(c=>c.url==='/api/resolve')[1];fresh.resolve(Response.json({marker:'fresh'}));await flush();old.resolve(Response.json({marker:'old'}));await flush();
 const viewer=ui.all('button').find(n=>text(n)==='View canonical spec');assert.ok(viewer);assert.equal(viewer.props.disabled,false);
 assert.equal(ui.all('iframe').length,0);assert.equal(ui.calls.some(c=>/branch-guide|branch-preview/.test(c.url)),false);
});

test('batch upload retains each confirmed asset, reports partial failure and blocks repeated clicks',async t=>{
 const ui=harness('src/components/FeedbackUpload.tsx','FeedbackUpload');t.after(ui.unmount);
 const change=ui.all('input')[0].props.onChange;const files=[{name:'first.png',type:'image/png',size:10},{name:'bad.pdf',type:'application/pdf',size:10}];change({target:{files,value:'x'}});change({target:{files,value:'x'}});await flush();assert.equal(ui.calls.length,1);
 ui.calls[0].resolve(Response.json({asset_id:'confirmed-asset',image_url:'https://example.test/asset.png'}));await flush();assert.match(ui.text(),/1 image confirmed and retained/);assert.match(ui.text(),/confirmed-asset/);assert.match(ui.text(),/bad.pdf: unsupported/);assert.equal(ui.all('img').length,1);
});

test('body read deadline aborts even after headers; mutation is never replayed',async()=>{
 let calls=0;let signal:AbortSignal|null|undefined;
 const keepAlive=setTimeout(()=>{},50);
 try{await assert.rejects(boundedFetch('/synthetic',{method:'POST'},async(_url,init)=>{calls++;signal=init?.signal;return{status:200,arrayBuffer:()=>new Promise(()=>{})} as Response;},5),/timed out/);assert.equal(calls,1);assert.equal(signal?.aborted,true);}finally{clearTimeout(keepAlive);}
});

test('pending state cannot prove failed write; only observed terminal or new request unlocks reconciliation',()=>{
 assert.equal(reconcilesReview({action:'rule'},'pending'),false);
 assert.equal(reconcilesReview({action:'rule'},'merged'),false);
 assert.equal(reconcilesReview({action:'rule'},'unknown'),false);
 assert.equal(reconcilesReview({action:'process',requestId:'old'},'pending',{id:'old',status:'cancelled'}),false);
 assert.equal(reconcilesReview({action:'process',requestId:'old'},'pending',{id:'new',status:'queued'}),true);
 assert.equal(reconcilesReview({action:'cancel',requestId:'old'},'pending',{id:'new',status:'cancelled'}),false);
});
