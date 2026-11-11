import { createApp } from "../server.ts";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateOnepageBannerQc, ONEPAGE_BANNER_QC_FLAGS, ONEPAGE_BANNER_QC_VERSION } from "../supabase/functions/_shared/onepage-banner-qc.ts";
import { ONEPAGE_PRODUCTION_QC } from "../supabase/functions/_shared/onepage-production-qc.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { getOnepageUiTemplate } from "../onepage-ui-template.ts";

const checksum = "sha256:" + "a".repeat(64);
const review = (viewport: "desktop" | "mobile") => ({
  viewport, asset_id: "banner-" + viewport, sha256: checksum,
  scene_asset_id: "scene-" + viewport, scene_sha256: "sha256:" + "b".repeat(64),
  scene_method: "scene_first_no_typography" as const,
  scene_evidence_note: "Inspected actual text-free scene: authentic wall texture and natural window light falloff continue through the copy-space, without fake darkness.",
  final_composition_method: "independent_typography_layer" as const,
  method: "full_resolution_image_view" as const,
  evidence_note: "Full-resolution banner was viewed including headline edge, tree/scene transition and side windows; no seams observed.",
  findings: Object.fromEntries(ONEPAGE_BANNER_QC_FLAGS.map(k=>[k,false])),
});
const input = () => ({task_id:"task-1",content_version:"rev-3",inspections:[review("desktop"),review("mobile")]});

test("onepage banner QC refuses missing or uninspected evidence",()=>{
  assert.equal(evaluateOnepageBannerQc(undefined).status,"BLOCKED");
  assert.equal(evaluateOnepageBannerQc({task_id:"task-1",content_version:"v1",inspections:[]}).status,"BLOCKED");
  const one=input();one.inspections[1]=review("desktop");assert.equal(evaluateOnepageBannerQc(one).status,"BLOCKED");
  const noFindings:any=input();delete noFindings.inspections[0].findings.visible_solid_text_slab;
  assert.equal(evaluateOnepageBannerQc(noFindings).status,"BLOCKED");
});
test("each prohibited visual artifact blocks both overall and packaging",()=>{
  for(const viewport of ["desktop","mobile"] as const) for(const flag of ONEPAGE_BANNER_QC_FLAGS){
    const v=input();v.inspections.find(x=>x.viewport===viewport)!.findings[flag]=true;
    const result=evaluateOnepageBannerQc(v);
    assert.equal(result.status,"BLOCKED");
    assert.equal(result.can_release,false);
    assert.ok(result.reasons.some(x=>x.includes("BANNER_DEFECT:"+viewport+":"+flag)));
    assert.ok(result.applies_to.includes("packaging"));
  }
});
test("clear host report cannot pretend to have done server pixel inspection",()=>{
  const result=evaluateOnepageBannerQc(input());
  assert.equal(result.status,"REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA");
  assert.equal(result.can_release,false);
  assert.equal(result.pixel_inspected_by_server,false);
});
test("new banner hard gate flows through both ChatGPT and Web App shared contracts",()=>{
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.banner_typography_gate.version,ONEPAGE_BANNER_QC_VERSION);
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.banner_typography_gate.fail_closed,true);
  assert.deepEqual(UID_NATIVE_WORKFLOW.onepageProductionQc,ONEPAGE_PRODUCTION_QC);
  assert.deepEqual(getOnepageUiTemplate().production_qc_contract,ONEPAGE_PRODUCTION_QC);
});

test("public gateway banner QC endpoint blocks flagged viewport and clean report still needs visual review", async () => {
  const app=createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve=>app.once("listening",resolve));
  const url="http://127.0.0.1:"+String((app.address() as any).port)+"/api/tools/evaluate_onepage_banner_qc";
  try {
    const bad=input();bad.inspections[1].findings.visible_solid_text_slab=true;
    const flagged=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(bad)});
    assert.equal(flagged.status,422);
    const issue=await flagged.json();
    assert.equal(issue.status,"BLOCKED");
    assert.equal(issue.can_release,false);
    const clean=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input())});
    assert.equal(clean.status,200);
    const clear=await clean.json();
    assert.equal(clear.can_release,false);
    assert.equal(clear.pixel_inspected_by_server,false);
  } finally {
    await new Promise<void>((resolve,reject)=>app.close(e=>e?reject(e):resolve()));
  }
});

test("one-step type-baked banners fail without separate source scene", () => {
  const v:any=input(); delete v.inspections[0].scene_asset_id;
  assert.equal(evaluateOnepageBannerQc(v).status,"BLOCKED");
  const reused:any=input();reused.inspections[1].scene_sha256=reused.inspections[1].sha256;
  assert.ok(evaluateOnepageBannerQc(reused).reasons.some(x=>x.includes("SCENE_AND_COMPOSITE_MUST_BE_DISTINCT")));
  const onepass:any=input();onepass.inspections[0].final_composition_method="rendered_into_generated_image";
  assert.ok(evaluateOnepageBannerQc(onepass).reasons.some(x=>x.includes("MISSING_SCENE_FIRST_EVIDENCE")));
});
test("copy-space flattening and fake wall texture are blocked even without a literal solid slab", () => {
  for(const flag of ["artificially_flattened_copy_space","uniform_tonal_wash_behind_headline","texture_or_light_discontinuity","staged_empty_wall_for_typography"] as const) {
    const v=input();v.inspections[0].findings[flag]=true;
    assert.equal(evaluateOnepageBannerQc(v).status,"BLOCKED");
  }
});
