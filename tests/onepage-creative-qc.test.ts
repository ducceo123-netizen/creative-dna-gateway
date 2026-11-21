import { test } from "node:test";
import { strict as assert } from "node:assert";
import { EO_ICON_DEFECTS, ONEPAGE_CREATIVE_QC_VERSION, evaluateOnepageCreativeQc, onepageQcRecoveryPlan } from "../supabase/functions/_shared/onepage-creative-qc.ts";
import { ONEPAGE_PRODUCTION_QC, ONEPAGE_PRODUCTION_QC_GUIDANCE } from "../supabase/functions/_shared/onepage-production-qc.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { getOnepageUiTemplate } from "../onepage-ui-template.ts";

const designs=(n:number)=>Array.from({length:n},(_,i)=>({product_id:"p"+i,design_id:"art"+i,pdp_url:"https://pawfecthouse.com/products/product-"+i,visually_inspected:true}));
const stories=(ids:number[])=>ids.map((i,n)=>({slot:"occasion_"+n,story_id:"story-"+n,section:"occasion",product_id:"p"+i,design_id:"art"+i}));
const scan=(ids:string[])=>({scope:"collection",complete:true,has_more_pages:false,discovered_product_ids:ids,inspected_product_ids:ids});
const dInput=(ids:number[],catalog=4)=>({task_id:"onepage-11",content_version:"v4",scope:"design_diversity",inventory:designs(catalog),placements:stories(ids),catalog_scan:scan(Array.from({length:catalog},(_,i)=>"p"+i))});
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

