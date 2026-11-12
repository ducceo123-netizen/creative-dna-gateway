import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

test("verified Owner review is primary; AI handoff is optional and collapsed",()=>{
  const s=readFileSync(new URL("../src/components/AdminFeedback.tsx",import.meta.url),"utf8");
  const owner=s.indexOf("Duyệt trực tiếp · Owner");
  const ai=s.indexOf('data-admin-tool="ai-review"');
  assert.ok(owner>0,"Owner action available");
  assert.ok(ai>owner,"Optional AI review appears after Owner action");
  assert.match(s.slice(owner,ai),/Không cần bàn giao AI/);
  assert.match(s.slice(ai,ai+850),/Nhờ AI rà soát trước khi duyệt/);
  assert.match(s.slice(ai,ai+1100),/RuleReviewHandoff/);
  assert.match(s.slice(owner-250,owner+250),/path:"owner"/);
});
test("gateway retains authenticated, exact-version Owner acceptance invariants",()=>{
  const s=readFileSync(new URL("../server.ts",import.meta.url),"utf8");
  assert.match(s,/app\.post\("\/api\/admin\/feedback\/:id\/accept-rule"/);
  assert.match(s,/authorization\?\.startsWith\("Bearer "\)/);
  assert.match(s,/req\.body\?\.approve_rule!==true/);
  assert.match(s,/candidate_hash/);
  assert.match(s,/rule_hash/);
  assert.match(s,/plan_hash/);
});
