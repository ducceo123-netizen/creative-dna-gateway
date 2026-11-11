import { test } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateOnepageBannerQc, ONEPAGE_BANNER_QC_FLAGS, ONEPAGE_BANNER_QC_VERSION } from "../supabase/functions/_shared/onepage-banner-qc.ts";
import { ONEPAGE_PRODUCTION_QC } from "../supabase/functions/_shared/onepage-production-qc.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { getOnepageUiTemplate } from "../onepage-ui-template.ts";

const checksum = "sha256:" + "a".repeat(64);
const review = (viewport: "desktop" | "mobile") => ({
  viewport, asset_id: "banner-" + viewport, sha256: checksum,
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
