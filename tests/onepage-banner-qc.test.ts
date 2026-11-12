import { test } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateOnepageBannerQc, ONEPAGE_BANNER_QC_FLAGS, ONEPAGE_BANNER_QC_VERSION } from "../supabase/functions/_shared/onepage-banner-qc.ts";
import { ONEPAGE_PRODUCTION_QC } from "../supabase/functions/_shared/onepage-production-qc.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { getOnepageUiTemplate } from "../onepage-ui-template.ts";

const inspection=(viewport:"desktop"|"mobile")=>({
  viewport,asset_id:"pfh-final-"+viewport,
  sha256:"sha256:"+(viewport==="desktop"?"a":"b").repeat(64),
  generation_mode:"single_pass_integrated_final_banner" as const,
  typography_in_final_image:true as const,
  contrast_treatment:"localized_feathered_soft_blur" as const,
  scene_story_id:"grandfather-girl-baking-cookies",
  content_version:"content-v3",approved_title:"Personalized Plastic Cups",title_text_verified:true as const,
  method:"full_resolution_image_view" as const,
  evidence_note:"Reviewed final full image at target viewport: heading legible, expressive PFH scale, correct approved title, localized soft blur has no hard edges, real plastic cup product interaction verified.",
  findings:Object.fromEntries(ONEPAGE_BANNER_QC_FLAGS.map(k=>[k,false])),
});
const input=()=>({task_id:"onepage-banner-test",content_version:"content-v3",inspections:[inspection("desktop"),inspection("mobile")]});
test("exactly two complete banner images are required",()=>{
  assert.equal(evaluateOnepageBannerQc(undefined).status,"BLOCKED");
  assert.equal(evaluateOnepageBannerQc({task_id:"a",content_version:"v1",inspections:[]}).status,"BLOCKED");
  const v:any=input();v.inspections[1].viewport="desktop";
  assert.equal(evaluateOnepageBannerQc(v).status,"BLOCKED");
});
test("integrated final artwork including title and subtle blur is valid production input",()=>{
  const o=evaluateOnepageBannerQc(input());
  assert.equal(o.status,"REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA");
  assert.equal(o.can_release,false);
  assert.equal(o.pixel_inspected_by_server,false);
  assert.equal(o.reviewed_assets[0].generation_mode,"single_pass_integrated_final_banner");
});
test("blank-scene then separately rendered typography is rejected",()=>{
  const v:any=input();v.inspections[0].generation_mode="scene_first_no_typography";
  assert.ok(evaluateOnepageBannerQc(v).reasons.some((x:string)=>x.includes("NON_INTEGRATED_BANNER")));
  const w:any=input();w.inspections[0].typography_in_final_image=false;
  assert.equal(evaluateOnepageBannerQc(w).status,"BLOCKED");
});
test("required localized blur cannot disappear or become an opaque panel",()=>{
  const v:any=input();v.inspections[1].contrast_treatment="none";
  assert.equal(evaluateOnepageBannerQc(v).status,"BLOCKED");
  for(const flag of ["visible_solid_text_slab","visible_blur_patch_or_excessive_blurring","unreadable_typography"] as const){
    const w=input();w.inspections[0].findings[flag]=true;
    assert.ok(evaluateOnepageBannerQc(w).reasons.includes("BANNER_DEFECT:desktop:"+flag));
  }
});
test("every explicit defect flag blocks even when reporter claims integrated generation",()=>{
  for(const viewport of ["desktop","mobile"] as const)for(const flag of ONEPAGE_BANNER_QC_FLAGS){
    const v=input();v.inspections.find(x=>x.viewport===viewport)!.findings[flag]=true;
    assert.equal(evaluateOnepageBannerQc(v).status,"BLOCKED");
  }
});
test("different approved titles or story continuity block mobile/desktop",()=>{
  const title:any=input();title.inspections[1].approved_title="Different cups";
  assert.ok(evaluateOnepageBannerQc(title).reasons.includes("DESKTOP_MOBILE_APPROVED_TITLE_MISMATCH"));
  const story:any=input();story.inspections[1].scene_story_id="unrelated-shot";
  assert.ok(evaluateOnepageBannerQc(story).reasons.includes("DESKTOP_MOBILE_STORY_MISMATCH"));
  const sameImage:any=input();sameImage.inspections[1].sha256=sameImage.inspections[0].sha256;
  assert.ok(evaluateOnepageBannerQc(sameImage).reasons.includes("DESKTOP_MOBILE_DISTINCT_FINAL_IMAGES_REQUIRED"));
});
test("incorrect version, missing actual-image evidence or incomplete checks blocks",()=>{
  const v:any=input();v.inspections[0].content_version="old";
  assert.equal(evaluateOnepageBannerQc(v).status,"BLOCKED");
  const m:any=input();delete m.inspections[0].findings.bad_semantic_line_breaks;
  assert.equal(evaluateOnepageBannerQc(m).status,"BLOCKED");
});
test("shared production gate and native workflow use new banner mode",()=>{
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.banner_typography_gate.version,ONEPAGE_BANNER_QC_VERSION);
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.banner_workflow.generation_mode,"single_pass_integrated_final_banner");
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.banner_workflow.soft_support.required,true);
  assert.deepEqual(UID_NATIVE_WORKFLOW.onepageProductionQc,ONEPAGE_PRODUCTION_QC);
  assert.deepEqual(getOnepageUiTemplate().production_qc_contract,ONEPAGE_PRODUCTION_QC);
});
