import test from "node:test";
import assert from "node:assert/strict";
import { validateRegressionAttestation } from "../src/governance-regression.ts";

const complete = {
 evidence_urls:["PDP https://example.com/product"],baseline_ids:["onepage-puzzle-approved-v1"],
 scope_checked:true,canonical_conflicts_checked:true,product_truth_verified:true,
 before_after_reviewed:true,severe_regressions:0,
 review_note:"Compared the approved baseline; product fidelity remains intact."
};
test("fails closed without evidence",()=>{
 const r=validateRegressionAttestation({ ...complete,evidence_urls:[] });
 assert.equal(r.ok,false);
});
test("blocks nonzero severe regressions",()=>{
 assert.equal(validateRegressionAttestation({ ...complete,severe_regressions:1 }).ok,false);
});
test("blocks missing canonical review attestation",()=>{
 assert.equal(validateRegressionAttestation({ ...complete,canonical_conflicts_checked:false }).ok,false);
});
test("accepts complete manually attested regression review",()=>{
 const r=validateRegressionAttestation(complete);
 assert.equal(r.ok,true);
 assert.equal(r.attestation?.severe_regressions,0);
});
