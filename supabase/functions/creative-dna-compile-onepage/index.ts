import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildOnepagePacket } from "../_shared/onepage-packet.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const url=Deno.env.get("SUPABASE_URL")!; const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
let modern:string|undefined; try{modern=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"]}catch{}
const key=modern||legacy; const admin=key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors}); if(req.method!=="POST")return out({error:"POST required"},405); if(!admin)return out({error:"Server configuration unavailable"},500);
 let b:any={};try{b=await req.json()}catch{return out({error:"Invalid JSON"},400)}
 const brand=String(b.brand||"").trim(), sourceUrl=String(b.source_url||"").trim(), sourceType=String(b.source_type||"auto").trim().toLowerCase(), theme=String(b.theme||"").trim();
 if(!brand)return out({error:"brand is required"},400);
 const {data:r,error}=await admin.rpc("resolve_creative_dna_alias",{p_brand:brand,p_branch:"onepage-system"}); if(error)return out({error:"Resolver unavailable"},500); if(!r?.brand||!r?.branch)return out({error:"Onepage route not found"},404);
 try { return out(await buildOnepagePacket(r,{source_url:sourceUrl,source_type:sourceType,theme,research:b.research})); }
 catch { return out({error:"Unable to compile quality contract; check source_type and canonical contract"},422); }
});
