import test from "node:test";
import {strict as assert} from "node:assert";
import {evaluateOnepageProductTypeScope} from "../supabase/functions/_shared/onepage-product-type-scope.ts";
import {evaluateOnepageEoStoreReferences} from "../supabase/functions/_shared/onepage-eo-store-reference.ts";
import {ONEPAGE_PRODUCTION_QC} from "../supabase/functions/_shared/onepage-production-qc.ts";
const products=[
  {id:"1",title:"Custom Photo Oven Skirt – Mom Gift",product_type:"Oven Skirt",url:"https://pawfecthouse.com/products/a"},
  {id:"2",title:"Personalized Oven Skirt Christmas",product_type:"Oven Skirt",url:"https://pawfecthouse.com/products/b"},
  {id:"3",title:"Oven Skirt Styled Apron For Dad",product_type:"Apron",url:"https://pawfecthouse.com/products/c"},
  {id:"4",title:"Vintage Oven Skirt Wall Art",product_type:"Poster",url:"https://pawfecthouse.com/products/d"}
];
test("name-only line chooses EXACT Shopify product_type and rejects keyword-in-title SKUs",()=>{
  const input={brand:"PawfectHouse",requested_product_type:"  OVEN   SKIRT ",scan_complete:true,has_more_pages:false,products};
  const o=evaluateOnepageProductTypeScope(input);
  assert.equal(o.status,"MATCHED_REQUIRES_HOST_PDP_REVIEW");
  assert.deepEqual(o.product_ids,["1","2"]);
  assert.equal("matched_count" in o ? o.matched_count : 0,2);
  assert.equal(o.title_contains_fallback,false);
});
test("missing exact Shopify type never broadens to fuzzy title matches or synonyms",()=>{
  const q={brand:"PawfectHouse",requested_product_type:"Oven Skirts",scan_complete:true,has_more_pages:false,products};
  const o=evaluateOnepageProductTypeScope(q);
  assert.equal(o.status,"BLOCKED");
  assert.deepEqual(o.product_ids,[]);
  assert.ok(o.issues.includes("NO_EXACT_PRODUCT_TYPE_MATCH"));
  const incomplete=evaluateOnepageProductTypeScope({...q,requested_product_type:"Oven Skirt",has_more_pages:true});
  assert.ok(incomplete.issues.includes("INCOMPLETE_STORE_PRODUCT_TYPE_SCAN"));
});
const reference=(n:number)=>({page_url:"https://pawfecthouse.com/products/ornament-"+n,
  image_url:"https://cdn.example.com/real-icon-"+n+".webp",inspected_full_size:true,inspected_mobile_size:true,
  image_is_actual_store_icon:true,
  stroke_note:"Consistent hand-drawn stroke from inspected live icon at full size",
  badge_note:"Solid warm circular badge with centered outlined symbol visible on site",
  palette_note:"Muted natural amber disc and brown outlined stroke as visually inspected"});
test("EO QC requires two independently inspected real same-brand store icons",()=>{
  const q={brand:"PawfectHouse",store_origin:"https://pawfecthouse.com",references:[reference(1),reference(2)]};
  const o=evaluateOnepageEoStoreReferences(q);
  assert.equal(o.status,"REFERENCE_REPORTED_REQUIRES_HOST_PIXEL_QA");
  assert.equal(o.server_pixel_inspected,false);
  assert.equal(o.can_certify_visual_parity,false);
  const missing=evaluateOnepageEoStoreReferences({...q,references:[reference(1)]});
  assert.ok(missing.issues.includes("REQUIRE_TWO_ACTUAL_STORE_ICON_REFERENCES"));
  const cross=evaluateOnepageEoStoreReferences({...q,references:[reference(1),{...reference(2),page_url:"https://giftsoul.co/collections/gifts"}]});
  assert.ok(cross.issues.includes("CROSS_BRAND_EO_SOURCE"));
  const generic=evaluateOnepageEoStoreReferences({...q,references:[reference(1),{...reference(2),image_url:"https://cdn.example.com/icon.svg"}]});
  assert.ok(generic.issues.includes("GENERIC_SVG_REFERENCE_NOT_ACCEPTED"));
});
test("Onepage shared policy routes exact types and requires brand-owned EO reference",()=>{
  assert.equal(ONEPAGE_PRODUCTION_QC.name_only_product_scope.authority,"SHOPIFY_PRODUCT_TYPE_EXACT");
  assert.equal(ONEPAGE_PRODUCTION_QC.image_gates.eo_store_reference.required_before_generating_icons,true);
});
