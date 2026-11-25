import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildOnepagePacket } from "../_shared/onepage-packet.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const url=Deno.env.get("SUPABASE_URL")!; const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
let modern:string|undefined; try{modern=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"]}catch{}
const key=modern||legacy; const admin=key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;

async function discoverPublicClipo(brand:string) {
 const discovery:any={stage:"CLIPO_REFERENCE_DISCOVERY",attempted:true,access:"public",
   status:"unavailable",matches:[],opened:[],visual_inspection_required:true,continue_task:true};
 const origin="https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/clipo-research-refs/mcp";
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
 let id=0;
 async function rpc(name:string,args:Record<string,unknown>){
   const response=await fetch(origin,{method:"POST",headers:{
     "Content-Type":"application/json","Accept":"application/json, text/event-stream",
     "MCP-Protocol-Version":"2025-06-18"},signal:controller.signal,
     body:JSON.stringify({jsonrpc:"2.0",id:++id,method:"tools/call",params:{name,arguments:args}})});
   if(!response.ok)throw Error("reader_http_"+response.status);
   const body=await response.json();
   if(body.error||!body.result||body.result.isError)throw Error("reader_invalid_response");
   return body.result;
 }
 try {
   for(const slot of ["banner mobile","banner desktop","overall","product details"]){
     const response=await rpc("search_reference_packs",{brand,task:"Onepage",slot,limit:3});
     const body=response.structuredContent||JSON.parse(response.content?.find((v:any)=>v.type==="text")?.text||"{}");
     for(const ref of (Array.isArray(body.matches)?body.matches:[])){
       if(typeof ref.pack!=="string"||typeof ref.ref_id!=="string")continue;
       discovery.matches.push({slot,pack:ref.pack,ref_id:ref.ref_id,source:ref.source,
         role:ref.role,use_for:ref.use_for,product_family:ref.product_family});
     }
   }
   for(const ref of discovery.matches.slice(0,2)){
     try{
       const response=await rpc("open_reference_image",{brand,pack:ref.pack,ref_id:ref.ref_id});
       const meta=JSON.parse(response.content?.find((v:any)=>v.type==="text")?.text||"{}");
       const media=response.content?.find((v:any)=>v.type==="image");
       if(meta.status==="ok"&&typeof media?.data==="string"&&media.data.length>32)
         discovery.opened.push({slot:ref.slot,pack:ref.pack,ref_id:ref.ref_id,
           source:ref.source,status:"opened",mime_type:media.mimeType});
     }catch{/* Recordable search succeeded but image-open did not; do not claim visual inspection. */}
   }
   discovery.status=discovery.opened.length?"references_opened":discovery.matches.length?"matches_unopened":"no_match";
 }catch(e){
   discovery.status="unavailable";
   discovery.error=e instanceof Error&&e.name==="AbortError"?"timeout":"reader_unavailable";
 }finally{clearTimeout(timer);}
 return discovery;
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors}); if(req.method!=="POST")return out({error:"POST required"},405); if(!admin)return out({error:"Server configuration unavailable"},500);
 let b:any={};try{b=await req.json()}catch{return out({error:"Invalid JSON"},400)}
 const brand=String(b.brand||"").trim(), sourceUrl=String(b.source_url||"").trim(), sourceType=String(b.source_type||"auto").trim().toLowerCase(), theme=String(b.theme||"").trim();
 if(!brand)return out({error:"brand is required"},400);
 const {data:r,error}=await admin.rpc("resolve_creative_dna_alias",{p_brand:brand,p_branch:"onepage-system"}); if(error)return out({error:"Resolver unavailable"},500); if(!r?.brand||!r?.branch)return out({error:"Onepage route not found"},404);
 try {
 const packet:any=await buildOnepagePacket(r,{source_url:sourceUrl,source_type:sourceType,theme,research:b.research});
 const reference=await discoverPublicClipo(brand);
 packet.clipo_reference_discovery=reference;
 packet.clipo_reference_contract={
   mandatory_attempt:true,visual_inspection_required:true,
   next_step:"Open selected reference pixels in the authorized Clipo MCP before using their artistic guidance.",
   team_reader:"/functions/v1/clipo-research-refs/member/mcp",
   access_note:"This upstream public compiler only opens public images. The member-authenticated UID gateway must upgrade discovery for team refs.",
   fallback:"Continue canonical Onepage workflow on no_match, timeout or authorization failure.",
   no_automatic_eo_approval:true};
 if(Array.isArray(packet.execution)&&!packet.execution.includes("CLIPO_REFERENCE_DISCOVERY")){
   const j=packet.execution.indexOf("VALIDATE_RESEARCH_BEFORE_CONTENT");
   packet.execution.splice(j>=0?j+1:0,0,"CLIPO_REFERENCE_DISCOVERY");
 }
 return out(packet);
 }
 catch { return out({error:"Unable to compile quality contract; check source_type and canonical contract"},422); }
});
