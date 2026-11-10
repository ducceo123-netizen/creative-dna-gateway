import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
assert.match(html, /UID Brands Studio/);
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'inline application script exists');
new vm.Script(script,{filename:'studio-inline.js'});
assert.match(html, /class="sidebar"/);
assert.match(html, /class="workspace-frame"/);
assert.match(html, /class="welcome-hero"/);
assert.doesNotMatch(html, /<button data-workflow="Onepage"/, "Workflows are not duplicated in sidebar");
assert.match(html, /id="taskSearch"/);
assert.match(html, /data-create-workflow/);
assert.match(html, /polaris-2\.0\.js/);
assert.doesNotMatch(html, /9,999\+|\$4\.94M|2\.18M/, 'Do not render invented Shopify analytics');

const port=11890;
const child=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{env:{...process.env, PORT:String(port), OPENAI_API_KEY:'', STUDIO_ACCESS_TOKEN:''},stdio:['ignore','pipe','pipe']});
try{
  let ready=false;
  for(let n=0;n<60;n++){await new Promise(r=>setTimeout(r,100));try{const r=await fetch('http://localhost:'+port+'/api/status');if(r.ok){ready=true;break;}}catch{}}
  assert.ok(ready,'server is reachable');
  const s=await(await fetch('http://localhost:'+port+'/api/status')).json();
  assert.equal(s.aiConfigured,false);
  const index=await fetch('http://localhost:'+port+'/');
  assert.equal(index.status,200);assert.match(await index.text(),/Creative overview/);
  const ai=await fetch('http://localhost:'+port+'/api/ai/content',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brief:'Generate content for an ornament'})});
  assert.equal(ai.status,503,'AI denied without configured keys');
  assert.equal((await fetch('http://localhost:'+port+'/api/private')).status,404);
  console.log('UID Brands Studio smoke checks passed');
}finally{child.kill('SIGTERM');}
