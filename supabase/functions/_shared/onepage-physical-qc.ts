/** Evidence-based natural use QC for Onepage assets.
 * A structured report is NOT a pixel scanner, supplier specification or authorization to publish.
 */
export const ONEPAGE_PHYSICAL_QC_VERSION = "uid-onepage-physical-use-qc/2026-11-12.v1";
export const ONEPAGE_PHYSICAL_DEFECTS = [
  "reversed_product_orientation_for_user",
  "design_forced_toward_camera",
  "hand_finger_wrist_elbow_anatomy",
  "eye_line_hand_action_mismatch",
  "gravity_support_contact_error",
  "implausible_posture_or_grip",
  "wrong_product_construction_or_function",
  "printed_design_pasted_or_warped",
  "scale_perspective_material_inconsistency",
] as const;
export const ONEPAGE_PHYSICAL_QC_DESCRIPTION =
  "Use-first Onepage physical interaction QC for Banner, Occasion, Why You'll Love It, UGC and Product Details. Lifestyle/UGC should put natural human use and physical accuracy before camera-readable artwork. A partially obscured design is acceptable; use a separate verified close-up, over-shoulder, elevated or top-down detail shot to show artwork. Inspect real PDP function, product orientation relative to the USER, eye-line, hand action, grip/anatomy, gravity, contact, material and artwork identity. For product-detail shots prioritize legibility without violating physics. Report exact task/version, asset/role, reference PDP and explicit findings. Any flagged defect or missing inspection blocks. This evaluates host-supplied evidence and does NOT inspect images itself.";
export const ONEPAGE_PHYSICAL_QC_INPUT_SCHEMA = {
  type:"object",additionalProperties:false,required:["task_id","content_version","inspections"],
  properties:{
    task_id:{type:"string",minLength:1,maxLength:160},content_version:{type:"string",minLength:1,maxLength:160},
    inspections:{type:"array",minItems:1,maxItems:50,items:{
      type:"object",additionalProperties:false,
      required:["asset_id","section","shot_role","product_id","source_pdp_url","visually_inspected","inspector_note","interaction_direction","camera_strategy","findings"],
      properties:{
        asset_id:{type:"string",minLength:1,maxLength:160},
        section:{type:"string",enum:["banner","occasion","why_you_love_it","ugc","product_details","other"]},
        shot_role:{type:"string",enum:["lifestyle_moment","ugc_moment","product_closeup","product_detail"]},
        product_id:{type:"string",minLength:1,maxLength:160},
        source_pdp_url:{type:"string",pattern:"^https://[^\\s]+$"},
        visually_inspected:{type:"boolean"},
        inspector_note:{type:"string",minLength:40,maxLength:2000},
        interaction_direction:{type:"string",enum:["toward_real_user","not_applicable_still_life","unknown"]},
        camera_strategy:{type:"string",enum:["natural_observer_angle","over_shoulder","elevated_angle","top_down","dedicated_closeup","forced_camera_facing"]},
        findings:{type:"object",additionalProperties:false,required:[...ONEPAGE_PHYSICAL_DEFECTS],
          properties:Object.fromEntries(ONEPAGE_PHYSICAL_DEFECTS.map(k=>[k,{type:"boolean"}]))},
      }
    }}
  }
} as const;
type Obj=Record<string,any>;
const obj=(v:unknown):v is Obj=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const ok=(v:unknown,n=160)=>typeof v==="string"&&v.trim().length>0&&v.length<=n;
export function evaluateOnepagePhysicalQc(raw:unknown){
  const input=obj(raw)?raw:{};
  const reasons:string[]=[];
  if(!ok(input.task_id)||!ok(input.content_version)||!Array.isArray(input.inspections)||input.inspections.length<1||input.inspections.length>50)
    reasons.push("MISSING_TASK_VERSION_OR_ASSET_INSPECTIONS");
  const assets=new Set<string>();
  const inspected:Array<{asset_id:string;section:string;shot_role:string}>=[];
  if(Array.isArray(input.inspections)&&input.inspections.length<=50)for(const v of input.inspections){
    if(!obj(v)||!ok(v.asset_id)||!ok(v.product_id)||!ok(v.section)||!ok(v.shot_role)){reasons.push("INVALID_ASSET_INSPECTION");continue;}
    if(assets.has(v.asset_id))reasons.push("DUPLICATE_ASSET_ID:"+v.asset_id);
    assets.add(v.asset_id);
    if(!["banner","occasion","why_you_love_it","ugc","product_details","other"].includes(v.section)||
      !["lifestyle_moment","ugc_moment","product_closeup","product_detail"].includes(v.shot_role)||
      typeof v.source_pdp_url!=="string"||!/^https:\/\/[^\s]+$/.test(v.source_pdp_url)||
      v.visually_inspected!==true||!ok(v.inspector_note,2000)||v.inspector_note.trim().length<40)
      reasons.push("UNVERIFIED_USE_AND_PDP_EVIDENCE:"+v.asset_id);
    if(!["toward_real_user","not_applicable_still_life","unknown"].includes(v.interaction_direction)||
      !["natural_observer_angle","over_shoulder","elevated_angle","top_down","dedicated_closeup","forced_camera_facing"].includes(v.camera_strategy))
      reasons.push("INVALID_INTERACTION_OR_CAMERA_STRATEGY:"+v.asset_id);
    if(v.interaction_direction==="unknown")reasons.push("UNVERIFIED_PRODUCT_ORIENTATION:"+v.asset_id);
    if(v.camera_strategy==="forced_camera_facing")reasons.push("CAMERA_VISIBILITY_OVERRIDES_REAL_USE:"+v.asset_id);
    if((v.shot_role==="lifestyle_moment"||v.shot_role==="ugc_moment")&&v.interaction_direction!=="toward_real_user")
      reasons.push("LIFESTYLE_REQUIRES_NATURAL_USER_ORIENTATION:"+v.asset_id);
    if(!obj(v.findings)||Object.keys(v.findings).length!==ONEPAGE_PHYSICAL_DEFECTS.length||
       ONEPAGE_PHYSICAL_DEFECTS.some(k=>typeof v.findings[k]!=="boolean"))
      reasons.push("INCOMPLETE_PHYSICAL_QC_FLAGS:"+v.asset_id);
    else for(const flag of ONEPAGE_PHYSICAL_DEFECTS)if(v.findings[flag])
      reasons.push("PHYSICAL_DEFECT:"+v.asset_id+":"+flag);
    inspected.push({asset_id:v.asset_id,section:v.section,shot_role:v.shot_role});
  }
  return {
    schema_version:ONEPAGE_PHYSICAL_QC_VERSION,
    status:reasons.length?"BLOCKED" as const:"REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA" as const,
    can_release:false,pixel_inspected_by_server:false,
    task_id:input.task_id||null,content_version:input.content_version||null,
    reasons:[...new Set(reasons)],inspected_assets:inspected,
    applies_to:["asset_review","overall_desktop_mobile","packaging"],
    next_action:reasons.length
      ?"Fix orientation, hands, eye-line, gravity or construction in the flagged shot; if artwork must be clearer, choose a different camera angle or a separate verified detail image. Reinspect real pixels and rerun."
      :"An independent host must verify the real scene/full-size image and PDP reference before release; this report does not prove visual accuracy.",
  };
}
