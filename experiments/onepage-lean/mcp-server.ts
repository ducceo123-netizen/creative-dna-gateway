// Standalone experiment. Only public read-only MCP tools; no DB credentials or writes.
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {openSession} from "./stage-session.ts";
import {benchmarkOnepage} from "./lean-packet.ts";
const UPSTREAM="https://uid-brands-gateway-preview.onrender.com/api/mcp";
const allowed=new Set(["compile_onepage_job","get_onepage_ui_template","evaluate_onepage_banner_qc","evaluate_onepage_creative_qc","evaluate_onepage_physical_qc","evaluate_onepage_product_type_scope","evaluate_onepage_eo_store_references","evaluate_onepage_eo_outcome","get_onepage_quality_playbook","get_human_realism_references","list_creative_dna_routes","resolve_creative_dna","scan_onepage_eo_store","audit_onepage_eo_pixels","get_onepage_eo_reference_pack"]);
const localNames=new Set(["lean_context_stage","lean_context_path","lean_context_full"]);
const sessions=new Map<string,{session:ReturnType<typeof openSession>,expires:number}>();
const ttl=30*60*1000;
const stageSchema={type:"string",enum:["research","content","materials","mapping","packaging"]};
const baseProps={snapshot_id:{type:"string"},revision:{type:"string"}};
const localTools=[
 {name:"lean_context_stage",description:"Read the pinned Onepage stage before starting it. All hard gates remain mandatory; retrieve any deferred required context using lean_context_path or lean_context_full. Never treat a deferred field as optional.",inputSchema:{type:"object",properties:{...baseProps,stage:stageSchema},required:["snapshot_id","revision","stage"]}},
 {name:"lean_context_path",description:"Retrieve exact original canonical field or alias target for the pinned snapshot.",inputSchema:{type:"object",properties:{...baseProps,path:{type:"string"}},required:["snapshot_id","revision","path"]}},
 {name:"lean_context_full",description:"Required fallback if a rule, reference, dependency or stage coverage is uncertain. Returns exact original compiler packet.",inputSchema:{type:"object",properties:baseProps,required:["snapshot_id","revision"]}}
].map(x=>({...x,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}));
function content(x:unknown,isError=false){return {content:[{type:"text",text:JSON.stringify(x)}],isError};}
async function upstream(method:string,params:unknown={}){
 const r=await fetch(UPSTREAM,{method:"POST",redirect:"error",headers:{"Content-Type":"application/json","Accept":"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw Error("Read-only upstream HTTP "+r.status);
 const raw=await r.text();let msg:any;
 if(r.headers.get("content-type")?.includes("text/event-stream")){
  for(const line of raw.split(/\r?\n/)){if(line.startsWith("data:")){try{const x=JSON.parse(line.slice(5));if(x.id===1)msg=x;}catch{}}}
 }else msg=JSON.parse(raw);
 if(!msg||msg.error||!Object.hasOwn(msg,"result"))throw Error("Upstream MCP response unavailable");
 return msg.result;
}
function prune(){for(const [k,v] of sessions)if(v.expires<Date.now())sessions.delete(k);while(sessions.size>=24)sessions.delete(sessions.keys().next().value!);}
async function call(name:string,args:any){
 if(localNames.has(name)){
  prune();const row=sessions.get(String(args.snapshot_id));if(!row)return content({status:"BLOCKED",error:"Snapshot expired or unknown. Recompile original brief and research; do not skip gates."},true);
  const s=row.session,revision=String(args.revision);
  return content(name==="lean_context_stage"?s.read(args.stage,revision):name==="lean_context_path"?s.readPath(String(args.path),revision):s.full(revision));
 }
 if(!allowed.has(name))return content({error:"Tool not available in read-only experiment"},true);
 const result=await upstream("tools/call",{name,arguments:args});
 if(name!=="compile_onepage_job"||result.isError)return result;
 const first=result.content?.find((x:any)=>x.type==="text");let p:any;
 try{p=JSON.parse(first?.text||"");}catch{return result;}
 if(!p.resolved||!p.hard_gates||!Array.isArray(p.execution)||!Array.isArray(p.assets))return result;
 const session=openSession(p);prune();const snapshot_id=randomUUID();sessions.set(snapshot_id,{session,expires:Date.now()+ttl});
 const initial=session.read("research",session.revision);
 return {...result,content:[{type:"text",text:JSON.stringify({experiment:"Onepage Lean V2",snapshot_id,revision:session.revision,benchmark:benchmarkOnepage(p),...initial,workflow:"Continue every canonical execution step. Call lean_context_stage before content, materials, mapping and packaging. Resolve all referenced paths; if unsure call lean_context_full. Research submission calls compiler again, creating a new snapshot. No creative or quality gate is waived."})},...result.content.filter((x:any)=>x!==first)]};
}
async function dispatch(m:any){
 switch(m.method){
 case "initialize":return {protocolVersion:["2025-03-26","2025-06-18","2025-11-25"].includes(m.params?.protocolVersion)?m.params.protocolVersion:"2025-06-18",capabilities:{tools:{listChanged:false}},serverInfo:{name:"UID Brands Lean V2 (Experimental)",version:"0.1.0"},instructions:"Read-only isolated experiment using public canonical Onepage sources. Preserve all flow and gates. Start with compile_onepage_job; retrieve stage/path/full as necessary. Never use this server for training, publishing or production writes."};
 case "ping":return {};
 case "tools/list":{const r=await upstream("tools/list",m.params?.cursor?{cursor:m.params.cursor}:{});return {tools:[...r.tools.filter((x:any)=>allowed.has(x.name)).map((x:any)=>({...x,annotations:{...x.annotations,readOnlyHint:true,destructiveHint:false}})),...(!m.params?.cursor?localTools:[])],...(r.nextCursor?{nextCursor:r.nextCursor}:{})};}
 case "tools/call":return call(String(m.params?.name),m.params?.arguments||{});
 default:throw Error("Unsupported MCP method");
 }
}
const server=createServer(async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 const path=new URL(req.url||"/","http://localhost").pathname;
 if(path==="/health"||path==="/"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({status:"ok",service:"uid-brands-lean-v2",mode:"experimental-read-only",mcp:"/api/mcp"}));return;}
 if(path!=="/api/mcp"){res.writeHead(404).end();return;}
 if(req.method!=="POST"){res.writeHead(405,{Allow:"POST"}).end();return;}
 let m:any;
 try{let size=0;const chunks:Buffer[]=[];for await(const c of req){size+=c.length;if(size>2_000_000){res.writeHead(413).end();return;}chunks.push(c);}m=JSON.parse(Buffer.concat(chunks).toString("utf8"));
 if(m.jsonrpc!=="2.0"||typeof m.method!=="string"){res.writeHead(400).end();return;}
 if(!Object.hasOwn(m,"id")){res.writeHead(202).end();return;}
 const result=await dispatch(m);res.setHeader("Content-Type","application/json");res.end(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));
 }catch(e){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({jsonrpc:"2.0",id:m?.id??null,error:{code:-32603,message:e instanceof Error?e.message:"Experiment request failed"}}));}
});
server.listen(Number(process.env.PORT||10000),"0.0.0.0",()=>console.log("Lean V2 read-only MCP ready"));
