import test from "node:test";
import assert from "node:assert/strict";
import {discoverClipoReferences} from "../clipo-discovery.ts";

const ref={pack:"pawfecthouse--onepage--banner-mobile--demo--v000001",ref_id:"candidate-001",
 role:"technique",source:"https://pawfecthouse.com/products/demo",use_for:"Learn typo hierarchy",
 product_family:"Doormat",approval_source:null};
function fake(status=200,open=true){
 const calls:any[]=[];
 const fetcher:any=async (url:string,opts:any)=>{
  calls.push({url,opts});
  if(status!==200)return {ok:false,status};
  const {name,arguments:args}=JSON.parse(opts.body).params;
  const body=name==="search_reference_packs"
   ? {structuredContent:{status:args.slot==="banner mobile"?"matched":"no_match",
      matches:args.slot==="banner mobile"?[ref]:[]}}
   : {content:[{type:"text",text:JSON.stringify({status:open?"ok":"no_match"})},
       ...(open?[{type:"image",mimeType:"image/jpeg",data:"A".repeat(100)}]:[])]};
  return {ok:true,json:async()=>({result:body})};
 };
 return {calls,fetcher};
}
test("Clipo-first searches all slots then opens matched reference",async()=>{
 const {calls,fetcher}=fake();
 const data=await discoverClipoReferences("PawfectHouse",null,fetcher);
 assert.equal(data.status,"references_opened");assert.equal(data.opened.length,1);
 assert.equal(data.visual_inspection_required,true);
 assert(calls.some(c=>JSON.parse(c.opts.body).params.name==="open_reference_image"));
 assert(calls.every(c=>c.url.endsWith("/mcp")&&!c.opts.headers.Authorization));
 assert(!JSON.stringify(data).includes("A".repeat(70)));
});
test("member uses authenticated team MCP",async()=>{
 const {calls,fetcher}=fake();
 const data=await discoverClipoReferences("PawfectHouse","Bearer valid-member",fetcher);
 assert.equal(data.access,"team");
 assert(calls.every(c=>c.url.endsWith("/member/mcp")&&c.opts.headers.Authorization==="Bearer valid-member"));
 assert(!JSON.stringify(data).includes("valid-member"));
});
test("member denial is explicit and never reattempted against public MCP",async()=>{
 const {calls,fetcher}=fake(403);
 const data=await discoverClipoReferences("PawfectHouse","Bearer not-member",fetcher);
 assert.equal(data.status,"authorization_required");
 assert.equal(data.continue_task,true);assert.equal(calls.length,1);
 assert(calls[0].url.endsWith("/member/mcp"));
});
test("missing pixels do not count as inspected or opened",async()=>{
 const {fetcher}=fake(200,false);const data=await discoverClipoReferences("PawfectHouse",null,fetcher);
 assert.equal(data.status,"matches_unopened");assert.equal(data.opened.length,0);
});
test("MCP offline continues canonical Onepage work",async()=>{
 const data=await discoverClipoReferences("PawfectHouse",null,async()=>{throw Error("offline");});
 assert.equal(data.status,"unavailable");assert.equal(data.continue_task,true);
});

test("exact Onepage product family is passed as a ranking hint",async()=>{
 const {calls,fetcher}=fake();
 const data=await discoverClipoReferences("PawfectHouse",null,fetcher,6500,"Doormat");
 assert.equal(data.status,"references_opened");
 const search=calls.find(c=>JSON.parse(c.opts.body).params.name==="search_reference_packs");
 assert.equal(JSON.parse(search.opts.body).params.arguments.product_family,"Doormat");
});

test("explicit no_match continues the Onepage workflow without images",async()=>{
 const calls:any[]=[];
 const fetcher:any=async (url:string,opts:any)=>{
   const body=JSON.parse(opts.body);calls.push(body.params.name);
   return {ok:true,json:async()=>({result:{structuredContent:{status:"no_match",matches:[]}}})};
 };
 const data=await discoverClipoReferences("PawfectHouse",null,fetcher);
 assert.equal(data.status,"no_match");
 assert.equal(data.continue_task,true);
 assert.equal(data.matches.length,0);
 assert.equal(data.opened.length,0);
 assert.equal(calls.filter(x=>x==="search_reference_packs").length,5);
 assert.equal(calls.filter(x=>x==="open_reference_image").length,0);
 assert.equal(data.mcp_trace.filter(x=>x.operation==="search_reference_packs"&&x.rpc_confirmed).length,5);
});
