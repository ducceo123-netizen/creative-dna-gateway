import test from "node:test";
import assert from "node:assert/strict";
import {actionForHumanScene,discoverHumanRealism,HUMAN_REALISM_QC} from "../clipo-human-realism.ts";
test("product-led action routing remains grounded",()=>{
 assert.equal(actionForHumanScene("pet doormat"),"walking_dog");
 assert.equal(actionForHumanScene("personalized apron for dad"),"cooking");
 assert.equal(actionForHumanScene("book lover bookmark"),"reading");
 assert.equal(actionForHumanScene("Christmas ornament gift"),"gift_exchange");
 assert.equal(actionForHumanScene("custom pillow unbox"),"unboxing");
 assert.equal(actionForHumanScene("mom and daughter decorating a Christmas tree"),"decorating_tree");
 assert.equal(actionForHumanScene("two 25yo besties laughing"),"friends_laughing");
 assert.equal(actionForHumanScene("grandmother cooking with granddaughter"),"grandparent_cooking");
 assert.equal(actionForHumanScene("woman cuddling her dog on sofa"),"pet_cuddling");
 assert.equal(actionForHumanScene("Woman cuddling her dog on a couch"),"pet_cuddling");
 assert.equal(actionForHumanScene("senior holding photo frame memorial"),"memorial_holding");
});
test("search + actual image payload receipt are recorded, never equated to visual QC",async()=>{
 const calls:any[]=[];const item={ref_id:"hr-pexels-5486829",title:"Hands with gift",
  source_url:"https://www.pexels.com/photo/person-holding-a-gift-with-ribbon-5486829/",
  license_url:"https://www.pexels.com/license/",action:"gift_wrapping",camera_angle:"overhead",
  frame_type:"hands_close",body_focus:"fingers",setting:"table",interaction:"gift_box",lighting:"daylight",
  study_notes:"Natural fingers",failure_checks:["no_extra_fingers"],tags:["gift"]};
 const fetcher:any=async (_url:string,options:any)=>{
  const body=JSON.parse(options.body);const op=body.params.name;calls.push(body.params);
  return {ok:true,json:async()=>({result:op==="search_human_realism_refs"
   ?{structuredContent:{status:"matched",matches:[item]}}:
    {content:[{type:"text",text:JSON.stringify({status:"ok",image_bytes:40000})},
       {type:"image",mimeType:"image/jpeg",data:"x".repeat(500)}]}})};
 };
 const r=await discoverHumanRealism("Christmas ornament",fetcher,1000);
 assert.equal(r.status,"images_opened");assert.equal(r.matches.length,1);assert.equal(r.opened.length,1);
 assert(r.requires_visual_review);assert(!JSON.stringify(r).includes("x".repeat(100)));
 assert.equal(calls[0].name,"search_human_realism_refs");assert.equal(calls[0].arguments.action,"gift_exchange");
 assert.equal(calls[1].name,"open_human_realism_ref");
 assert(HUMAN_REALISM_QC.body_integrity.some(v=>v.includes("fingers")));
});
test("offline Clipo does not break Onepage pipeline",async()=>{
 const r=await discoverHumanRealism("ornament",async()=>{throw Error("offline");});
 assert.equal(r.status,"unavailable");assert.equal(r.continue_task,true);
});
test("no match is explicit",async()=>{
 const r=await discoverHumanRealism("table runner",async()=>({ok:true,json:async()=>({
  result:{structuredContent:{status:"no_match",matches:[]}}})} as Response),1000);
 assert.equal(r.status,"no_match");assert.equal(r.opened.length,0);
});
