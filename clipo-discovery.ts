/** Clipo reference discovery is external/read-only and never overrides UID creative rules.
 * Team reads require the caller's real UID bearer; otherwise only public packs are read.
 */
const ROOT="https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/clipo-research-refs";
const SLOTS=["banner desktop","banner mobile","overall","product details","why youll love it"] as const;
type Reference={slot:string;pack:string;ref_id:string;role:string;source:string;use_for:string;product_family:string;approval_source:string|null};
export type ClipoDiscovery={
  stage:"CLIPO_REFERENCE_DISCOVERY";attempted:true;status:string;access:"team"|"public";
  matches:Reference[];opened:Array<{slot:string;pack:string;ref_id:string;mime_type:string;source:string;image_open_verified:true}>;
  diagnostics:Array<{slot?:string;status:string}>;visual_inspection_required:true;continue_task:true;
};
export async function discoverClipoReferences(brand:string,memberAuthorization?:string|null,
 fetcher:typeof fetch=fetch, timeoutMs=6500, productFamily?:string):Promise<ClipoDiscovery>{
 const bearer=/^Bearer ([^\s]{1,8192})$/i.exec(memberAuthorization||"");
 const access=bearer?"team":"public";
 const state:ClipoDiscovery={stage:"CLIPO_REFERENCE_DISCOVERY",attempted:true,status:"unavailable",access,
   matches:[],opened:[],diagnostics:[],visual_inspection_required:true,continue_task:true};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 const endpoint=ROOT+(bearer?"/member/mcp":"/mcp");
 let id=0;
 async function call(name:string,args:Record<string,unknown>){
   const res=await fetcher(endpoint,{method:"POST",headers:{"Content-Type":"application/json",
     "Accept":"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18",
     ...(bearer?{Authorization:memberAuthorization!}:{})},
     body:JSON.stringify({jsonrpc:"2.0",id:++id,method:"tools/call",params:{name,arguments:args}}),
     signal:controller.signal});
   if(!res.ok)throw new Error("http_"+res.status);
   const body=await res.json();
   if(body.error||!body.result||body.result.isError)throw new Error("mcp_error");
   return body.result;
 }
 try{
   for(const slot of SLOTS){
     const response=await call("search_reference_packs",{brand,task:"Onepage",slot,limit:4,...(productFamily?{product_family:productFamily}:{})});
     const json=response.structuredContent||JSON.parse(response.content?.find((x:any)=>x.type==="text")?.text||"{}");
     if(!["matched","partial","no_match"].includes(json.status)) {
       state.diagnostics.push({slot,status:"unexpected_search_status"});continue;
     }
     for(const m of (Array.isArray(json.matches)?json.matches:[])){
       if(typeof m.pack==="string"&&typeof m.ref_id==="string")
       state.matches.push({slot,pack:m.pack,ref_id:m.ref_id,role:m.role,source:m.source,
         use_for:m.use_for,product_family:m.product_family,approval_source:m.approval_source||null});
     }
     state.diagnostics.push({slot,status:json.status});
   }
   for(const match of state.matches.slice(0,3)){
     try{
       const result=await call("open_reference_image",{brand,pack:match.pack,ref_id:match.ref_id});
       const meta=JSON.parse(result.content?.find((x:any)=>x.type==="text")?.text||"{}");
       const image=result.content?.find((x:any)=>x.type==="image");
       if(meta.status==="ok"&&image?.mimeType?.startsWith("image/")&&
          typeof image.data==="string"&&image.data.length>32) {
         state.opened.push({slot:match.slot,pack:match.pack,ref_id:match.ref_id,
           mime_type:image.mimeType,source:match.source,image_open_verified:true});
       } else state.diagnostics.push({slot:match.slot,status:"image_unavailable"});
     }catch{state.diagnostics.push({slot:match.slot,status:"image_open_failed"});}
   }
   state.status=state.opened.length?"references_opened":state.matches.length?"matches_unopened":"no_match";
 }catch(e){
   const msg=e instanceof Error?e.message:"read_failed";
   state.status=msg==="http_401"||msg==="http_403"?"authorization_required":"unavailable";
   state.diagnostics.push({status:msg==="AbortError"?"timeout":msg});
 }finally{clearTimeout(timer);}
 return state;
}
