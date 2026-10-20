import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {buildSync} from 'esbuild';
const code=buildSync({entryPoints:['src/components/HomeIconInstall.tsx'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime']}).outputFiles[0].text;
test('StrictMode setup cleanup setup renews request controller; unmount aborts it',async()=>{
 const effects:any[]=[];const states:any[]=[];const refs:any[]=[];let si=0,ri=0;const calls:any[]=[];
 const jsx=(type:any,props:any)=>({type,props});const react={useState:(initial:any)=>{const index=si++;if(!(index in states))states[index]=initial;return [states[index],(v:any)=>states[index]=v]},useRef:(initial:any)=>{const index=ri++;return refs[index]||=( {current:initial})},useEffect:(fn:any)=>effects.push(fn)};
 const module:any={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,AbortController,Error,String,JSON,require:(name:string)=>name==='react'?react:{jsx,jsxs:jsx}});
 const request=async(url:string,init:any)=>{calls.push({url,init});return Response.json({revision:'test',content_md:'test'})};
 const render=()=>{si=0;ri=0;return module.exports.HomeIconInstall({request})};
 const first=render();const cleanup=effects[0]();cleanup();const lastCleanup=effects[0]();
 const button=first.props.children.find((n:any)=>n?.type==='button');await button.props.onClick();
 assert.equal(calls.length,1);assert.equal(calls[0].init.signal.aborted,false);lastCleanup();assert.equal(calls[0].init.signal.aborted,true);
});
