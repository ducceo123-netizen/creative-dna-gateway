/** Cross-account, evidence-first Onepage EO quality reference intelligence.
 * Deterministic reference-ranking and outcome quality review. No network fetch:
 * host must inspect actual live same-brand Onepage images and report provenance.
 * A live page is NOT automatically approved EO. Do not imitate reference composition.
 */
export const EO_REFERENCE_INTELLIGENCE_VERSION="uid-onepage-eo-reference-intelligence/2026-11-21.v1";
export const EO_REFERENCE_INTELLIGENCE_DESCRIPTION="Build a repeatable EO quality-bar packet from host-inspected, same-brand existing Onepage results. For each new Onepage, scan relevant previous store Onepages (prefer exact product type, then function/material, then recipient/occasion); input only genuine image-verified references. The tool ranks 3-5 results when possible, flags unapproved/uninspected pages, and returns evidence-based quality targets WITHOUT copying prior layouts, subjects, icons, wording or artwork. A live page is not assumed approved. This tool does not fetch/store pages or claim pixel inspection. Continue Gateway-only workflow if references are unavailable; do not halt materials.";
export const EO_OUTCOME_COMPARISON_DESCRIPTION="Review a new Onepage outcome against quality targets from actual same-brand EO references (not visual sameness). Fail generic/low-quality presentation or excessive replication of old creative; require current source images and desktop/mobile inspection. Fix affected slots within the same task. This tool checks reported inspections; does not itself inspect pixels.";
export const EO_REF_CATEGORIES=["banner_typography","banner_composition","icons","occasion","why_you_love_it","product_details","mobile"] as const;
export type EoCategory=typeof EO_REF_CATEGORIES[number];
type Candidate={id:string;brand:string;page_url:string;product_type:string;use_cases:string[];materials:string[];recipients:string[];occasions:string[];approved:boolean;inspection:{desktop:boolean;mobile:boolean};image_urls:string[];quality_notes:Partial<Record<EoCategory,string>>};
type Brief={brand:string;product_type:string;use_cases:string[];materials:string[];recipients:string[];occasions:string[]};
type RefInput={brief:Brief;store_origin:string;scan_complete:boolean;candidates:Candidate[]};
const clean=(v:string)=>v.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
const nonempty=(x:unknown)=>typeof x==="string"&&x.trim().length>0&&x.length<1000;
const url=(x:unknown)=>typeof x==="string"&&/^https:\/\/[^/\s]+/i.test(x)&&x.length<2000;
const sameDomain=(a:string,b:string)=>{try{const strip=(h:string)=>h.toLowerCase().replace(/^www\./,"");return strip(new URL(a).hostname)===strip(new URL(b).hostname);}catch{return false;}};
const setOf=(arr:string[])=>new Set(arr.filter(nonempty).map(clean));
const overlap=(a:string[],b:string[])=>{const aSet=setOf(a);return [...setOf(b)].filter(x=>aSet.has(x)).length;};
const okArr=(x:unknown,max:number)=>Array.isArray(x)&&x.length<=max&&x.every(nonempty);
const scoreCandidate=(b:Brief,c:Candidate)=>{
 const exact=clean(b.product_type)===clean(c.product_type);
 const functions=overlap(b.use_cases,c.use_cases),materials=overlap(b.materials,c.materials);
 const audience=overlap(b.recipients,c.recipients),occasion=overlap(b.occasions,c.occasions);
 const score=(exact?100:0)+Math.min(2,functions)*24+Math.min(2,materials)*15+Math.min(2,audience)*8+Math.min(2,occasion)*5;
 return {score,reasons:[exact?"EXACT_PRODUCT_TYPE":null,functions?"SHARED_FUNCTION":null,materials?"SHARED_MATERIAL":null,audience?"SHARED_RECIPIENT":null,occasion?"SHARED_OCCASION":null].filter(Boolean)};
};
export function buildOnepageEoReferencePack(input:unknown){
 const base={schema_version:EO_REFERENCE_INTELLIGENCE_VERSION,server_pixel_inspected:false,creative_copying_allowed:false,studio_dependency:false,visual_similarity_is_target:false};
 if(!input||typeof input!=="object"||Array.isArray(input))return {...base,status:"INVALID_INPUT",issues:["MISSING_INPUT"]};
 const q=input as RefInput;
 const b=q.brief;
 if(!b||!nonempty(b.brand)||!nonempty(b.product_type)||!url(q.store_origin)||
   !okArr(b.use_cases,30)||!okArr(b.materials,30)||!okArr(b.recipients,30)||!okArr(b.occasions,30)||
   !Array.isArray(q.candidates)||q.candidates.length>100)
   return {...base,status:"INVALID_INPUT",issues:["INVALID_BRIEF_OR_CANDIDATES"]};
 const issues:string[]=[];
 if(q.scan_complete!==true)issues.push("REFERENCE_SCAN_PARTIAL");
 const seen=new Set<string>(); const eligible:{candidate:Candidate;score:number;reasons:(string|null)[]}[]=[];
 let rejected=0;
 for(const c of q.candidates){
   if(!c||!nonempty(c.id)||!nonempty(c.brand)||!url(c.page_url)||!nonempty(c.product_type)||
      !okArr(c.use_cases,30)||!okArr(c.materials,30)||!okArr(c.recipients,30)||!okArr(c.occasions,30)||
      !Array.isArray(c.image_urls)||c.image_urls.length<1||c.image_urls.length>16||!c.image_urls.every(url)||
      !c.inspection||typeof c.inspection.desktop!=="boolean"||typeof c.inspection.mobile!=="boolean"||
      !c.quality_notes||typeof c.quality_notes!=="object"||Array.isArray(c.quality_notes)||
      Object.entries(c.quality_notes).some(([k,v])=>!EO_REF_CATEGORIES.includes(k as EoCategory)||!nonempty(v))){
     issues.push("INVALID_REFERENCE_ENTRY");rejected++;continue;
   }
   if(seen.has(c.id)||seen.has(c.page_url)){issues.push("DUPLICATE_REFERENCE");rejected++;continue;}
   seen.add(c.id);seen.add(c.page_url);
   if(clean(c.brand)!==clean(b.brand)||!sameDomain(c.page_url,q.store_origin)){
     issues.push("CROSS_BRAND_REFERENCE_EXCLUDED");rejected++;continue;
   }
   if(c.approved!==true||c.inspection.desktop!==true||c.inspection.mobile!==true||
      !Object.keys(c.quality_notes).length){rejected++;continue;}
   const ranking=scoreCandidate(b,c);
   eligible.push({candidate:c,...ranking});
 }
 eligible.sort((a,z)=>z.score-a.score||a.candidate.id.localeCompare(z.candidate.id));
 const selected=eligible.slice(0,5);
 const qualityBars:Partial<Record<EoCategory,{source_ids:string[];observations:string[]}>>={};
 for(const x of selected){
   for(const [section,note] of Object.entries(x.candidate.quality_notes)){
     const key=section as EoCategory;
     if(!qualityBars[key])qualityBars[key]={source_ids:[],observations:[]};
     qualityBars[key]!.source_ids.push(x.candidate.id);
     qualityBars[key]!.observations.push(note);
   }
 }
 return {...base,status:selected.length?"QUALITY_BAR_REFERENCES_REPORTED":"REFERENCE_UNAVAILABLE_CONTINUE_CANONICAL_DNA",
   issues,scan_complete:q.scan_complete===true,approved_verified_reference_count:eligible.length,
   rejected_candidate_count:rejected,
   ranked_references:selected.map(({candidate,score,reasons})=>({id:candidate.id,page_url:candidate.page_url,product_type:candidate.product_type,
     inspected_image_urls:candidate.image_urls,score,reasons,quality_notes:candidate.quality_notes})),
   quality_bar:qualityBars,
   independence_rules:[
     "Use these observations to judge finish and craftsmanship, NOT as a composition or shot template",
     "New product must have independent research, concept, camera/occasion story and content-to-visual proof",
     "Do not copy captions, artwork, model positioning, iconic decorations, repeated backgrounds or typography arrangement just because a prior page is approved",
     "Preserve canonical layout and target brand DNA; vary creative direction where product evidence warrants",
     "Evaluate output QUALITY vs references AND distinctness from specific prior execution; neither visual imitation nor forced difference is the objective"
   ],
   workflow:"product_research → same_brand_reference_discovery → quality_bar → original_art_direction → materials → quality_not_similarity_review → targeted_repair → verified_html_overall",
   fallback:"When no genuinely approved and pixel-inspected references exist, use canonical brand DNA and normal QC; mark visual parity UNVERIFIED, continue the task without asking owner to rebrief.",
   note:"This tool ranks caller-inspected source records and never independently scans a store, verifies approval or opens image pixels."};
}
export type OutcomeDimension={section:EoCategory;slot:string;source_image_url:string;inspected_full_size:boolean;quality_meets_reference:boolean;distinct_from_reference_execution:boolean;product_factually_correct:boolean;notes:string};
export function evaluateOnepageEoOutcome(input:unknown){
 const base={schema_version:EO_REFERENCE_INTELLIGENCE_VERSION,server_pixel_inspected:false,comparison_target:"QUALITY_NOT_VISUAL_SIMILARITY",no_owner_qc_approval_pause:true};
 if(!input||typeof input!=="object"||Array.isArray(input))return {...base,status:"INVALID_INPUT",issues:["MISSING_INPUT"]};
 const q=input as {task_id:string;content_version:string;reference_ids:string[];desktop_overall_url:string;mobile_overall_url:string;inspections:OutcomeDimension[]};
 if(!nonempty(q.task_id)||!nonempty(q.content_version)||!Array.isArray(q.reference_ids)||!q.reference_ids.every(nonempty)||
    !url(q.desktop_overall_url)||!url(q.mobile_overall_url)||!Array.isArray(q.inspections)||!q.inspections.length||q.inspections.length>80)
   return {...base,status:"INVALID_INPUT",issues:["INVALID_OUTCOME_EVIDENCE"]};
 const issues:string[]=[];const targets=new Set<string>();const sections=new Set<string>();const seen=new Set<string>();
 for(const i of q.inspections){
  if(!i||!EO_REF_CATEGORIES.includes(i.section)||!nonempty(i.slot)||!url(i.source_image_url)||!nonempty(i.notes)||i.notes.trim().length<24||
   typeof i.inspected_full_size!=="boolean"||typeof i.quality_meets_reference!=="boolean"||
   typeof i.distinct_from_reference_execution!=="boolean"||typeof i.product_factually_correct!=="boolean"){
    issues.push("INVALID_IMAGE_INSPECTION");continue;
  }
  sections.add(i.section);
  if(seen.has(i.slot))issues.push("DUPLICATE_SLOT:"+i.slot);
  seen.add(i.slot);
  if(!i.inspected_full_size||!i.quality_meets_reference||!i.distinct_from_reference_execution||!i.product_factually_correct){
    targets.add(i.slot);
    if(!i.inspected_full_size)issues.push("UNINSPECTED_IMAGE:"+i.slot);
    if(!i.quality_meets_reference)issues.push("BELOW_EO_QUALITY_BAR:"+i.slot);
    if(!i.distinct_from_reference_execution)issues.push("OVER_COPIED_REFERENCE:"+i.slot);
    if(!i.product_factually_correct)issues.push("PRODUCT_FIDELITY_FAILED:"+i.slot);
  }
 }
 if(!sections.has("banner_typography")||!sections.has("icons")||!sections.has("mobile"))issues.push("REQUIRED_EO_SECTIONS_NOT_INSPECTED");
 if(!q.reference_ids.length)issues.push("REFERENCE_PARITY_UNVERIFIED_CANONICAL_QC_REQUIRED");
 return {...base,status:issues.length?"NEEDS_IN_TASK_REPAIR":"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA",
   issues,affected_slots:[...targets],reference_count:q.reference_ids.length,
   next_action:issues.length?"Repair failed slots with new product-specific art direction; inspect actual desktop/mobile pixels and rerun QC in SAME task. Do not ask for an intermediate approval or treat preview as finished. If no actual assets or tools exist report precise blocker.":"Continue final pixel review, canonical layout check, verified HTML and authorized packaging; no claim of pixel verification by server.",
   note:"Outcome inspection assertions were supplied by caller; server did not fetch pixels. 'Clear' is not final image approval."};
}
