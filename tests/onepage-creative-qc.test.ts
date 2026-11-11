import { test } from "node:test";
import { strict as assert } from "node:assert";
import { EO_ICON_DEFECTS, ONEPAGE_CREATIVE_QC_VERSION, evaluateOnepageCreativeQc } from "../supabase/functions/_shared/onepage-creative-qc.ts";
import { ONEPAGE_PRODUCTION_QC } from "../supabase/functions/_shared/onepage-production-qc.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { getOnepageUiTemplate } from "../onepage-ui-template.ts";

const designs=(n:number)=>Array.from({length:n},(_,i)=>({product_id:"p"+i,design_id:"art"+i,pdp_url:"https://pawfecthouse.com/products/product-"+i,visually_inspected:true}));
const stories=(ids:number[])=>ids.map((i,n)=>({slot:"occasion_"+n,story_id:"story-"+n,section:"occasion",product_id:"p"+i,design_id:"art"+i}));
const dInput=(ids:number[],catalog=4)=>({task_id:"onepage-11",content_version:"v4",scope:"design_diversity",inventory:designs(catalog),placements:stories(ids)});
const icon=(i:number)=>({slot:"icon-"+i,asset_id:"asset-"+i,reference_url:"https://pawfecthouse.com/assets/eo-reference",inspected_at_full_size:true,tested_at_small_size:true,evidence_note:"Inspected coherent EO line language, clean silhouette, anatomical proportions and small mobile size on approved reference.",defects:Object.fromEntries(EO_ICON_DEFECTS.map(f=>[f,false]))});
const iInput=(n=3)=>({task_id:"onepage-11",content_version:"v4",scope:"eo_icons",icons:Array.from({length:n},(_,i)=>icon(i))});

test("repeated actual artwork across the page is rejected, even with distinct story slots",()=>{
  const o=evaluateOnepageCreativeQc(dInput([0,0,0,0,1,1],4));
  assert.equal(o.status,"BLOCKED");
  assert.ok(o.issues.includes("INSUFFICIENT_DISTINCT_DESIGNS"));
  assert.ok(o.issues.some(x=>x.startsWith("OVERUSED_DESIGN")));
  assert.ok(o.issues.some(x=>x.startsWith("ADJACENT_REPEAT")));
});
test("balanced designs can be reported clear but cannot self-certify visual QC",()=>{
  const o=evaluateOnepageCreativeQc(dInput([0,1,2,3,0,1],4));
  assert.equal(o.status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
  assert.equal(o.can_release,false);assert.equal(o.pixel_inspected_by_server,false);
});
test("product details may repeat verified anchor SKU without diminishing editorial diversity",()=>{
  const v=dInput([0,1,2,3],4);
  v.placements.push({slot:"pd_close_1",story_id:"detail1",section:"product_details",product_id:"p0",design_id:"art0"});
  v.placements.push({slot:"pd_close_2",story_id:"detail2",section:"product_details",product_id:"p0",design_id:"art0"});
  assert.equal(evaluateOnepageCreativeQc(v).status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
  v.placements[5].product_id="p1";v.placements[5].design_id="art1";
  assert.ok(evaluateOnepageCreativeQc(v).issues.includes("PRODUCT_DETAILS_ANCHOR_SKU_CHANGED"));
});
test("single verified artwork collection does not invent non-existent designs",()=>{
  assert.equal(evaluateOnepageCreativeQc(dInput([0,0,0],1)).status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
});
test("unknown catalog designs and uninspected PDP source block",()=>{
  const v:any=dInput([0,1,2],3);v.inventory[1].visually_inspected=false;
  assert.equal(evaluateOnepageCreativeQc(v).status,"BLOCKED");
  const w:any=dInput([0,1,2],3);w.placements[1].design_id="invented";
  assert.ok(evaluateOnepageCreativeQc(w).issues.some(x=>x.startsWith("PLACEMENT_NOT_PROVEN_BY_PDP")));
});
test("EO icon first pass blocks bad line quality or anatomy, incomplete evidence and repeated file assets",()=>{
  const v:any=iInput();v.icons[0].defects.fragmented_or_noisy_details=true;
  assert.ok(evaluateOnepageCreativeQc(v).issues.some(x=>x.includes("EO_ICON_DEFECT")));
  const w:any=iInput();w.icons[1].tested_at_small_size=false;
  assert.ok(evaluateOnepageCreativeQc(w).issues.includes("UNVERIFIED_EO_ICON"));
  const x:any=iInput();x.icons[1].asset_id=x.icons[0].asset_id;
  assert.ok(evaluateOnepageCreativeQc(x).issues.includes("REUSED_ICON_ASSET"));
});
test("clean host icon report never claims server image inspection",()=>{
  const o=evaluateOnepageCreativeQc(iInput());
  assert.equal(o.status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
  assert.equal(o.can_release,false);
});
test("gateway tool contract shared by both clients",()=>{
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.artwork_diversity.version,ONEPAGE_CREATIVE_QC_VERSION);
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.icon_first_pass_gate.version,ONEPAGE_CREATIVE_QC_VERSION);
  assert.deepEqual(UID_NATIVE_WORKFLOW.onepageProductionQc,ONEPAGE_PRODUCTION_QC);
  assert.deepEqual(getOnepageUiTemplate().production_qc_contract,ONEPAGE_PRODUCTION_QC);
});
