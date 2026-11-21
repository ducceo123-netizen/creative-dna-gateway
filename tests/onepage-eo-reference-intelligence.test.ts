import test from "node:test";
import {strict as assert} from "node:assert";
import {buildOnepageEoReferencePack,evaluateOnepageEoOutcome,EO_REFERENCE_INTELLIGENCE_VERSION} from "../supabase/functions/_shared/onepage-eo-reference-intelligence.ts";
import {ONEPAGE_PRODUCTION_QC} from "../supabase/functions/_shared/onepage-production-qc.ts";
const brief={brand:"PawfectHouse",product_type:"Solar Fan Hat",use_cases:["gardening","outdoor cooling"],materials:["fabric"],recipients:["gardener"],occasions:["birthday"]};
const candidate=(id:string,product_type:string,extra:Record<string,unknown>={})=>({
 id,brand:"PawfectHouse",page_url:"https://pawfecthouse.com/products/"+id,product_type,
 use_cases:["gardening"],materials:["fabric"],recipients:["gardener"],occasions:["birthday"],
 approved:true,inspection:{desktop:true,mobile:true},image_urls:["https://cdn.example.com/"+id+".webp"],
 quality_notes:{banner_typography:"Careful headline hierarchy that supports the actual gardening moment",icons:"Unified optical icon weight in the original mapped Onepage"},
 ...extra
});
const base=(candidates:any[])=>({brief,store_origin:"https://pawfecthouse.com",scan_complete:true,candidates});
test("ranking favors exact Product Type first, then functional/material related Onepages",()=>{
 const p=buildOnepageEoReferencePack(base([
  candidate("same","Solar Fan Hat",{use_cases:[],materials:[],recipients:[],occasions:[]}),
  candidate("related","Gardening Sun Hat",{use_cases:["gardening","outdoor cooling"],materials:["fabric"],recipients:["gardener"],occasions:["birthday"]}),
  candidate("unrelated","Ornament",{use_cases:[],materials:[],recipients:[],occasions:[]})
 ]));
 assert.equal(p.status,"QUALITY_BAR_REFERENCES_REPORTED");
 assert.equal(p.ranked_references[0].id,"same");
 assert.ok(p.ranked_references[0].score>p.ranked_references[1].score);
 assert.equal(p.creative_copying_allowed,false);
 assert.equal(p.visual_similarity_is_target,false);
 assert.match(p.independence_rules.join(" "),/NOT as a composition/);
});
test("a live page, uninspected page and cross-brand page are not approved references",()=>{
 const p=buildOnepageEoReferencePack(base([
  candidate("unapproved","Solar Fan Hat",{approved:false}),
  candidate("unseen","Solar Fan Hat",{inspection:{desktop:true,mobile:false}}),
  candidate("other-brand","Solar Fan Hat",{brand:"GiftSoul",page_url:"https://giftsoul.co/products/other-brand"}),
  candidate("good","Solar Fan Hat")
 ]));
 assert.equal(p.ranked_references.length,1);
 assert.equal(p.ranked_references[0].id,"good");
 assert.ok(p.issues.includes("CROSS_BRAND_REFERENCE_EXCLUDED"));
 assert.equal(p.server_pixel_inspected,false);
});
test("no reference does NOT stall Onepage research/creative workflow",()=>{
 const p=buildOnepageEoReferencePack(base([]));
 assert.equal(p.status,"REFERENCE_UNAVAILABLE_CONTINUE_CANONICAL_DNA");
 assert.match(p.fallback,/continue the task/);
 assert.equal(ONEPAGE_PRODUCTION_QC.eo_reference_intelligence.require_owner_approval_pause,false);
 assert.equal(ONEPAGE_PRODUCTION_QC.eo_reference_intelligence.studio_dependency,false);
 assert.equal(EO_REFERENCE_INTELLIGENCE_VERSION,"uid-onepage-eo-reference-intelligence/2026-11-21.v1");
});
test("outcome fails copied execution even if declared high quality; repair one slot",()=>{
 const input={task_id:"solar-hat",content_version:"v2",reference_ids:["good"],
 desktop_overall_url:"https://cdn.example.com/full-desktop.png",mobile_overall_url:"https://cdn.example.com/full-mobile.png",
 inspections:[
 {section:"banner_typography",slot:"banner_desktop",source_image_url:"https://cdn.example.com/banner.webp",
 inspected_full_size:true,quality_meets_reference:true,distinct_from_reference_execution:false,product_factually_correct:true,
 notes:"Typography attractive, but execution replicates exactly the original reference layout"},
 {section:"icons",slot:"icons",source_image_url:"https://cdn.example.com/icons.webp",inspected_full_size:true,
 quality_meets_reference:true,distinct_from_reference_execution:true,product_factually_correct:true,
 notes:"Inspected all four distinct generated icons at full-size and mapped mobile"},
 {section:"mobile",slot:"banner_mobile",source_image_url:"https://cdn.example.com/mobile.webp",
 inspected_full_size:true,quality_meets_reference:true,distinct_from_reference_execution:true,product_factually_correct:true,
 notes:"Responsive headline and subject composition inspected against the quality bar"}
 ]};
 const bad=evaluateOnepageEoOutcome(input);
 assert.equal(bad.status,"NEEDS_IN_TASK_REPAIR");
 assert.deepEqual(bad.affected_slots,["banner_desktop"]);
 assert.ok(bad.issues.includes("OVER_COPIED_REFERENCE:banner_desktop"));
 const fixed=evaluateOnepageEoOutcome({...input,inspections:input.inspections.map(x=>({...x,distinct_from_reference_execution:true}))});
 assert.equal(fixed.status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
 assert.equal(fixed.server_pixel_inspected,false);
});
