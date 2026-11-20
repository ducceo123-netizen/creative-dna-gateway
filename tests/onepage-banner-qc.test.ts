import { test } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateOnepageBannerQc, ONEPAGE_BANNER_QC_FLAGS, ONEPAGE_BANNER_QC_VERSION } from "../supabase/functions/_shared/onepage-banner-qc.ts";
import { ONEPAGE_PRODUCTION_QC } from "../supabase/functions/_shared/onepage-production-qc.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { getOnepageUiTemplate } from "../onepage-ui-template.ts";
import {compileInvisibleBannerDirection} from "../uid-invisible-banner-direction.ts";

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
  ...(viewport==="mobile"?{mobile_balance:{
    headline_is_primary:true,scene_and_product_support_copy:true,negative_space_balanced:true,
    visual_hierarchy_preserved:true,recomposed_not_downscaled:true,
    inspection_note:"Inspected mobile full banner: headline remains dominant and expressive; people, product and negative space contribute to a balanced composition."}}:{}),
  findings:Object.fromEntries(ONEPAGE_BANNER_QC_FLAGS.map(k=>[k,false])),
});
const reasons=(result:ReturnType<typeof evaluateOnepageBannerQc>)=>result.status==="BLOCKED"?result.reasons:[];
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
  assert.ok(reasons(evaluateOnepageBannerQc(v)).some((x:string)=>x.includes("NON_INTEGRATED_BANNER")));
  const w:any=input();w.inspections[0].typography_in_final_image=false;
  assert.equal(evaluateOnepageBannerQc(w).status,"BLOCKED");
});
test("required localized blur cannot disappear or become an opaque panel",()=>{
  const v:any=input();v.inspections[1].contrast_treatment="none";
  assert.equal(evaluateOnepageBannerQc(v).status,"BLOCKED");
  for(const flag of ["visible_solid_text_slab","visible_blur_patch_or_excessive_blurring","unreadable_typography"] as const){
    const w=input();w.inspections[0].findings[flag]=true;
    assert.ok(reasons(evaluateOnepageBannerQc(w)).includes("BANNER_DEFECT:desktop:"+flag));
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
  assert.ok(reasons(evaluateOnepageBannerQc(title)).includes("DESKTOP_MOBILE_APPROVED_TITLE_MISMATCH"));
  const story:any=input();story.inspections[1].scene_story_id="unrelated-shot";
  assert.ok(reasons(evaluateOnepageBannerQc(story)).includes("DESKTOP_MOBILE_STORY_MISMATCH"));
  const sameImage:any=input();sameImage.inspections[1].sha256=sameImage.inspections[0].sha256;
  assert.ok(reasons(evaluateOnepageBannerQc(sameImage)).includes("DESKTOP_MOBILE_DISTINCT_FINAL_IMAGES_REQUIRED"));
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

test("mobile headline may remain readable but fail holistic composition if shrunk to fit image",()=>{
  const x:any=input();x.inspections[1].findings.mobile_headline_shrunk_to_accommodate_photo=true;
  assert.ok(reasons(evaluateOnepageBannerQc(x)).includes("BANNER_DEFECT:mobile:mobile_headline_shrunk_to_accommodate_photo"));
  const y:any=input();y.inspections[1].mobile_balance.headline_is_primary=false;
  assert.ok(reasons(evaluateOnepageBannerQc(y)).includes("MOBILE_OVERALL_TYPE_COMPOSITION_NOT_VERIFIED"));
  const z:any=input();delete z.inspections[1].mobile_balance;
  assert.ok(reasons(evaluateOnepageBannerQc(z)).includes("MOBILE_OVERALL_TYPE_COMPOSITION_NOT_VERIFIED"));
  const w:any=input();w.inspections[1].mobile_balance.negative_space_balanced=false;
  assert.ok(reasons(evaluateOnepageBannerQc(w)).includes("MOBILE_OVERALL_TYPE_COMPOSITION_NOT_VERIFIED"));
});

test("uninspired flat EO headline fails even if readable and technically well aligned",()=>{
  const x:any=input();x.inspections[0].findings.flat_single_weight_generic_headline=true;
  assert.ok(reasons(evaluateOnepageBannerQc(x)).includes("BANNER_DEFECT:desktop:flat_single_weight_generic_headline"));
  const y:any=input();y.inspections[1].findings.weak_display_personality_despite_legibility=true;
  assert.ok(reasons(evaluateOnepageBannerQc(y)).includes("BANNER_DEFECT:mobile:weak_display_personality_despite_legibility"));
  const z:any=input();z.inspections[0].findings.brand_inconsistent_display_font_or_decoration=true;
  assert.equal(evaluateOnepageBannerQc(z).status,"BLOCKED");
});
test("banner art direction uses only verified same-brand refs, never guessed brand font",()=>{
  const brief={brand:"pawfecthouse" as const,product:"Oven Skirt",audience:"gift shoppers",occasion:"birthday",headline:"Personalized Oven Skirt",references:[
    {brand:"pawfecthouse",status:"approved" as const,observation:"Sampled expressive headline with balanced support from inspected pixel reference",verified_pixels:true},
    {brand:"giftsoul",status:"approved" as const,observation:"Different-brand type",verified_pixels:true},
    {brand:"pawfecthouse",status:"approved" as const,observation:"Uninspected banner",verified_pixels:false}
  ]};
  const approved=compileInvisibleBannerDirection(brief);
  assert.equal(approved.references.length,1);
  assert.equal(approved.typography_direction.evidence_status,"APPROVED_SAME_BRAND_REFERENCES_REPORTED");
  assert.match(approved.typography_direction.art_direction,/editorial element/);
  const unverified=compileInvisibleBannerDirection({...brief,references:[]});
  assert.equal(unverified.typography_direction.evidence_status,"REFERENCE_STYLE_NOT_VISUALLY_VERIFIED");
  assert.match(unverified.typography_direction.reference_boundary,/do not invent exact EO font/);
});