test("distinct artwork on a single product does not fake product diversity",()=>{
  const inventory=Array.from({length:4},(_,i)=>({product_id:"only-sku",design_id:"design-"+i,pdp_url:"https://pawfecthouse.com/products/one",visually_inspected:true}));
  const placements=Array.from({length:6},(_,i)=>({slot:"slot"+i,story_id:"story"+i,section:"occasion",product_id:"only-sku",design_id:"design-"+(i%4)}));
  const input={task_id:"onepage-product",content_version:"v1",scope:"design_diversity",inventory,placements,catalog_scan:scan(["only-sku"])};
  const o=evaluateOnepageCreativeQc(input);
  // Only one verified SKU exists. Do not invent new products; a truthful limitation is allowed.
  assert.equal(o.status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
  assert.equal(o.evidence.expected_distinct_products,1);
});

test("same SKU with different artwork must not dominate when real alternative SKUs exist",()=>{
  const inventory=Array.from({length:4},(_,i)=>({product_id:"p"+i,design_id:"art"+i,pdp_url:"https://pawfecthouse.com/products/p"+i,visually_inspected:true}));
  inventory.push(...Array.from({length:4},(_,i)=>({product_id:"p0",design_id:"p0-d"+i,pdp_url:"https://pawfecthouse.com/products/p0",visually_inspected:true})));
  const placements=Array.from({length:6},(_,i)=>({slot:"slot"+i,story_id:"story"+i,section:"occasion",product_id:i<4?"p0":"p"+(i-2),design_id:i<4?"p0-d"+i:"art"+(i-2)}));
  const o=evaluateOnepageCreativeQc({task_id:"onepage-product",content_version:"v1",scope:"design_diversity",inventory,placements,catalog_scan:scan(["p0","p1","p2","p3"])});
  assert.equal(o.status,"BLOCKED");
  assert.ok(o.issues.includes("INSUFFICIENT_DISTINCT_PRODUCTS"));
  assert.ok(o.issues.includes("OVERUSED_PRODUCT:p0"));
  assert.ok(o.issues.some(issue=>issue.startsWith("ADJACENT_PRODUCT_REPEAT:")));
});

test("balanced verified products and artwork remain valid",()=>{
  const o=evaluateOnepageCreativeQc(dInput([0,1,2,3,0,1],4));
  assert.equal(o.status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
  assert.equal(o.evidence.distinct_products_used,4);
});

test("catalog scan must cover every discovered product before a Onepage plan can pass",()=>{
  const x:any=dInput([0,1,2,3],4);delete x.catalog_scan;
  assert.ok(evaluateOnepageCreativeQc(x).issues.includes("INCOMPLETE_PRODUCT_SCAN"));
  const y:any=dInput([0,1,2,3],4);y.catalog_scan.has_more_pages=true;
  assert.ok(evaluateOnepageCreativeQc(y).issues.includes("INCOMPLETE_PRODUCT_SCAN"));
  const z:any=dInput([0,1,2,3],4);z.catalog_scan.inspected_product_ids=["p0","p1"];
  assert.ok(evaluateOnepageCreativeQc(z).issues.includes("UNINSPECTED_DISCOVERED_PRODUCT"));
});
test("FAQs require real supported buyer questions; generic content cannot pass",()=>{
  const base:any={task_id:"task",content_version:"v1",scope:"post_story_choice",post_story:{
    selected:"faqs",pdp_evidence_urls:["https://example.com/pdp"],buyer_questions:[],gtk_insights:[],
    faq_questions:["Is this a nice gift?"],page_overlap_check:true,
    selection_reason:"Based on the available product facts, format must reduce a concrete buying uncertainty."}};
  assert.ok(evaluateOnepageCreativeQc(base).issues.includes("FAQ_WITHOUT_REAL_BUYER_QUESTIONS"));
  base.post_story.selected="good_to_know";
  base.post_story.gtk_insights=[
    {insight:"Confirm exact customization text before ordering",evidence_url:"https://example.com/pdp",nonduplicative:true},
    {insight:"Check product dimensions against intended placement",evidence_url:"https://example.com/pdp",nonduplicative:true}];
  assert.equal(evaluateOnepageCreativeQc(base).status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
});
test("Onepage same-section camera angle and framing repetition is blocked",()=>{
  const shots:any=[0,1,2].map(i=>({slot:"wyl_0"+i,section:"why_you_love_it",angle:"eye_level",framing:"medium",
    composition:"eye level front hero",product_id:"p"+i,visually_inspected:true}));
  const input:any={task_id:"task",content_version:"v1",scope:"shot_diversity",shots};
  const result=evaluateOnepageCreativeQc(input);
  assert.ok(result.issues.includes("SAME_ANGLE_IN_SECTION:why_you_love_it"));
  assert.ok(result.issues.includes("SAME_FRAMING_IN_SECTION:why_you_love_it"));
  shots[1].angle="top_down";shots[1].framing="closeup";shots[1].composition="top-down realistic closeup";
  shots[2].angle="three_quarter";shots[2].framing="wide";shots[2].composition="wide real use context";
  assert.equal(evaluateOnepageCreativeQc(input).status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
});

test("new quality gates do not strand a task if chat has a legacy QC tool schema",()=>{
  const qc=ONEPAGE_PRODUCTION_QC.continuous_execution;
  assert.equal(qc.requires_content_approval,false);
  assert.deepEqual(qc.stages,["research","internal_content_decision","materials","html_overall_desktop_mobile","feedback_ready"]);
  assert.match(qc.stale_tool_schema,/older scopes/);
  assert.match(qc.qc_reporting_vs_creation,/Continue with all work/);
  assert.match(qc.final_release,/Never call an unfinished preview complete/);
  assert.match(ONEPAGE_PRODUCTION_QC_GUIDANCE,/NOT_CALLED\/NOT_VERIFIED/);
});

test("content visual proof gate blocks generic, unproven or duplicated shots",()=>{
  const proof=(slot:string,key:string,target:string)=>({
    slot,section:"why_you_love_it",content_key:key,proof_target:target,
    proof_source_url:"https://pawfecthouse.com/products/verified-product",
    angle:"three_quarter",framing:"closeup",proof_visible:true,content_supported:true,
    generic_lifestyle:false,inspected_full_size:true,
    inspection_note:"Full-size shot inspected against PDP and corresponding factual claim; the proof target is clear and product orientation believable."
  });
  const input:any={task_id:"task-proof",content_version:"v1",scope:"content_visual_match",visual_proofs:[
    proof("wyl_01","Personalize with their name","readable printed name"),
    proof("wyl_02","Soft material texture","woven fabric closeup")
  ]};
  assert.equal(evaluateOnepageCreativeQc(input).status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
  input.visual_proofs[0].generic_lifestyle=true;
  assert.ok(evaluateOnepageCreativeQc(input).issues.includes("GENERIC_LIFESTYLE_NOT_PROOF:wyl_01"));
  input.visual_proofs[0].generic_lifestyle=false;
  input.visual_proofs[0].proof_visible=false;
  assert.ok(evaluateOnepageCreativeQc(input).issues.includes("CONTENT_KEY_NOT_VISUALLY_PROVEN:wyl_01"));
  input.visual_proofs[0].proof_visible=true;
  input.visual_proofs.push(proof("wyl_03","Personalize with their name","readable printed name"));
  assert.ok(evaluateOnepageCreativeQc(input).issues.some(x=>x.startsWith("DUPLICATED_VISUAL_PROOF:")));
  input.visual_proofs[2].proof_target="alternate real name engraving in meaningful use";
  assert.equal(evaluateOnepageCreativeQc(input).status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
});
test("shared workflow requires content-to-visual evidence while keeping continuous flow",()=>{
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.content_visual_match.scope,"content_visual_match");
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.content_visual_match.version,ONEPAGE_CREATIVE_QC_VERSION);
  assert.match(ONEPAGE_PRODUCTION_QC_GUIDANCE,/CONTENT-TO-VISUAL MATCH HARD GATE/);
  assert.match(ONEPAGE_PRODUCTION_QC_GUIDANCE,/NOT_CALLED/);
  assert.equal(ONEPAGE_PRODUCTION_QC.continuous_execution.requires_content_approval,false);
});

test("repairable Onepage QC instructs in-task correction, never owner approval",()=>{
  const rules=ONEPAGE_PRODUCTION_QC.autonomous_qc_repair;
  assert.equal(rules.mode,"REPAIR_IN_TASK_NOT_OWNER_APPROVAL");
  assert.ok(rules.severity.repairable.includes("icon_palette_drift"));
  assert.match(rules.icon_color_process.join(" "),/raster|PNG\/WebP/);
  assert.match(rules.automatic_retry,/targeted regeneration/);
  assert.match(ONEPAGE_PRODUCTION_QC_GUIDANCE,/AUTO-REPAIR LOOP/);
  assert.equal(ONEPAGE_PRODUCTION_QC.continuous_execution.requires_content_approval,false);
  const failed:any=iInput();failed.icons[0].defects.off_brand_style_or_colors=true;
  const result=evaluateOnepageCreativeQc(failed);
  assert.equal(result.status,"BLOCKED");
  assert.match(result.next_action,/Automatically repair ONLY failing local slots/);
  assert.match(result.next_action,/Do not ask owner/);
  assert.equal(result.can_release,false);
});

test("failed icon palette QC provides in-task repair, not owner review or fake final delivery",()=>{
  const input:any=iInput();
  input.icons[0].defects.off_brand_style_or_colors=true;
  const r=evaluateOnepageCreativeQc(input);
  assert.equal(r.status,"BLOCKED");
  assert.equal(r.recovery.owner_approval_required,false);
  assert.equal(r.recovery.terminal,false);
  assert.equal(r.recovery.defer_owner_review_until_qc_ready,true);
  assert.ok(r.recovery.affected_slots.includes(input.icons[0].slot));
  assert.equal(r.can_release,false);
  assert.equal(ONEPAGE_PRODUCTION_QC.handoff.do_not_surface_repairable_issues_as_owner_review,true);
  assert.ok(!ONEPAGE_PRODUCTION_QC.handoff.stages.includes("content_approval" as any));
});
test("passing creative report still needs real pixel and overall inspection",()=>{
  const p=onepageQcRecoveryPlan([],"eo_icons");
  assert.equal(p.state,"HOST_VISUAL_QA_REQUIRED");
  assert.equal(p.owner_approval_required,false);
  assert.equal(p.terminal,false);
  assert.equal(p.defer_owner_review_until_qc_ready,false);
});

test("GTK has priority even when meaningful FAQ questions also exist",()=>{
  const base:any={task_id:"gtk-priority",content_version:"v1",scope:"post_story_choice",post_story:{
    selected:"faqs",pdp_evidence_urls:["https://pawfecthouse.com/products/sample"],
    buyer_questions:[{question:"Which size fits?",evidence_url:"https://pawfecthouse.com/products/sample",answer_supported:true},{question:"Is customization available?",evidence_url:"https://pawfecthouse.com/products/sample",answer_supported:true}],
    gtk_insights:[{insight:"See size chart before ordering",evidence_url:"https://pawfecthouse.com/products/sample",nonduplicative:true},{insight:"Personalized text can be reviewed before checkout",evidence_url:"https://pawfecthouse.com/products/sample",nonduplicative:true}],
    faq_questions:["Which size fits?","Is customization available?"],page_overlap_check:true,
    selection_reason:"Two genuine buyer uncertainties, but actionable GTK insights exist and should take priority."}};
  const faq=evaluateOnepageCreativeQc(base);
  assert.ok(faq.issues.includes("FAQ_SELECTED_WHEN_GTK_IS_SUITABLE"));
  base.post_story.selected="good_to_know";
  assert.equal(evaluateOnepageCreativeQc(base).status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
});
test("FAQ is allowed only as a documented exception when GTK is unsupported",()=>{
  const input:any={task_id:"gtk-fallback",content_version:"v1",scope:"post_story_choice",post_story:{
    selected:"faqs",pdp_evidence_urls:["https://pawfecthouse.com/products/sample"],
    buyer_questions:[{question:"Does it need assembly?",evidence_url:"https://pawfecthouse.com/products/sample",answer_supported:true},{question:"What is included?",evidence_url:"https://pawfecthouse.com/products/sample",answer_supported:true}],
    gtk_insights:[],faq_questions:["Does it need assembly?","What is included?"],page_overlap_check:true,
    selection_reason:"No two nonduplicated product tips are supported, while specific buying uncertainties have documented answers."}};
  assert.equal(evaluateOnepageCreativeQc(input).status,"REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA");
  assert.equal(ONEPAGE_PRODUCTION_QC.content_choice.default,"good_to_know");
  assert.match(ONEPAGE_PRODUCTION_QC.content_choice.faq_exception_condition,/FAQ ONLY/);
});
