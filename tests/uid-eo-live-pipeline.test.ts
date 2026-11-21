import test from "node:test";
import {strict as assert} from "node:assert";
import {scanOnepageEoStore} from "../uid-eo-store-scanner.ts";
import {auditOnepageEoPixels,trustedEoImageUrl,analyzeEoImageBytes} from "../uid-eo-pixel-audit.ts";
import {listEoLibrary,submitEoCandidate,approveEoReference,validEoReferencePage} from "../uid-eo-reference-library.ts";

test("live bounded scanner uses real product type, HTML section markers, actual image bytes and never approves",async()=>{
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAHUlEQVR4nGOsiDBnIBcwka1zVPOo5lHNo5qpohkAR+4BL9gQjwEAAAAASUVORK5CYII=","base64");
 const fetcher:typeof fetch=async(raw)=>{
  const url=String(raw);
  if(url.includes("/search/suggest.json"))return new Response(JSON.stringify({resources:{results:{products:[{url:"/products/solar-fan-hat"}]}}}),{headers:{"content-type":"application/json"}});
  if(url.includes("/products/solar-fan-hat.js"))return new Response(JSON.stringify({type:"Solar Fan Hat",title:"Personalized Solar Fan Hat"}),{headers:{"content-type":"text/javascript"}});
  if(url.includes("/products/solar-fan-hat"))return new Response("<html><h2>Why You'll Love It</h2><img data-src='https://cdn.shopify.com/sample-icon.png'/><h2>Product Details</h2><p>Garden Use</p></html>",{headers:{"content-type":"text/html"}});
  if(url.includes("cdn.shopify.com"))return new Response(new Uint8Array(png),{headers:{"content-type":"image/png"}});
  throw Error("unrecognized test source:"+url);
 };
 const result:any=await scanOnepageEoStore({brand:"pawfecthouse",product_type:"Solar Fan Hat",related_terms:["gardening"],limit:3,inspect_pixels:true},fetcher);
 assert.equal(result.status,"LIVE_BOUNDED_SCAN");
 assert.equal(result.candidates.length,1);
 assert.equal(result.candidates[0].product_type,"Solar Fan Hat");
 assert.equal(result.candidates[0].onepage_evidence,"SECTION_MARKERS_FOUND");
 assert.equal(result.candidates[0].approval_status,"DISCOVERED_NOT_APPROVED");
 assert.equal(result.pixel_receipts.pixel_checked_by_gateway,true);
 assert.equal(result.pixel_receipts.results[0].width,20);
 assert.equal(result.scan_complete,false);
});
test("image whitelist rejects SSRF sources, pixel decoder measures and detects duplicates",async()=>{
 assert.equal(trustedEoImageUrl("http://127.0.0.1/secret"),false);
 assert.equal(trustedEoImageUrl("https://evil.example.com/image.png"),false);
 assert.equal(trustedEoImageUrl("https://cdn.shopify.com/test.png"),true);
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAHUlEQVR4nGOsiDBnIBcwka1zVPOo5lHNo5qpohkAR+4BL9gQjwEAAAAASUVORK5CYII=","base64");
 const receipt=await analyzeEoImageBytes(png,"icon_1","https://cdn.shopify.com/a.png");
 assert.equal(receipt.measurement,"GATEWAY_DECODED_PIXELS");
 assert.equal(receipt.sha256.length,64);
 const fetcher:typeof fetch=async()=>new Response(new Uint8Array(png),{headers:{"content-type":"image/png"}});
 const audit:any=await auditOnepageEoPixels([{slot:"occasion_1",image_url:"https://cdn.shopify.com/a.png"},
  {slot:"occasion_2",image_url:"https://cdn.shopify.com/b.png"}],fetcher);
 assert.equal(audit.status,"PIXELS_MEASURED");
 assert.equal(audit.images_measured,2);
 assert.equal(audit.possible_duplicates[0].distance,0);
 assert.equal(audit.semantic_eo_quality_certified,false);
});
test("private shared library requires member JWT; candidate saves remain unapproved",async()=>{
 assert.equal((await listEoLibrary("pawfecthouse",null)).status,"AUTHENTICATED_UID_MEMBER_REQUIRED");
 assert.equal(validEoReferencePage("pawfecthouse","https://evil.com/products/a"),false);
 assert.equal(validEoReferencePage("pawfecthouse","https://pawfecthouse.com/products/hat"),true);
 const original=process.env.SUPABASE_PUBLISHABLE_KEY;
 process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_test";
 const actor="11111111-1111-4111-8111-111111111111";
 const calls:string[]=[];
 const fetcher:typeof fetch=async(raw,init)=>{
   const url=String(raw);calls.push(url);
   assert.match(String((init?.headers as any)?.Authorization),/^Bearer a\.b\.c$/);
   if(url.includes("/auth/v1/user"))return Response.json({id:actor});
   if(url.includes("/rest/v1/uid_eo_onepage_references")&&init?.method==="POST"){
     const row=JSON.parse(String(init.body));assert.equal(row.status,"discovered");
     assert.equal(row.submitted_by,actor);
     return Response.json([{id:actor,status:"discovered",version:1}],{status:201});
   }
   if(url.includes("/rest/v1/uid_eo_onepage_references"))return Response.json([{id:actor,status:"approved",brand_slug:"pawfecthouse"}]);
   throw Error("unexpected mocked call "+url);
 };
 try{
   const auth="Bearer a.b.c";
   const read:any=await listEoLibrary("pawfecthouse",auth,fetcher);
   assert.equal(read.status,"APPROVED_LIBRARY_READ");
   assert.equal(read.approved_count,1);
   const submit:any=await submitEoCandidate({brand:"pawfecthouse",page_url:"https://pawfecthouse.com/products/hat",
      product_type:"Solar Fan Hat",image_urls:["https://cdn.shopify.com/test.png"]},auth,fetcher);
   assert.equal(submit.status,"CANDIDATE_SAVED_NOT_APPROVED");
   assert.equal(calls.length,3);
   const approval:any=await approveEoReference({reference_id:actor,expected_version:1,justification:"Approved EO art direction reference",
     quality_notes:{},desktop_inspected:true,mobile_inspected:true,explicit_admin_approval:false},auth,fetcher);
   assert.equal(approval.status,"EXPLICIT_INSPECTED_ADMIN_APPROVAL_REQUIRED");
 }finally{if(original===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=original;}
});
