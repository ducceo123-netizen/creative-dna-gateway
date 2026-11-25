import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const server=readFileSync("server.ts","utf8");
test("public Clipo Onepage references never require login, even on legacy member MCP URL",()=>{
 const path=server.indexOf('app.all("/api/mcp-member"');
 assert(path>=0);
 const source=server.slice(path,path+1400);
 assert(source.indexOf("if(!req.headers.authorization)")>=0);
 assert(source.indexOf("return void mcpNodeHandler(req,res,req.body)")>=0);
 assert(source.indexOf("verifyMemberBearer")>source.indexOf("if(!req.headers.authorization)"));
});
