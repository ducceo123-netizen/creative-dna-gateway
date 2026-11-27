import {test} from "node:test";
import assert from "node:assert/strict";
import {compactOnepage,restoreOnepage,benchmarkOnepage} from "./lean-packet.ts";
test("roundtrip restores exact structural values",()=>{
 const gtk={production_qc_contract:{rules:["hard"]},portable_quality_playbook:{rule:"keep"},live_html_feedback:{enabled:true}};
 const p={ui_mapping_template:gtk,ui_mapping_templates:{gtk,faq:{...gtk,mode:"FAQ"}},creative_quality_contract:{owner_supplemental_rules:[1],agent_rule_reviewed_supplemental_rules:[2]},owner_supplemental_contract:{rules:[1]},agent_rule_reviewed_supplemental_contract:{rules:[2]},hard_gates:{all:true},unknown:{keep:true}};
 const c=compactOnepage(p);assert.deepEqual(restoreOnepage(c),p);assert.equal(Object.keys(c.aliases).length,6);assert.equal(benchmarkOnepage(p).roundtrip,true);
});
test("conflicting, missing and unknown fields remain untouched",()=>{
 const p={ui_mapping_template:{legacy:true},ui_mapping_templates:{gtk:{legacy:false}},owner_supplemental_contract:{rules:[1]},creative_quality_contract:{owner_supplemental_rules:[2]},unknown:[null,0,false]};
 const c=compactOnepage(p);assert.deepEqual(c.aliases,{});assert.deepEqual(restoreOnepage(c),p);
});
test("invalid aliases fail closed",()=>{
 const c=compactOnepage({});c.aliases["__proto__.x"]="bad";assert.throws(()=>restoreOnepage(c));
});
