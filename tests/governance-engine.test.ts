import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCase, evaluateSuite, detectCandidateConflicts } from "../src/governance-engine.ts";
const b={id:"case-1",brand_id:"brand-1",branch_slug:"onepage-system",case_key:"approved-01",
 approved_output:{name:"DOG",product_type:"Ornament"},
 expected_assertions:{required_text:["DOG"],forbidden_text:["medical cure"],required_keys:["name","product_type"]}};
test("regression fail-closed without curated baseline",()=>{
 assert.equal(evaluateSuite([],[]).status,"blocked");
});
test("missing candidate output blocks",()=>{
 assert.equal(evaluateCase(b).status,"blocked");
});
test("verified required content passes mechanical assertions",()=>{
 assert.equal(evaluateSuite([b],[{baseline_id:"case-1",output:{name:"DOG",product_type:"Ornament"}}]).status,"passed");
});
test("forbidden content fails and blocks regression",()=>{
 assert.equal(evaluateSuite([b],[{baseline_id:"case-1",output:{name:"DOG",product_type:"Ornament",bad:"medical cure"}}]).status,"failed");
});
test("canonical lexical overlap is only advisory",()=>{
 const result=detectCandidateConflicts("Product photo must match actual ornament size",[{id:"rule1",content_md:"Actual ornament product photo must match size"}]);
 assert.equal(result[0]?.requires_human_review,true);
});
