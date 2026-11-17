import { test } from "node:test";
import { strict as assert } from "node:assert";
import { UID_EMBEDDED_UI_URI, UID_EMBEDDED_UI_HTML, UID_EMBEDDED_UI_META } from "../uid-embedded-task-ui.ts";
import { UID_DIRECT_OUTCOME_GUIDANCE, REVIEW_EXECUTION_GUIDANCE } from "../uid-brands-actions.ts";
import { readFileSync } from "node:fs";

test("embedded launcher is versioned and bound to output template",()=>{
  assert.equal(UID_EMBEDDED_UI_META.ui.resourceUri,UID_EMBEDDED_UI_URI);
  assert.match(UID_EMBEDDED_UI_HTML,/id="launcher"/);
  assert.match(UID_EMBEDDED_UI_HTML,/sendFollowUpMessage/);
  assert.doesNotMatch(UID_EMBEDDED_UI_HTML,/id="feedbackTabPanel"/);
  assert.match(UID_EMBEDDED_UI_HTML,/HTML overall preview/);
});
test("direct outcome skips content approval and retains evidence gates",()=>{
  assert.match(REVIEW_EXECUTION_GUIDANCE,/UID BRANDS DIRECT OUTCOME FLOW/);
  assert.match(UID_DIRECT_OUTCOME_GUIDANCE,/without inserting a content approval turn/);
  assert.match(UID_DIRECT_OUTCOME_GUIDANCE,/Preserve all product evidence/);
  assert.doesNotMatch(UID_EMBEDDED_UI_HTML,/id="content"/);
});
test("MCP launcher and review tools expose UI and host versioned resource",()=>{
 const s=readFileSync(new URL("../server.ts",import.meta.url),"utf8");
 assert.match(s,/registerResource\("uid-brands-embedded-brief-ui"/);
 assert.match(s,/UID_EMBEDDED_UI_META/);
});
