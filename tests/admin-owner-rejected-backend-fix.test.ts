import {test} from "node:test";
import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {validatePreflight} from "../src/components/feedback-review.ts";
const source=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");

test("Rejected bulk delete uses transactional dependent-row cleanup, no direct parent delete",()=>{
 const edge=source("supabase/functions/creative-dna-admin-feedback/index.ts");
 const sql=source("supabase/sql/uid_admin_delete_rejected_feedback.sql");
 const gateway=source("server.ts");
 assert.match(edge,/uid_admin_delete_rejected_feedback/);
 assert.match(edge,/body\.status !== "rejected"/);
 assert.doesNotMatch(edge.slice(edge.indexOf('if (body.mode === "delete_all")'),edge.indexOf('if (body.mode === "list")')),/\.from\("knowledge_proposals"\)\s*\.delete\(/);
 assert.match(sql,/where status = 'rejected' for update/);
 assert.match(sql,/delete from uid_rule_v3_private\.audit where proposal_id=any\(ids\)/);
 assert.match(sql,/delete from uid_rule_v3_private\.requests where proposal_id=any\(ids\)/);
 assert.match(sql,/delete from public\.uid_review_requests where proposal_id=any\(ids\)/);
 assert.match(sql,/get diagnostics deleted_count = row_count/);
 assert.match(sql,/revoke all on function public\.uid_admin_delete_rejected_feedback\(boolean\) from public, anon, authenticated/);
 assert.match(sql,/grant execute on function public\.uid_admin_delete_rejected_feedback\(boolean\) to service_role/);
 assert.match(gateway,/if \(status !== "rejected"\)/);
});

test("Owner preflight may contain a blocked compiled plan without hiding its reason",()=>{
 const src=source("src/components/feedback-review.ts");
 const panel=source("src/components/FeedbackReviewPanel.tsx");
 assert.doesNotMatch(src,/data\.direct_rule\?\.eligible&&!data\.direct_rule_plan\?\.eligible/);
 assert.match(panel,/visibleData\.direct_rule_plan\?\.eligible===false/);
 assert.match(panel,/direct_rule_plan\.blockers/);
 assert.match(panel,/mutation\.current\|\|activeRead\.current/);
 assert.match(panel,/visibleData\.targets\.length>0&&!loading&&!refreshing/);
 assert.match(panel,/action==="rule"\?canAcceptRule/);
});

test("UI refuses to claim deletion without a rejected-only RPC receipt",()=>{
 const ui=source("src/components/AdminFeedback.tsx");
 assert.match(ui,/data\.status !== "rejected" \|\| data\.canonical_changed !== false/);
 assert.match(ui,/Number\.isSafeInteger\(data\.deleted_count\)/);
 assert.match(ui,/await load\(undefined, true, true\)/);
 assert.match(ui,/if \(!confirm\(/);
});
