/** Evidence-bound, deterministic Onepage collection diversity & EO icon reporting gates.
 * No image pixels are inspected here. False self-attestation is not proof of actual QA.
 */
export const ONEPAGE_CREATIVE_QC_VERSION = "uid-onepage-creative-assets/2026-11-20.v4";
export const EO_ICON_DEFECTS = [
  "inconsistent_stroke_weight", "fragmented_or_noisy_details", "distorted_anatomy_or_geometry",
  "inconsistent_perspective_or_proportions", "unclear_small_size_silhouette",
  "off_brand_style_or_colors", "text_or_unwanted_background",
] as const;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 400;
const sourceUrl = (v: unknown) => typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v) && v.length <= 2000;
export const ONEPAGE_CREATIVE_QC_DESCRIPTION =
  "Onepage cross-section artwork diversity, content-to-visual proof and first-pass EO icons QA. Supply current task/version, verified PDP/collection design inventory and the final page-wide section-to-design mapping OR inspected icon list with explicit EO defects. The tool blocks repeated designs AND product/SKU overuse when verified alternatives exist, weak catalog coverage, fake diversity from changed crop/name/background, and visibly failed icons based on supplied inspection. Product Detail closeups may repeat the same anchor SKU but must use real differentiated details. This reports evidence, never scans image pixels. A clean report is not visual approval or authorization to publish.";
