// Standalone local test lab. No production imports, external network, or database.
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {benchmarkOnepage} from "./lean-packet.ts";
import {openSession} from "./stage-session.ts";
const file=process.argv[2];if(!file)throw Error("Pass an authorized compiler JSON snapshot");
const parsed=JSON.parse(readFileSync(file,"utf8"));
const packet=typeof parsed.text==="string"?JSON.parse(parsed.text.split("\n")[0]):parsed;
if(!packet.resolved||!packet.hard_gates||!Array.isArray(packet.execution)||!Array.isArray(packet.assets))throw Error("Invalid compiler snapshot");
const session=openSession(packet);
const metrics=benchmarkOnepage(packet);
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onepage Lean V2 Lab</title><style>body{font:16px system-ui;margin:40px auto;max-width:960px;padding:0 20px;color:#172334}h1{font-size:28px}button,select{font:inherit;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f6;padding:16px;border-radius:8px;max-height:480px;overflow:auto}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:650px){.cols{grid-template-columns:1fr}}</style><h1>Onepage Lean V2 — Offline lab</h1><p>Read-only snapshot comparison. No creative generation or production connection.</p><div id="metrics"></div><label>Stage <select id="stage"><option>research</option><option>content</option><option>materials</option><option>mapping</option><option>packaging</option></select></label><button id="go">Compare</button><div class="cols"><section><h2>Original packet</h2><pre id="original"></pre></section><section><h2>Lean stage</h2><pre id="lean"></pre></section></div><script>const $=id=>document.getElementById(id);async function run(){const s=$("stage").value;const r=await fetch("/compare?stage="+encodeURIComponent(s));if(!r.ok){$("metrics").textContent="Comparison failed";return}const d=await r.json();$("metrics").textContent="Original "+d.metrics.before+" bytes • deduplicated "+d.metrics.after+" bytes • stage "+d.stageBytes+" bytes • exact roundtrip "+d.metrics.roundtrip;$("original").textContent=JSON.stringify(d.original,null,2);$("lean").textContent=JSON.stringify(d.lean,null,2)}$("go").onclick=run;run()</script></html>`;
const server=createServer((req,res)=>{
 const url=new URL(req.url||"/","http://127.0.0.1");
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET"){res.writeHead(405).end();return;}
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);return;}
 if(url.pathname==="/compare"){
  try{const stage=url.searchParams.get("stage") as Parameters<typeof session.read>[0];const lean=session.read(stage,session.revision);res.setHeader("Content-Type","application/json");res.end(JSON.stringify({metrics,stageBytes:Buffer.byteLength(JSON.stringify(lean)),original:session.full(session.revision),lean}));}catch{res.writeHead(400).end("Invalid stage");}return;
 }
 res.writeHead(404).end();
});server.listen(8789,"127.0.0.1",()=>console.log("Offline lab: http://127.0.0.1:8789"));
