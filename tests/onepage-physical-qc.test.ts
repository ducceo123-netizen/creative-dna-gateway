import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ONEPAGE_PHYSICAL_DEFECTS, ONEPAGE_PHYSICAL_QC_VERSION, evaluateOnepagePhysicalQc } from "../supabase/functions/_shared/onepage-physical-qc.ts";
import { ONEPAGE_PRODUCTION_QC } from "../supabase/functions/_shared/onepage-production-qc.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { getOnepageUiTemplate } from "../onepage-ui-template.ts";

const inspect = (asset_id="asset-1")=>({
  asset_id,section:"banner",shot_role:"lifestyle_moment",product_id:"name-tracing-board",
  source_pdp_url:"https://pawfecthouse.com/products/sample-writing-board",
  visually_inspected:true,
  inspector_note:"Full image inspected. Board faces child, hand marks text naturally, forearm follows writing direction, eye-line matches board and table supports all edges.",
  interaction_direction:"toward_real_user",camera_strategy:"elevated_angle",
  findings:Object.fromEntries(ONEPAGE_PHYSICAL_DEFECTS.map(k=>[k,false]))
});
const input=()=>({task_id:"task-1",content_version:"v6",inspections:[inspect()]});
test("use-first gate blocks every physics failure including camera-directed print and anatomy",()=>{
  for(const flag of ONEPAGE_PHYSICAL_DEFECTS) {
    const data:any=input();data.inspections[0].findings[flag]=true;
    const o=evaluateOnepagePhysicalQc(data);
    assert.equal(o.status,"BLOCKED");
    assert.ok(o.reasons.includes("PHYSICAL_DEFECT:asset-1:"+flag));
    assert.equal(o.can_release,false);
  }
});
test("camera-facing forced design is rejected even without explicit checkbox failure",()=>{
  const v:any=input();v.inspections[0].camera_strategy="forced_camera_facing";
  assert.ok(evaluateOnepagePhysicalQc(v).reasons.includes("CAMERA_VISIBILITY_OVERRIDES_REAL_USE:asset-1"));
  v.inspections[0].camera_strategy="natural_observer_angle";
  v.inspections[0].interaction_direction="unknown";
  assert.ok(evaluateOnepagePhysicalQc(v).reasons.includes("UNVERIFIED_PRODUCT_ORIENTATION:asset-1"));
});
test("product details may use separate closeup rather than forced lifestyle gesture",()=>{
  const v:any=input();v.inspections[0].section="product_details";v.inspections[0].shot_role="product_detail";v.inspections[0].interaction_direction="not_applicable_still_life";v.inspections[0].camera_strategy="dedicated_closeup";
  const o=evaluateOnepagePhysicalQc(v);
  assert.equal(o.status,"REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA");
  assert.equal(o.pixel_inspected_by_server,false);
  assert.equal(o.can_release,false);
});
test("realistic moment with only partly visible design is not falsely rejected",()=>{
  const o=evaluateOnepagePhysicalQc(input());
  assert.equal(o.status,"REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA");
  assert.equal(o.can_release,false);
});
test("missing provenance, false visual inspection and duplicate assets fail closed",()=>{
  assert.equal(evaluateOnepagePhysicalQc({}).status,"BLOCKED");
  const v:any=input();v.inspections[0].visually_inspected=false;
  assert.ok(evaluateOnepagePhysicalQc(v).reasons.includes("UNVERIFIED_USE_AND_PDP_EVIDENCE:asset-1"));
  const w:any=input();w.inspections.push(inspect());
  assert.ok(evaluateOnepagePhysicalQc(w).reasons.includes("DUPLICATE_ASSET_ID:asset-1"));
});
test("same v6 physical contract is emitted for ChatGPT and Web App",()=>{
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.physical_use_gate.version,ONEPAGE_PHYSICAL_QC_VERSION);
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.pawfecthouse_onepage_reference_refresh.current_banner_visual_audit,"UNVERIFIED_NO_FULL_SIZE_VIEWPORT_CAPTURE");
  assert.deepEqual(UID_NATIVE_WORKFLOW.onepageProductionQc,ONEPAGE_PRODUCTION_QC);
  assert.deepEqual(getOnepageUiTemplate().production_qc_contract,ONEPAGE_PRODUCTION_QC);
});