export const ONEPAGE_CREATIVE_QC_INPUT_SCHEMA = {
  type:"object", additionalProperties:false, required:["task_id","content_version","scope"],
  properties:{
    task_id:{type:"string",minLength:1,maxLength:160},content_version:{type:"string",minLength:1,maxLength:160},
    scope:{type:"string",enum:["design_diversity","eo_icons","post_story_choice","shot_diversity","content_visual_match"]},
    inventory:{type:"array",maxItems:200,items:{type:"object",additionalProperties:false,required:["product_id","design_id","pdp_url","visually_inspected"],properties:{
      product_id:{type:"string"},design_id:{type:"string"},pdp_url:{type:"string"},visually_inspected:{type:"boolean"}
    }}},
    placements:{type:"array",maxItems:100,items:{type:"object",additionalProperties:false,required:["slot","story_id","section","product_id","design_id"],properties:{
      slot:{type:"string"},story_id:{type:"string"},section:{type:"string",enum:["banner","occasion","why_you_love_it","ugc","product_details","other"]},product_id:{type:"string"},design_id:{type:"string"}
    }}},
    catalog_scan:{type:"object",additionalProperties:false,required:["scope","complete","has_more_pages","discovered_product_ids","inspected_product_ids"],properties:{
      scope:{type:"string",enum:["single_pdp","collection","explicit_family"]}, complete:{type:"boolean"},has_more_pages:{type:"boolean"},
      discovered_product_ids:{type:"array",maxItems:200,items:{type:"string"}},inspected_product_ids:{type:"array",maxItems:200,items:{type:"string"}}
    }},
    post_story:{type:"object",additionalProperties:false,required:["selected","pdp_evidence_urls","buyer_questions","gtk_insights","faq_questions","page_overlap_check","selection_reason"],properties:{
      selected:{type:"string",enum:["good_to_know","faqs"]},pdp_evidence_urls:{type:"array",maxItems:30,items:{type:"string"}},
      buyer_questions:{type:"array",maxItems:30,items:{type:"object",additionalProperties:false,required:["question","evidence_url","answer_supported"],properties:{question:{type:"string"},evidence_url:{type:"string"},answer_supported:{type:"boolean"}}}},
      gtk_insights:{type:"array",maxItems:20,items:{type:"object",additionalProperties:false,required:["insight","evidence_url","nonduplicative"],properties:{insight:{type:"string"},evidence_url:{type:"string"},nonduplicative:{type:"boolean"}}}},
      faq_questions:{type:"array",maxItems:20,items:{type:"string"}},page_overlap_check:{type:"boolean"},selection_reason:{type:"string"}
    }},
    visual_proofs:{type:"array",maxItems:80,items:{type:"object",additionalProperties:false,
      required:["slot","section","content_key","proof_target","proof_source_url","angle","framing","proof_visible","content_supported","generic_lifestyle","inspected_full_size","inspection_note"],
      properties:{
        slot:{type:"string"},section:{type:"string",enum:["banner","occasion","why_you_love_it","ugc","product_details","other"]},
        content_key:{type:"string"},proof_target:{type:"string"},proof_source_url:{type:"string"},
        angle:{type:"string",enum:["eye_level","elevated","top_down","side","three_quarter","over_shoulder","macro"]},
        framing:{type:"string",enum:["wide","medium","closeup","detail"]},
        proof_visible:{type:"boolean"},content_supported:{type:"boolean"},generic_lifestyle:{type:"boolean"},
        inspected_full_size:{type:"boolean"},inspection_note:{type:"string"}
      }}},
    shots:{type:"array",maxItems:60,items:{type:"object",additionalProperties:false,required:["slot","section","angle","framing","composition","product_id","visually_inspected"],properties:{
      slot:{type:"string"},section:{type:"string",enum:["occasion","why_you_love_it","ugc","product_details"]},
      angle:{type:"string",enum:["eye_level","elevated","top_down","side","three_quarter","over_shoulder","macro"]},
      framing:{type:"string",enum:["wide","medium","closeup","detail"]},composition:{type:"string"},product_id:{type:"string"},visually_inspected:{type:"boolean"}
    }}},
    icons:{type:"array",maxItems:30,items:{type:"object",additionalProperties:false,required:["slot","asset_id","reference_url","inspected_at_full_size","tested_at_small_size","evidence_note","defects"],properties:{
      slot:{type:"string"},asset_id:{type:"string"},reference_url:{type:"string"},inspected_at_full_size:{type:"boolean"},tested_at_small_size:{type:"boolean"},evidence_note:{type:"string"},
      defects:{type:"object",additionalProperties:false,required:[...EO_ICON_DEFECTS],properties:Object.fromEntries(EO_ICON_DEFECTS.map(flag=>[flag,{type:"boolean"}]))}
    }}}
  }
} as const;
export function onepageQcRecoveryPlan(issues:readonly string[],scope:string){
  const targets=[...new Set(issues.map(issue=>{
    const m=issue.match(/^EO_ICON_DEFECT:([^:]+):/);
    if(m)return m[1];
    const n=issue.match(/^(?:UNVERIFIED_EO_ICON|REUSED_ICON_ASSET|DUPLICATE_ICON_SLOT)$/);
    if(n)return "occasion_icons";
    const v=issue.match(/^(?:CONTENT_KEY_NOT_VISUALLY_PROVEN|GENERIC_LIFESTYLE_NOT_PROOF|REPEATED_COMPOSITION):([^:]+)/);
    return v?.[1]||"affected_slots";
  }))];
  return {
    state:issues.length?"NEEDS_IN_TASK_REPAIR":"HOST_VISUAL_QA_REQUIRED",
    owner_approval_required:false,
    terminal:false,
    defer_owner_review_until_qc_ready:issues.length>0,
    affected_slots:issues.length?targets:[],
    next_steps:issues.length?
      ["Keep existing task_id, source research, copy and passing assets unchanged",
       "For each affected slot use existing actual PNG/WebP and verified brand reference; correct palette/shape locally or regenerate only the failing icon",
       "Inspect corrected source pixels and desktop/mobile mapping, update manifest and re-run QC",
       "Proceed with remaining genuine Onepage work and packaging when all required visuals pass; no owner approval request for routine repairs"]:
      ["Inspect actual full-resolution assets and mapped desktop/mobile overall before declaring outcome complete"],
    hard_blocker_policy:"If asset bytes or a capable repair/render tool truly do not exist, name that exact unavailable dependency and return genuine partial files. Never claim correction or final QC pass.",
    scope,
  };
}
const result = (issues:string[], input:Record<string,any>, evidence:Record<string,unknown>={})=>({
  schema_version:ONEPAGE_CREATIVE_QC_VERSION,
  status: issues.length ? "BLOCKED" as const : "REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA" as const,
  can_release:false, pixel_inspected_by_server:false, task_id:input.task_id, content_version:input.content_version,
  scope:input.scope, issues:[...new Set(issues)], evidence,
  recovery:onepageQcRecoveryPlan([...new Set(issues)],String(input.scope||"unknown")),
  next_action:issues.length ? "Automatically repair ONLY failing local slots/icons in the same task with real asset bytes and current brand reference (use reversible raster recolor for icon palette drift when available); re-inspect actual images and rerun current QC. Do not ask owner for permission to fix routine generated visual defects or restart research. If no image editing tools or original files exist, preserve all completed assets and report the exact unresolved blocker; never label QC passed without real inspection." :
    "The host must still inspect actual full-size visuals and the overall desktop/mobile page; a self-report does not certify rendered quality.",
});
export function evaluateOnepageCreativeQc(input:unknown) {
  const invalid = (issue:string)=>result([issue],record(input)?input:{scope:"unknown"});
  if(!record(input)||!nonempty(input.task_id)||!nonempty(input.content_version)||!["design_diversity","eo_icons","post_story_choice","shot_diversity","content_visual_match"].includes(input.scope))
    return invalid("MISSING_TASK_VERSION_OR_SCOPE");
  const issues:string[]=[];
  if(input.scope==="post_story_choice") {
    const p=input.post_story;
    if(!record(p)||!["good_to_know","faqs"].includes(p.selected)||!Array.isArray(p.pdp_evidence_urls)||!p.pdp_evidence_urls.length||
       !p.pdp_evidence_urls.every(sourceUrl)||!Array.isArray(p.buyer_questions)||!Array.isArray(p.gtk_insights)||
       !Array.isArray(p.faq_questions)||p.page_overlap_check!==true||!nonempty(p.selection_reason)||p.selection_reason.trim().length<35)
      return invalid("POST_STORY_DECISION_EVIDENCE_MISSING");
    for(const q of p.buyer_questions)if(!record(q)||!nonempty(q.question)||!sourceUrl(q.evidence_url)||q.answer_supported!==true)
      issues.push("UNSUPPORTED_BUYER_QUESTION");
    for(const insight of p.gtk_insights)if(!record(insight)||!nonempty(insight.insight)||!sourceUrl(insight.evidence_url)||insight.nonduplicative!==true)
      issues.push("UNSUPPORTED_OR_DUPLICATE_GTK_INSIGHT");
    if(p.selected==="faqs") {
      if(p.faq_questions.length<2||p.buyer_questions.length<2)issues.push("FAQ_WITHOUT_REAL_BUYER_QUESTIONS");
      for(const question of p.faq_questions)if(!p.buyer_questions.some(q=>q.question===question&&q.answer_supported===true))
        issues.push("FAQ_QUESTION_NOT_EVIDENCE_BACKED");
    } else if(p.gtk_insights.length<2) issues.push("GTK_WITHOUT_ACTIONABLE_INSIGHTS");
    return result(issues,input,{selected:p.selected,verified_buyer_question_count:p.buyer_questions.length,
      gtk_insight_count:p.gtk_insights.length,decision_is_not_a_default:true,
      note:"URLs and supplied notes are not independent verification; the host must inspect the underlying sources."});
  }
  if(input.scope==="content_visual_match") {
    const proofs=input.visual_proofs;
    if(!Array.isArray(proofs)||!proofs.length||proofs.length>80)return invalid("MISSING_CONTENT_VISUAL_PROOF_MAP");
    const slots=new Set<string>(), evidenceTargets=new Map<string,string[]>();
    for(const p of proofs){
      if(!record(p)||!nonempty(p.slot)||!nonempty(p.section)||!["banner","occasion","why_you_love_it","ugc","product_details","other"].includes(p.section)||
         !nonempty(p.content_key)||!nonempty(p.proof_target)||!sourceUrl(p.proof_source_url)||
         !["eye_level","elevated","top_down","side","three_quarter","over_shoulder","macro"].includes(p.angle)||
         !["wide","medium","closeup","detail"].includes(p.framing)||
         typeof p.proof_visible!=="boolean"||typeof p.content_supported!=="boolean"||
         typeof p.generic_lifestyle!=="boolean"||typeof p.inspected_full_size!=="boolean"||
         !nonempty(p.inspection_note)||p.inspection_note.trim().length<40) {
        issues.push("INVALID_CONTENT_VISUAL_EVIDENCE:"+String(p?.slot||"unknown"));continue;
      }
      if(slots.has(p.slot))issues.push("DUPLICATE_PROOF_SLOT:"+p.slot);
      slots.add(p.slot);
      if(!p.inspected_full_size)issues.push("CONTENT_VISUAL_NOT_INSPECTED:"+p.slot);
      if(!p.proof_visible||!p.content_supported)issues.push("CONTENT_KEY_NOT_VISUALLY_PROVEN:"+p.slot);
      if(p.generic_lifestyle)issues.push("GENERIC_LIFESTYLE_NOT_PROOF:"+p.slot);
      const signature=p.section+"|"+p.content_key.trim().toLowerCase()+"|"+p.proof_target.trim().toLowerCase();
      if(!evidenceTargets.has(signature))evidenceTargets.set(signature,[]);
      evidenceTargets.get(signature)!.push(p.slot);
    }
    // More than one story asset using identical benefit + visible proof is an
    // editorial duplication even if camera angle or scenery changes.
    for(const slotsOfSameProof of evidenceTargets.values())
      if(slotsOfSameProof.length>1)issues.push("DUPLICATED_VISUAL_PROOF:"+slotsOfSameProof.join(","));
    return result(issues,input,{mapped_assets:proofs.length,distinct_proof_targets:evidenceTargets.size,
      note:"Checks supplied proof targets and reviewer findings, not the underlying pixels. Host must inspect real full-resolution images and verify evidence against the approved copy/PDP."});
  }
  if(input.scope==="shot_diversity") {
    const shots=input.shots;
    if(!Array.isArray(shots)||!shots.length||shots.length>60)return invalid("SHOT_PLAN_MISSING");
    const validAngles=["eye_level","elevated","top_down","side","three_quarter","over_shoulder","macro"];
    const validFraming=["wide","medium","closeup","detail"];
    const bySection=new Map<string,any[]>(),slots=new Set<string>();
    for(const shot of shots){
      if(!record(shot)||!nonempty(shot.slot)||!["occasion","why_you_love_it","ugc","product_details"].includes(shot.section)||
        !validAngles.includes(shot.angle)||!validFraming.includes(shot.framing)||!nonempty(shot.composition)||
        !nonempty(shot.product_id)||shot.visually_inspected!==true){issues.push("UNVERIFIED_SHOT:"+String(shot?.slot||"unknown"));continue}
      if(slots.has(shot.slot))issues.push("DUPLICATE_SHOT_SLOT:"+shot.slot);slots.add(shot.slot);
      if(!bySection.has(shot.section))bySection.set(shot.section,[]);
      bySection.get(shot.section)!.push(shot);
    }
    for(const [section,entries] of bySection){
      if(entries.length<2)continue;
      const angleCount=new Set(entries.map(x=>x.angle)).size;
      const framingCount=new Set(entries.map(x=>x.framing)).size;
      if(angleCount<2)issues.push("SAME_ANGLE_IN_SECTION:"+section);
      if(framingCount<2)issues.push("SAME_FRAMING_IN_SECTION:"+section);
      for(let i=1;i<entries.length;i++)
        if(entries[i-1].angle===entries[i].angle&&entries[i-1].framing===entries[i].framing&&entries[i-1].composition===entries[i].composition)
          issues.push("REPEATED_COMPOSITION:"+entries[i].slot);
    }
    return result(issues,input,{section_counts:Object.fromEntries([...bySection].map(([k,v])=>[k,v.length])),
      note:"Shot metadata is self-reported; final full-resolution image comparison is still required."});
  }
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
    const scan=input.catalog_scan;
    if(!record(scan)||!["single_pdp","collection","explicit_family"].includes(scan.scope)||
       scan.complete!==true||scan.has_more_pages!==false||
       !Array.isArray(scan.discovered_product_ids)||!scan.discovered_product_ids.length||
       !Array.isArray(scan.inspected_product_ids)||!scan.inspected_product_ids.length)issues.push("INCOMPLETE_PRODUCT_SCAN");
    else {
      const inspected=new Set(scan.inspected_product_ids);
      if(scan.discovered_product_ids.some((id:any)=>!nonempty(id)||!inspected.has(id)))issues.push("UNINSPECTED_DISCOVERED_PRODUCT");
      const invProducts=new Set([...inventory.values()].flatMap(ids=>[...ids]));
      if(scan.inspected_product_ids.some((id:any)=>!invProducts.has(id)))issues.push("INSPECTED_PRODUCT_MISSING_ARTWORK_INVENTORY");
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
    // Design variation alone is not product diversity: a single SKU with many artwork
    // options should not dominate an editorial page when distinct verified SKUs exist.
    // Paired desktop/mobile renditions of the same story count once. Product Detail
    // closeups remain deliberately exempt to preserve factual SKU continuity.
    const catalogProducts=new Set<string>();
    for(const products of inventory.values())for(const productId of products)catalogProducts.add(productId);
    const expectedProducts=Math.min(4,storyList.length,catalogProducts.size);
    const productsUsed=new Set(storyList.map(p=>p.product_id));
    if(productsUsed.size<expectedProducts)issues.push("INSUFFICIENT_DISTINCT_PRODUCTS");
    if(expectedProducts>1) {
      const productCounts=new Map<string,number>();
      for(const p of storyList)productCounts.set(p.product_id,(productCounts.get(p.product_id)||0)+1);
      const maxPerProduct=Math.ceil(storyList.length/expectedProducts);
      for(const [productId,count] of productCounts)if(count>maxPerProduct)issues.push("OVERUSED_PRODUCT:"+productId);
      for(let i=1;i<storyList.length;i++)
        if(storyList[i-1].product_id===storyList[i].product_id)issues.push("ADJACENT_PRODUCT_REPEAT:"+storyList[i].story_id);
    }
    return result(issues,input,{verified_design_count:inventory.size,source_pdp_count:sources.size,
      verified_product_count:catalogProducts.size, distinct_products_used:productsUsed.size,
      expected_distinct_products:expectedProducts,
      story_count:storyList.length, distinct_designs_used:used.size, expected_distinct_designs:expected,
      note:"Counts refer only to reported and visually inspected PDP entries, never a claim of all store designs or products."});
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
