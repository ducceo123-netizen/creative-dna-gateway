import {test} from "node:test";
import assert from "node:assert/strict";
import {openSession} from "./stage-session.ts";
test("pinned stages retain gates, unknown rules, and exact retrieval",()=>{
 const p={hard_gates:{x:"HARD"},execution:["research","materials"],creative_quality_contract:{rules:[1]},ui_mapping_templates:{gtk:{x:1}},ui_mapping_template:{x:1},assets:[1],unknown_rule:{required:true},research_contract:{source:"exact"}};
 const s=openSession(p), r=s.read("research",s.revision);
 assert.deepEqual(r.data.hard_gates,p.hard_gates);
 assert.deepEqual(r.data.unknown_rule,p.unknown_rule);
 assert.ok(r.deferred.includes("ui_mapping_templates"));
 assert.deepEqual(s.readPath("ui_mapping_templates.gtk",s.revision),{x:1});
 assert.deepEqual(s.full(s.revision),p);
 assert.throws(()=>s.read("research","stale"));
 assert.throws(()=>s.readPath("__proto__",s.revision));
 p.hard_gates.x="changed";assert.equal(s.full(s.revision).hard_gates.x,"HARD");
});
