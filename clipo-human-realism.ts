/**
 * Read-only Clipo Human Realism Reference Library.
 * Parallel to Creative DNA. Human images are photographed study references,
 * not identity templates, training consent, approved product mocks or proof of ethnicity.
 */
const CLIPO="https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/clipo-research-refs/mcp";
type HumanRef={ref_id:string;title:string;source_url:string;license_url:string;
 action:string;camera_angle:string;frame_type:string;body_focus:string;
 setting:string;interaction:string;lighting:string;study_notes:string;
 failure_checks:string[];tags:string[]};
export type HumanRealismResult={
 stage:"HUMAN_REALISM_REFERENCE_DISCOVERY";attempted:true;
 status:"images_opened"|"matches_unopened"|"no_match"|"unavailable";
 mode:"public_clipo" ; context_action:string|null;
 sort_dimensions:string[];matches:HumanRef[];
 opened:Array<{ref_id:string;source_url:string;mime_type:string;image_bytes:number;pixel_delivery_confirmed:true;study_notes:string;failure_checks:string[]}>;
 mcp_trace:Array<{operation:string;status:string;ref_id?:string}>;
 requires_visual_review:true;continue_task:true;
};
export function actionForHumanScene(brief:string):string|null{
 const text=brief.toLowerCase();
 if(/apron|kitchen|cook|baking|bake|recipe|cutting.board|table.runner/.test(text))return "cooking";
 if(/dog|cat|pet|leash|doormat/.test(text))return "walking_dog";
 if(/book|reading|bookmark|journal/.test(text))return "reading";
 if(/ornament|christmas|gift|valentine|anniversary|wedding|jewelry|necklace/.test(text))return "gift_exchange";
 if(/pillow|plush|memory|unbox|unpack|opening/.test(text))return "unboxing";
 return null;
}
export async function discoverHumanRealism(brief:string,
 fetcher:typeof fetch=fetch,timeoutMs=19000):Promise<HumanRealismResult>{
 const action=actionForHumanScene(brief);
 const state:HumanRealismResult={
  stage:"HUMAN_REALISM_REFERENCE_DISCOVERY",attempted:true,
  status:"unavailable",mode:"public_clipo",context_action:action,
  sort_dimensions:["action","camera_angle","body_focus","interaction","setting","lighting","life_stage","tags"],
  matches:[],opened:[],mcp_trace:[],requires_visual_review:true,continue_task:true
 };
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 let n=0;
 async function rpc(name:string,args:Record<string,unknown>){
  const res=await fetcher(CLIPO,{method:"POST",headers:{
   "Content-Type":"application/json","Accept":"application/json, text/event-stream",
   "MCP-Protocol-Version":"2025-06-18"},
   body:JSON.stringify({jsonrpc:"2.0",id:++n,method:"tools/call",params:{name,arguments:args}}),
   signal:controller.signal});
  if(!res.ok)throw Error("mcp_http_"+res.status);
  const payload=await res.json();
  if(payload.error||!payload.result||payload.result.isError)throw Error("mcp_rpc_failure");
  return payload.result;
 }
 try{
  const searchResult=await rpc("search_human_realism_refs",{
   ...(action?{action}:{}),limit:8});
  const data=searchResult.structuredContent||
   JSON.parse(searchResult.content?.find((x:any)=>x.type==="text")?.text||"{}");
  state.mcp_trace.push({operation:"search_human_realism_refs",status:data.status||"invalid_response"});
  if(!Array.isArray(data.matches))throw Error("search_matches_missing");
  state.matches=data.matches.slice(0,8).filter((r:any)=>typeof r.ref_id==="string") as HumanRef[];
  // Open real pixels. Do not claim the AI has visually inspected them:
  // the creative agent must inspect the selected source image URLs before generation.
  for(const ref of state.matches.slice(0,5)){
   if(state.opened.length>=2)break;
   try{
    const opened=await rpc("open_human_realism_ref",{ref_id:ref.ref_id});
    const meta=JSON.parse(opened.content?.find((x:any)=>x.type==="text")?.text||"{}");
    const image=opened.content?.find((x:any)=>x.type==="image");
    const success=meta.status==="ok"&&image?.mimeType==="image/jpeg"&&
      typeof image?.data==="string"&&image.data.length>128;
    state.mcp_trace.push({operation:"open_human_realism_ref",ref_id:ref.ref_id,
       status:success?"image_payload_received":meta.status||"invalid_image"});
    if(success)state.opened.push({ref_id:ref.ref_id,source_url:ref.source_url,
      mime_type:image.mimeType,image_bytes:meta.image_bytes||0,
      pixel_delivery_confirmed:true,study_notes:ref.study_notes,
      failure_checks:ref.failure_checks||[]});
   }catch{state.mcp_trace.push({operation:"open_human_realism_ref",ref_id:ref.ref_id,status:"unavailable"});}
  }
  state.status=state.opened.length?"images_opened":state.matches.length?"matches_unopened":"no_match";
 }catch{state.mcp_trace.push({operation:"discovery",status:"unavailable"});state.status="unavailable";}
 finally{clearTimeout(timer);}
 return state;
}
export const HUMAN_REALISM_QC={
 enable_for:"All UID Brands images containing human subjects",
 reference_rule:"Before scene generation choose references matched to action, pose, camera and contact. Visually inspect the actual image; tool receipt alone is not enough.",
 product_rule:"Actual PDP product geometry and material always supersede generic reference object",
 body_integrity:["two anatomically plausible arms and legs per visible person","five fingers on each clearly visible hand","correct wrist thumb joint and elbow direction","joint bends within natural range","consistent limb length, foreshortening and shoulder alignment"],
 physics:["feet and hips grounded to supports","natural center of mass","object supported by real grip and contact shadow","no floating packaging or rigid leash","correct fabric compression, ribbon tension and soft shadows"],
 face:["natural imperfect skin texture","plausible teeth and eye gaze","asymmetrical candid expression","age-appropriate proportions","avoid plastic or over-smoothed faces"],
 camera:["plausible perspective and scale","real candid POV, overhead, over-the-shoulder or eye-level geometry","natural light direction and depth of field"],
 casting_note:"Target casting can be specified as white-presenting people in US lifestyle imagery; photo references do not prove people's identity, nationality or ethnicity.",
 generation_gate:"Regenerate human details whenever hands, limbs, body support, product contact, physical forces or facial geometry fail. Never approve a beautiful but anatomically wrong scene.",
 avoid:["AI-face symmetry","duplicate fingers or fused hands","disconnected wrists","extra limbs","twisted knees or floating feet","impossible object grip","mismatched shadows"]
} as const;
