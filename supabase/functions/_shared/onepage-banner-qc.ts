/** Version-bound Onepage integrated-final-banner report QC.
 * The model generates ONE complete image including typeset title and local soft blur per viewport.
 * This server validates supplied evidence/consistency and does NOT inspect image pixels.
 */
export const ONEPAGE_BANNER_QC_VERSION = "uid-onepage-banner-typography-qc/2026-11-12.v4";
export const ONEPAGE_BANNER_QC_FLAGS = [
  "visible_solid_text_slab",
  "hard_rectangular_headline_background",
  "abrupt_horizontal_scene_split",
  "opaque_or_patchy_text_overlay",
  "unreadable_typography",
  "text_lost_in_highlights_or_busy_scene",
  "artificially_flattened_copy_space",
  "uniform_tonal_wash_behind_headline",
  "texture_or_light_discontinuity",
  "staged_empty_wall_for_typography",
  "generic_or_unbalanced_typography",
  "bad_semantic_line_breaks",
  "text_collides_with_person_or_product",
  "incorrect_or_misspelled_product_title",
  "unsupported_or_illegible_support_copy",
  "visible_blur_patch_or_excessive_blurring",
  "physical_or_product_fidelity_error",
] as const;
type Flag = typeof ONEPAGE_BANNER_QC_FLAGS[number];
export type BannerInspection = {
  viewport: "desktop" | "mobile";
  asset_id: string;
  sha256: string;
  generation_mode: "single_pass_integrated_final_banner";
  typography_in_final_image: true;
  contrast_treatment: "localized_feathered_soft_blur";
  scene_story_id: string;
  content_version: string;
  approved_title: string;
  title_text_verified: true;
  method: "full_resolution_image_view";
  evidence_note: string;
  findings: Record<Flag, boolean>;
};
export type BannerQcInput = {
  task_id: string;
  content_version: string;
  inspections: BannerInspection[];
};
const id = (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.length <= 160;
const hash = (v: unknown) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const safeObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
export const ONEPAGE_BANNER_QC_DESCRIPTION =
  "PawfectHouse EO integrated banner QC (desktop AND mobile). Generate each final banner as ONE complete image with typography typeset in-image, not a separate text-layer/compositing flow. Keep one coherent campaign story and approved copy, but independently compose for each viewport. Under type use localized feathered SOFT BLUR for natural contrast, no flat slab or visible patch. Submit exact final asset/hash, story ID, approved headline, genuine full-resolution inspection and explicit findings about type hierarchy, semantic breaks, legibility, natural product interaction and localized blur. The evaluator checks reports, not pixels. Incomplete or flagged reports BLOCK the final assets; a reported-clear result still REQUIRES independent host visual QA. Never invent approval or image inspection.";
export const ONEPAGE_BANNER_QC_INPUT_SCHEMA = {
  type:"object",additionalProperties:false,required:["task_id","content_version","inspections"],
  properties:{
    task_id:{type:"string",minLength:1,maxLength:160},
    content_version:{type:"string",minLength:1,maxLength:160},
    inspections:{type:"array",minItems:2,maxItems:2,items:{
      type:"object",additionalProperties:false,
      required:["viewport","asset_id","sha256","generation_mode","typography_in_final_image","contrast_treatment","scene_story_id","content_version","approved_title","title_text_verified","method","evidence_note","findings"],
      properties:{
        viewport:{type:"string",enum:["desktop","mobile"]},
        asset_id:{type:"string",minLength:1,maxLength:160},
        sha256:{type:"string",pattern:"^sha256:[0-9a-f]{64}$"},
        generation_mode:{type:"string",enum:["single_pass_integrated_final_banner"]},
        typography_in_final_image:{type:"boolean",const:true},
        contrast_treatment:{type:"string",enum:["localized_feathered_soft_blur"]},
        scene_story_id:{type:"string",minLength:1,maxLength:160},
        content_version:{type:"string",minLength:1,maxLength:160},
        approved_title:{type:"string",minLength:1,maxLength:260},
        title_text_verified:{type:"boolean",const:true},
        method:{type:"string",enum:["full_resolution_image_view"]},
        evidence_note:{type:"string",minLength:40,maxLength:2000},
        findings:{type:"object",additionalProperties:false,required:[...ONEPAGE_BANNER_QC_FLAGS],
          properties:Object.fromEntries(ONEPAGE_BANNER_QC_FLAGS.map(k=>[k,{type:"boolean"}]))},
      },
    }},
  },
} as const;

export function evaluateOnepageBannerQc(input: unknown) {
  const blocked=(reasons:string[])=>({
    schema_version:ONEPAGE_BANNER_QC_VERSION,status:"BLOCKED" as const,
    reasons:[...new Set(reasons)],can_release:false,pixel_inspected_by_server:false,
    applies_to:["banner_asset_review","overall_desktop_mobile","packaging"],
    next_action:"Regenerate a complete final banner (scene+approved typography+localized feathered soft blur) for the affected viewport; do not extract typography into a separate layer. Inspect the actual final pixels, product physics and on-page readability before submitting new version-bound QC evidence.",
  });
  if(!safeObj(input)||!id(input.task_id)||!id(input.content_version)||!Array.isArray(input.inspections)||input.inspections.length!==2)
    return blocked(["MISSING_OR_INVALID_VERSION_BOUND_INSPECTIONS"]);
  const issues:string[]=[];
  const seen=new Set<string>();
  const stories=new Set<string>();
  const headlines=new Set<string>();
  const hashes=new Set<string>();
  for(const v of input.inspections){
    if(!safeObj(v)||!["desktop","mobile"].includes(v.viewport)||seen.has(v.viewport)){issues.push("MISSING_OR_DUPLICATE_VIEWPORT");continue;}
    seen.add(v.viewport);
    if(!id(v.asset_id)||!hash(v.sha256)||v.method!=="full_resolution_image_view"||
       typeof v.evidence_note!=="string"||v.evidence_note.trim().length<40||v.evidence_note.length>2000)
      issues.push(`INSUFFICIENT_FINAL_IMAGE_EVIDENCE:${v.viewport}`);
    if(v.generation_mode!=="single_pass_integrated_final_banner"||v.typography_in_final_image!==true||
       v.contrast_treatment!=="localized_feathered_soft_blur")
      issues.push(`NON_INTEGRATED_BANNER_OR_MISSING_SOFT_BLUR:${v.viewport}`);
    if(!id(v.scene_story_id)||!id(v.content_version)||v.content_version!==input.content_version||
       !id(v.approved_title)||v.approved_title.length>260||v.title_text_verified!==true)
      issues.push(`MISSING_STORY_OR_APPROVED_COPY_VERIFICATION:${v.viewport}`);
    if(id(v.scene_story_id)) stories.add(v.scene_story_id);
    if(id(v.approved_title)) headlines.add(v.approved_title.trim());
    if(hash(v.sha256)) hashes.add(v.sha256);
    if(!safeObj(v.findings)||Object.keys(v.findings).length!==ONEPAGE_BANNER_QC_FLAGS.length||
       ONEPAGE_BANNER_QC_FLAGS.some(k=>typeof v.findings[k]!=="boolean"))
      issues.push(`INCOMPLETE_FINDINGS:${v.viewport}`);
    else for(const flag of ONEPAGE_BANNER_QC_FLAGS)if(v.findings[flag])
      issues.push(`BANNER_DEFECT:${v.viewport}:${flag}`);
  }
  if(!seen.has("desktop")||!seen.has("mobile"))issues.push("BOTH_VIEWPORTS_REQUIRED");
  if(stories.size>1)issues.push("DESKTOP_MOBILE_STORY_MISMATCH");
  if(headlines.size>1)issues.push("DESKTOP_MOBILE_APPROVED_TITLE_MISMATCH");
  if(hashes.size<2)issues.push("DESKTOP_MOBILE_DISTINCT_FINAL_IMAGES_REQUIRED");
  if(issues.length)return blocked(issues);
  return {
    schema_version:ONEPAGE_BANNER_QC_VERSION,
    status:"REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA" as const,
    can_release:false,pixel_inspected_by_server:false,
    task_id:input.task_id,content_version:input.content_version,
    reviewed_assets:input.inspections.map((v:BannerInspection)=>({viewport:v.viewport,asset_id:v.asset_id,sha256:v.sha256,generation_mode:v.generation_mode,scene_story_id:v.scene_story_id,contrast_treatment:v.contrast_treatment})),
    applies_to:["banner_asset_review","overall_desktop_mobile","packaging"],
    next_action:"Host must independently inspect the actual integrated final desktop/mobile images at native and mapped size, verify exact typography and local soft blur, and compare any genuinely approved brand references. A submitted clean report is not a server pixel QA PASS.",
  };
}
