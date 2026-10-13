import { attachResearch } from "../_shared/product-research.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { compileCreativeQuality } from "../_shared/creative-quality.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Cache-Control":"no-store"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
let modern:string|undefined; try{modern=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"]}catch{}
const key=modern||legacy; const admin=key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(!["GET","POST"].includes(req.method))return out({error:"GET or POST required"},405);
 if(!admin)return out({error:"Server configuration unavailable"},500);
 const u=new URL(req.url);let b:any={};if(req.method==="POST"){try{b=await req.json()}catch{}}
 const action=String(b.action??u.searchParams.get("action")??"resolve").toLowerCase();
 if(action==="routes"){const {data,error}=await admin.rpc("list_creative_dna_routes");return error?out({error:"Resolver unavailable"},500):out({api_version:"1.1",mode:"read_only",routes:data});}
 const brand=b.brand??b.brand_slug??u.searchParams.get("brand"),branch=b.branch??b.target_slug??u.searchParams.get("branch");
 if(!brand||!branch)return out({error:"brand and branch are required",examples:["PawfectHouse / Onepage","GiftSoul / LDP Hero","SoulPrise / Onepage"]},400);
 const {data,error}=await admin.rpc("resolve_creative_dna_alias",{p_brand:String(brand),p_branch:String(branch)});
 if(error)return out({error:"Resolver unavailable"},500);if(!data?.brand||!data?.branch)return out({error:"Creative DNA route not found"},404);
 const researchContext={source_url:b.source_url??u.searchParams.get("source_url")??undefined,source_type:b.source_type??u.searchParams.get("source_type")??undefined,research:b.research};
 const withResearch=(value:any)=>attachResearch(value,researchContext);
 // Preserve legacy behavior for branches outside this reviewed Onepage rollout.
 if(data.branch.slug!=="onepage-system" && !data.branch.metadata?.creative_quality_contract) return out(withResearch({api_version:"1.1",mode:"read_only",generate:false,requested:{brand,branch},resolved:{brand:data.brand?.slug,branch:data.branch?.slug},instruction:"Current Creative DNA runtime context. Read-only: never train, approve, update, or delete.",...data}));
 const quality = await compileCreativeQuality(data);
 return out(withResearch({...data,api_version:"1.2",mode:"read_only",generate:false,requested:{brand,branch},resolved:{brand:data.brand?.slug,branch:data.branch?.slug,quality_revision:quality.revision,quality_contract_hash:quality.contract_hash},creative_quality_contract:quality,instruction:"Current Creative DNA runtime context. Read-only. For compiled routes use active scoped creative_quality_contract rules. Historical prose remains evidence, not authority over superseded rules. Reference Library examples are optional supplementary inspiration, never fixed seeds or universal style. An empty library or unavailable example does not block creation. Active brand/product rules and product-evidence inspection remain mandatory. Surface a BLOCKED quality contract or missing explicitly required evidence; do not silently fall back to account memory. Uncompiled routes require source review before claiming quality consistency."}));
});
