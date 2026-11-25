import test from "node:test";
import assert from "node:assert/strict";
import {verifyMemberBearer,memberResourceMetadata,memberAuthChallenge,UID_MEMBER_MCP_RESOURCE} from "../uid-member-oauth.ts";

test("MCP resource metadata links to Supabase Auth and exact protected resource",()=>{
 const v=memberResourceMetadata();
 assert.equal(v.resource,UID_MEMBER_MCP_RESOURCE);
 assert.equal(v.authorization_servers.length,1);
 assert(memberAuthChallenge().includes("/.well-known/oauth-protected-resource/api/mcp-member"));
});
test("without member bearer no upstream call is made",async()=>{
 let invoked=false;
 const result=await verifyMemberBearer(undefined,async()=>{invoked=true;throw Error("must not call")});
 assert.equal(result.code,401);assert.equal(result.status,"missing_bearer");
 assert.equal(invoked,false);
});
test("invalid member credentials are rejected",async()=>{
 const result=await verifyMemberBearer("Bearer bogus-token",async()=>({status:401} as Response));
 assert.equal(result.code,401);
 assert.equal(result.status,"invalid_or_inactive");
});
test("inactive UID member is forbidden",async()=>{
 const result=await verifyMemberBearer("Bearer valid-but-inactive",async()=>({status:403} as Response));
 assert.equal(result.code,403);
});
test("valid member ping is required",async()=>{
 const result=await verifyMemberBearer("Bearer authorized-member",async(url,opts)=>{
   assert(url.toString().endsWith("/member/mcp"));
   assert.equal((opts?.headers as Record<string,string>).Authorization,"Bearer authorized-member");
   return {status:200,json:async()=>({jsonrpc:"2.0",id:1,result:{}})} as Response;
 });
 assert.equal(result.code,200);assert.equal(result.status,"authorized");
});
test("bad upstream responses fail closed",async()=>{
 const result=await verifyMemberBearer("Bearer foo",async()=>({status:200,json:async()=>({})} as Response));
 assert.equal(result.code,503);
});
test("membership provider outages do not fall back to public",async()=>{
 const result=await verifyMemberBearer("Bearer token",async()=>{throw Error("offline")});
 assert.equal(result.code,503);
});
