/** Evidence-bound, deterministic Onepage collection diversity & EO icon reporting gates.
 * No image pixels are inspected here. False self-attestation is not proof of actual QA.
 */
export const ONEPAGE_CREATIVE_QC_VERSION = "uid-onepage-creative-assets/2026-11-11.v1";
export const EO_ICON_DEFECTS = [
  "inconsistent_stroke_weight", "fragmented_or_noisy_details", "distorted_anatomy_or_geometry",
  "inconsistent_perspective_or_proportions", "unclear_small_size_silhouette",
  "off_brand_style_or_colors", "text_or_unwanted_background",
] as const;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 400;
const sourceUrl = (v: unknown) => typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v) && v.length <= 2000;
export const ONEPAGE_CREATIVE_QC_DESCRIPTION =
  "Onepage cross-section artwork diversity and first-pass EO icons QA. Supply current task/version, verified PDP/collection design inventory and the final page-wide section-to-design mapping OR inspected icon list with explicit EO defects. The tool blocks repeated designs, weak catalog coverage, fake diversity from changed crop/name/background, and visibly failed icons based on supplied inspection. Product Detail closeups may repeat the same anchor SKU but must use real differentiated details. This reports evidence, never scans image pixels. A clean report is not visual approval or authorization to publish.";
export const ONEPAGE_CREATIVE_QC_INPUT_SCHEMA = {
  type:"object", additionalProperties:false, required:["task_id","content_version","scope"],
  properties:{
    task_id:{type:"string",minLength:1,maxLength:160},content_version:{type:"string",minLength:1,maxLength:160},
    scope:{type:"string",enum:["design_diversity","eo_icons"]},
    inventory:{type:"array",maxItems:200,items:{type:"object",additionalProperties:false,required:["product_id","design_id","pdp_url","visually_inspected"],properties:{
      product_id:{type:"string"},design_id:{type:"string"},pdp_url:{type:"string"},visually_inspected:{type:"boolean"}
    }}},
    placements:{type:"array",maxItems:100,items:{type:"object",additionalProperties:false,required:["slot","story_id","section","product_id","design_id"],properties:{
      slot:{type:"string"},story_id:{type:"string"},section:{type:"string",enum:["banner","occasion","why_you_love_it","ugc","product_details","other"]},product_id:{type:"string"},design_id:{type:"string"}
    }}},
    icons:{type:"array",maxItems:30,items:{type:"object",additionalProperties:false,required:["slot","asset_id","reference_url","inspected_at_full_size","tested_at_small_size","evidence_note","defects"],properties:{
      slot:{type:"string"},asset_id:{type:"string"},reference_url:{type:"string"},inspected_at_full_size:{type:"boolean"},tested_at_small_size:{type:"boolean"},evidence_note:{type:"string"},
      defects:{type:"object",additionalProperties:false,required:[...EO_ICON_DEFECTS],properties:Object.fromEntries(EO_ICON_DEFECTS.map(flag=>[flag,{type:"boolean"}]))}
    }}}
  }
} as const;
const result = (issues:string[], input:Record<string,any>, evidence:Record<string,unknown>={})=>({
  schema_version:ONEPAGE_CREATIVE_QC_VERSION,
  status: issues.length ? "BLOCKED" as const : "REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA" as const,
  can_release:false, pixel_inspected_by_server:false, task_id:input.task_id, content_version:input.content_version,
  scope:input.scope, issues:[...new Set(issues)], evidence,
  next_action:issues.length ? "Fix selected slots or icons, inspect real source images and rerun on current task/version before showing overall/packaging." :
    "The host must still inspect actual full-size visuals and the overall desktop/mobile page; a self-report does not certify rendered quality.",
});
export function evaluateOnepageCreativeQc(input:unknown) {
  const invalid = (issue:string)=>result([issue],record(input)?input:{scope:"unknown"});
  if(!record(input)||!nonempty(input.task_id)||!nonempty(input.content_version)||!["design_diversity","eo_icons"].includes(input.scope))
    return invalid("MISSING_TASK_VERSION_OR_SCOPE");
  const issues:string[]=[];
  if(input.scope==="design_diversity") {
    if(!Array.isArray(input.inventory)||!input.inventory.length||input.inventory.length>200||
       !Array.isArray(input.placements)||!input.placements.length||input.placements.length>100)
      return invalid("MISSING_INVENTORY_OR_PAGE_MAP");
    const inventory = new Map<string,Set<string>>();
    const sources = new Set<string>();
    for(const entry of input.inventory) {
      if(!record(entry)||!nonempty(entry.product_id)||!nonempty(entry.design_id)||!sourceUrl(entry.pdp_url)||
         entry.visually_inspected!==true) {issues.push("UNVERIFIED_CATALOG_ARTWORK");continue;}
      if(!inventory.has(entry.design_id)) inventory.set(entry.design_id,new Set());
      inventory.get(entry.design_id)!.add(entry.product_id);
      sources.add(entry.pdp_url);
    }
    if(!inventory.size)issues.push("NO_VERIFIED_DESIGNS");
    const stories=new Map<string,any>();const slots=new Set<string>();const details:any[]=[];
    for(const p of input.placements) {
      if(!record(p)||!nonempty(p.slot)||!nonempty(p.story_id)||!nonempty(p.product_id)||
         !nonempty(p.design_id)||!["banner","occasion","why_you_love_it","ugc","product_details","other"].includes(p.section)){
        issues.push("INVALID_PAGE_PLACEMENT");continue;
      }
      if(slots.has(p.slot))issues.push("DUPLICATE_ASSET_SLOT");
      slots.add(p.slot);
      if(!inventory.get(p.design_id)?.has(p.product_id))issues.push("PLACEMENT_NOT_PROVEN_BY_PDP:"+p.slot);
      if(p.section==="product_details"){details.push(p);continue;}
      if(stories.has(p.story_id)) {
        const prev=stories.get(p.story_id);
        if(prev.design_id!==p.design_id||prev.product_id!==p.product_id)issues.push("INCONSISTENT_STORY_VARIANTS:"+p.story_id);
      } else stories.set(p.story_id,p);
    }
    if(details.length && new Set(details.map(p=>p.product_id)).size>1)issues.push("PRODUCT_DETAILS_ANCHOR_SKU_CHANGED");
    const storyList=[...stories.values()];
    const used =new Set(storyList.map(p=>p.design_id));
    const expected =Math.min(4,storyList.length,inventory.size);
    if(used.size<expected)issues.push("INSUFFICIENT_DISTINCT_DESIGNS");
    const counts=new Map<string,number>();
    for(const p of storyList)counts.set(p.design_id,(counts.get(p.design_id)||0)+1);
    if(expected>1) {
      const maxPerDesign=Math.ceil(storyList.length/expected);
      for(const [designId,count] of counts)if(count>maxPerDesign)issues.push("OVERUSED_DESIGN:"+designId);
      for(let i=1;i<storyList.length;i++)
        if(storyList[i-1].design_id===storyList[i].design_id)issues.push("ADJACENT_REPEAT:"+storyList[i].story_id);
    }
    return result(issues,input,{verified_design_count:inventory.size,source_pdp_count:sources.size,
      story_count:storyList.length, distinct_designs_used:used.size, expected_distinct_designs:expected,
      note:"Counts refer only to reported and visually inspected PDP entries, never a claim of all store designs."});
  }
  if(!Array.isArray(input.icons)||!input.icons.length||input.icons.length>30)return invalid("MISSING_EO_ICON_INSPECTIONS");
  const slots=new Set<string>();const assetIds=new Set<string>();
  for(const icon of input.icons){
    if(!record(icon)||!nonempty(icon.slot)||!nonempty(icon.asset_id)||!sourceUrl(icon.reference_url)||
       icon.inspected_at_full_size!==true||icon.tested_at_small_size!==true||
       !nonempty(icon.evidence_note)||icon.evidence_note.trim().length<40) {issues.push("UNVERIFIED_EO_ICON");continue;}
    if(slots.has(icon.slot))issues.push("DUPLICATE_ICON_SLOT");slots.add(icon.slot);
    if(assetIds.has(icon.asset_id))issues.push("REUSED_ICON_ASSET");assetIds.add(icon.asset_id);
    if(!record(icon.defects)||Object.keys(icon.defects).length!==EO_ICON_DEFECTS.length||
       EO_ICON_DEFECTS.some(flag=>typeof icon.defects[flag]!=="boolean"))issues.push("INCOMPLETE_EO_FLAGS:"+icon.slot);
    else for(const flag of EO_ICON_DEFECTS)if(icon.defects[flag])issues.push("EO_ICON_DEFECT:"+icon.slot+":"+flag);
  }
  return result(issues,input,{inspected_icons:input.icons.length,verified_reference_slots:slots.size,
    note:"EO consistency and physical fidelity require actual first-pass visual checks by the host."});
}
