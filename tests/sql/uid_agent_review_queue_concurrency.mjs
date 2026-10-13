/** Disposable localhost PostgreSQL only. Run after the fixture + migrations.
 * Dependency: pg, optionally located via UID_TEST_PG_MODULE. No remote DBs.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const { default: pg } = await import(process.env.UID_TEST_PG_MODULE || 'pg');
const { Client } = pg;
const host = process.env.PGHOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(host) || process.env.DATABASE_URL) {
  throw new Error('This destructive disposable fixture only supports explicit localhost PG* settings, never DATABASE_URL.');
}
const clients = [];
const open = async () => { const c = new Client({ host }); await c.connect(); clients.push(c); await c.query("SET statement_timeout='5s'; SET lock_timeout='4s'"); return c; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const owner = '90000000-0000-0000-0000-000000000010';
const proposals = ['90000000-0000-0000-0000-000000000201','90000000-0000-0000-0000-000000000202'];
const queueSnapshotCount = async admin => Number((await admin.query('SELECT count(*) n FROM public.uid_governance_snapshots WHERE proposal_id=ANY($1::uuid[])',[proposals])).rows[0].n);
const call = async (c, fn, args) => (await c.query(`SELECT public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`, args)).rows[0].result;
const submit = (c,q,r) => call(c,'uid_review_complete',[q.request_id,owner,'dot',q.lease_token,q.lease_version,q.candidate_hash,r]);
const makeReview = q => {
  const manifest=q.snapshot.media_manifest;
  const time=new Date().toISOString();
  const receipts=manifest.map(m=>({evidence_id:m.evidence_id,locator:m.locator,record_version:m.record_version,
    content_sha256:m.expected_content_sha256 || 'a'.repeat(64),revalidated_sha256:m.expected_content_sha256 || 'a'.repeat(64),
    object_version:m.object_version,inspected:true,media_type:'image/png',inspection_method:'image',retrieved_at:time,revalidated_at:time,
    note:'Synthetic concurrency fixture: all bytes and media verified.'}));
  const brands=[...new Set(q.snapshot.targets.map(t=>t.brand_id))];
  const findings=brands.flatMap(brand=>['product_truth','visual_quality','canonical_conflicts'].map(criterion=>({brand_id:brand,criterion,result:'passed',critical:false,
    note:'Synthetic concurrency fixture: all pinned evidence and canonical rules examined.',
    evidence_ids:manifest.filter(m=>m.brand_id===brand).map(m=>m.evidence_id).sort(),canonical_node_ids:q.snapshot.targets.filter(t=>t.brand_id===brand).map(t=>t.id).sort()})));
  return {schema_version:'uid.agent-review.v1',decision:'passed',review_note:'Synthetic test review, never evidence of real visual QC.',media_receipts:receipts,findings};
};
try {
 const admin=await open(), a=await open(), b=await open(), c=await open(), watch=await open();
 const waitForLock=async client=>{const pid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;return async()=>{const until=Date.now()+4000;while(Date.now()<until){if((await watch.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await pause(10);}throw new Error('Expected actual transaction lock wait');};};
 const bWait=await waitForLock(b);
 await admin.query(`
 INSERT INTO public.brands(id,slug,name) VALUES('90000000-0000-0000-0000-000000000001','concurrency','Concurrency test');
 INSERT INTO public.creative_dna_team_members(user_id,role,is_active) VALUES('${owner}','admin',true);
 INSERT INTO uid_rule_private.owner_config(singleton,owner_user_id,verified_at,verification_reference,enabled)
 VALUES(true,'${owner}',clock_timestamp(),'synthetic queue concurrency fixture',true)
 ON CONFLICT(singleton) DO UPDATE SET owner_user_id=excluded.owner_user_id,verified_at=excluded.verified_at,verification_reference=excluded.verification_reference,enabled=true;
 INSERT INTO public.knowledge_nodes(id,brand_id,slug,title,content_md) VALUES
 ('90000000-0000-0000-0000-000000000101','90000000-0000-0000-0000-000000000001','home-hero','Test hero','Original rule');
 INSERT INTO public.knowledge_proposals(id,knowledge_node_id,brand_id,raw_feedback,proposed_scope,proposed_content_md) SELECT id::uuid,
 '90000000-0000-0000-0000-000000000101','90000000-0000-0000-0000-000000000001','Approved concurrency change '||id,'Hero local',E'## Generalized Rule\nKeep product-led hero headline content for '||id||E'.\n\n## Expected Behavior\nKeep headline specific to the supplied product.\n\n## Reject Conditions\n- Reject generic headings.\n\n## Scope\nHero local\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH'
 FROM unnest(ARRAY['${proposals[0]}','${proposals[1]}']) id;
 INSERT INTO public.uid_governance_baselines(id,brand_id,branch_slug,case_key,source_brief,approved_output,expected_assertions,approved_by,approved_at) VALUES
 ('90000000-0000-0000-0000-000000000301','90000000-0000-0000-0000-000000000001','home-hero','case',
 '{"url":"https://example.test/source.png"}','{"title":"Verified shirt","image_url":"https://example.test/baseline.png"}',
 '{"required_keys":["title"]}','${owner}',clock_timestamp());
 INSERT INTO public.uid_governance_evaluations(proposal_id,candidate_hash,baseline_ids,test_results,evaluation_status,evaluator_version,completed_at)
 SELECT id,public.uid_governance_candidate_hash(id),ARRAY['90000000-0000-0000-0000-000000000301'::uuid],
 '[{"baseline_id":"90000000-0000-0000-0000-000000000301","case_key":"case","source_run_id":"real-fixture-run","artifact_url":"https://example.test/candidate.png","candidate_output":{"title":"Verified shirt"}}]',
 'blocked','mechanical-v2-scope-freshness',clock_timestamp() FROM public.knowledge_proposals WHERE id IN ('${proposals.join("','")}');`);
 for (const con of [a,b,c]) await con.query('SET ROLE service_role');
 const approve = async (con,p) => call(con,'uid_review_enqueue',[p,owner,await call(con,'uid_review_intent_hash',[p,owner])]);
 let requests=[]; for(const p of proposals) requests.push(await approve(a,p));
 assert.equal(requests[0].status,'queued',JSON.stringify(requests[0]));
 assert.equal(requests[1].status,'queued',JSON.stringify(requests[1]));
 // An uncommitted claim holds the first row; the independent claimer skips it.
 await a.query('BEGIN');
 const first=await call(a,'uid_review_claim',[owner,'dot']);
 const second=await call(b,'uid_review_claim',[owner,'dot']);
 assert.notEqual(first.request_id,second.request_id,'SKIP LOCKED claims different requests');
 assert.equal(first.lease_version,1); assert.equal(second.lease_version,1);
 await a.query('COMMIT');
 console.log('PASS independent concurrent claims use SKIP LOCKED');
 for(const q of [first,second]) await call(b,'uid_review_cancel',[q.request_id,q.proposal_id,owner]);
 requests=[]; for(const p of proposals) requests.push(await approve(a,p));
 // Claim holds nodes SHARE + request; enqueue must wait for nodes SRE, before
 // taking proposal/request locks. This used to invert the row lock order.
 await a.query('BEGIN');
 const claimed=await call(a,'uid_review_claim',[owner,'dot']);
 let settled=false;
 const waiting=approve(b,claimed.proposal_id).then(v=>{settled=true;return v;});
 await pause(100); assert.equal(settled,false,'enqueue waits at canonical serialization lock');
 await a.query('COMMIT');
 assert.equal((await waiting).id,claimed.request_id,'enqueue resumes idempotently without deadlock');
 console.log('PASS enqueue/claim lock ordering');
 // Cancellation wins the request lock; the waiting finalizer must not merge.
 await b.query('BEGIN');
 await call(b,'uid_review_cancel',[claimed.request_id,claimed.proposal_id,owner]);
 await pause(5); let completionError;
 const completing=submit(c,claimed,makeReview(claimed)).catch(e=>{completionError=e;});
 await pause(100); await b.query('COMMIT'); await completing;
 assert.match(completionError?.message || '',/Matching active review lease/);
 assert.equal(await queueSnapshotCount(admin),0);
 console.log('PASS cancel/complete race produces zero canonical writes');
 // Two same-lease completions serialize. The second reads the committed result.
 const remaining=await call(a,'uid_review_claim',[owner,'dot']);
 assert.ok(remaining); await pause(5); const review=makeReview(remaining);
 // A committed owner/membership revocation must win against every waiting
 // operation; even an otherwise valid complete cannot use its old active lease.
 await admin.query('BEGIN'); await admin.query('UPDATE uid_rule_private.owner_config SET enabled=false');
 const revokedComplete=submit(b,remaining,review).then(()=>null,e=>e);
 await bWait(); await admin.query('COMMIT');
 const revokedError=await revokedComplete;
 assert.equal(revokedError?.code,'42501'); assert.match(revokedError?.message||'',/configured owner required/);
 assert.equal(await queueSnapshotCount(admin),0);
 await admin.query('UPDATE uid_rule_private.owner_config SET enabled=true');
 console.log('PASS owner revocation wins against completion without canonical writes');
 await admin.query('BEGIN'); await admin.query('UPDATE public.creative_dna_team_members SET is_active=false WHERE user_id=$1',[owner]);
 const revokedRead=call(b,'uid_review_preflight',[remaining.proposal_id,owner]).then(()=>null,e=>e);
 await bWait(); await admin.query('COMMIT');
 assert.match((await revokedRead)?.message||'',/Active admin required/);
 await admin.query('UPDATE public.creative_dna_team_members SET is_active=true WHERE user_id=$1',[owner]);
 console.log('PASS membership revocation wins against preflight');
 // The owner read wrapper retains its configuration share lock until commit.
 await a.query('BEGIN'); await call(a,'uid_review_preflight',[remaining.proposal_id,owner]);
 let disabled=false;
 const pendingDisable=admin.query('UPDATE uid_rule_private.owner_config SET enabled=false').then(()=>{disabled=true;});
 await pause(100); assert.equal(disabled,false); await a.query('COMMIT'); await pendingDisable;
 await assert.rejects(()=>call(b,'uid_review_intent_hash',[remaining.proposal_id,owner]),e=>e.code==='42501');
 await admin.query('UPDATE uid_rule_private.owner_config SET enabled=true');
 console.log('PASS preflight locks authority through the transaction');
 const [x,y]=await Promise.all([submit(a,remaining,review),submit(b,remaining,review)]);
 assert.equal(x.status,'merged'); assert.deepEqual(x,y);
 const counts=(await admin.query(`SELECT (SELECT count(*) FROM public.uid_governance_snapshots WHERE proposal_id=ANY($1::uuid[])) snapshots,(SELECT count(*) FROM public.uid_agent_review_evaluations WHERE proposal_id=ANY($1::uuid[])) evaluations,(SELECT count(*) FROM public.training_events WHERE parsed_payload->>'proposal_id'=ANY($2::text[])) events`,[proposals,proposals])).rows[0];
 assert.deepEqual(Object.values(counts).map(Number),[2,1,1]);
 console.log('PASS simultaneous completion is exactly once');
 // Owner direct acceptance remains available during an agent lease. The queued
 // completion waits on canonical locks, then supersedes without another merge.
 const directProposal=claimed.proposal_id;
 await admin.query(`INSERT INTO public.uid_governance_evaluations(proposal_id,candidate_hash,baseline_ids,test_results,evaluation_status,evaluator_version,created_at,completed_at)
 SELECT proposal_id,public.uid_governance_candidate_hash(proposal_id),baseline_ids,test_results,'blocked',evaluator_version,clock_timestamp(),clock_timestamp()
 FROM public.uid_governance_evaluations WHERE proposal_id=$1 LIMIT 1`,[directProposal]);
 await approve(a,directProposal); const leasedDirect=await call(a,'uid_review_claim',[owner,'dot']);
 assert.equal(leasedDirect.proposal_id,directProposal);
 const directContext=await call(a,'uid_review_preflight',[directProposal,owner]);
 assert.equal(directContext.direct_rule.eligible,true,JSON.stringify(directContext.direct_rule.blockers));
 const plan={schema_version:'uid.owner-rule-plan.v1',candidate_hash:directContext.candidate_hash,rule_hash:directContext.direct_rule.rule_hash,
 targets:directContext.compiler_context.projected_targets.map(t=>({node_id:t.id,content_md:t.content_md,metadata:t.metadata,version:t.version,input_schema:t.input_schema,status:t.status,confidence:t.confidence}))};
 const stable=v=>v!==null&&typeof v==='object'?(Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'):JSON.stringify(v);
 const planHash=createHash('sha256').update(stable(plan)).digest('hex');
 await a.query('BEGIN');
 const directResult=await call(a,'uid_rule_accept',[directProposal,owner,directContext.candidate_hash,directContext.direct_rule.rule_hash,plan,planHash]);
 assert.equal(directResult.decision_kind,'owner_direct_rule');
 await pause(5); const staleFinalize=submit(b,leasedDirect,makeReview(leasedDirect));
 await bWait(); await a.query('COMMIT');
 const settledRequest=await staleFinalize;
 assert.equal(settledRequest.status,'superseded');
 assert.equal(settledRequest.outcome.canonical_changed,false);
 assert.equal((await admin.query('SELECT count(*)::int n FROM public.uid_governance_snapshots WHERE proposal_id=$1',[directProposal])).rows[0].n,2);
 assert.equal((await admin.query("SELECT count(*)::int n FROM public.uid_agent_review_evaluations WHERE proposal_id=$1 AND evaluation_status='passed'",[directProposal])).rows[0].n,0);
 console.log('PASS direct owner acceptance wins over old queued lease with no second merge');

 // A child inserted by another transaction must not become an unseen phantom
 // during append-only finalization of an otherwise uncompiled parent.
 const dependencyProposal='90000000-0000-0000-0000-000000000203';
 const dependencyChild='90000000-0000-0000-0000-000000000198';
 await admin.query(`INSERT INTO public.knowledge_proposals(id,knowledge_node_id,brand_id,raw_feedback,proposed_scope)
 VALUES($1,'90000000-0000-0000-0000-000000000101','90000000-0000-0000-0000-000000000001','Synthetic parent update','Hero local');
 `,[dependencyProposal]);
 await admin.query(`INSERT INTO public.uid_governance_evaluations(proposal_id,candidate_hash,baseline_ids,test_results,evaluation_status,evaluator_version,completed_at)
 SELECT $1,public.uid_governance_candidate_hash($1),baseline_ids,test_results,'blocked',evaluator_version,clock_timestamp()
 FROM public.uid_governance_evaluations WHERE proposal_id=$2 LIMIT 1`,[dependencyProposal,proposals[0]]);
 const intentBefore=await call(a,'uid_review_intent_hash',[dependencyProposal,owner]);
 await approve(a,dependencyProposal); let dependencyLease=await call(a,'uid_review_claim',[owner,'dot']);
 assert.equal(dependencyLease.proposal_id,dependencyProposal);
 const parentBefore=(await admin.query("SELECT to_jsonb(n) n FROM public.knowledge_nodes n WHERE id='90000000-0000-0000-0000-000000000101'")).rows[0].n;
 await admin.query('BEGIN');
 await admin.query(`INSERT INTO public.knowledge_nodes(id,brand_id,parent_id,slug,title,metadata)
 VALUES($1,'90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000101','compiled-child','Synthetic dependent child','{"creative_quality_contract":{"revision":"fixture-child"}}')`,[dependencyChild]);
 const childPhantomCompletion=submit(b,dependencyLease,makeReview(dependencyLease));
 await bWait(); await admin.query('COMMIT');
 const phantomResult=await childPhantomCompletion;
 assert.equal(phantomResult.status,'queued');assert.equal(phantomResult.outcome.canonical_changed,false);
 assert.equal(await call(a,'uid_review_claim',[owner,'dot']),null);
 assert.ok((await call(a,'uid_review_get',[dependencyProposal,owner])).blockers.some(b=>b.code==='unsupported_dependency_scope'));
 assert.equal(await call(a,'uid_review_intent_hash',[dependencyProposal,owner]),intentBefore);
 assert.deepEqual((await admin.query("SELECT to_jsonb(n) n FROM public.knowledge_nodes n WHERE id='90000000-0000-0000-0000-000000000101'")).rows[0].n,parentBefore);
 assert.equal((await admin.query('SELECT count(*)::int n FROM public.uid_governance_snapshots WHERE proposal_id=$1',[dependencyProposal])).rows[0].n,0);
 console.log('PASS committed child phantom wins against completion; next claim blocks with zero parent writes');
 // Removal of the unsupported live dependency allows a fresh attempt under
 // the same intent; reactivation while review is underway invalidates it again.
 await admin.query("UPDATE public.knowledge_nodes SET status='inactive' WHERE id=$1",[dependencyChild]);
 dependencyLease=await call(a,'uid_review_claim',[owner,'dot']);assert.ok(dependencyLease);assert.equal(dependencyLease.lease_version,2);
 await admin.query('BEGIN');await admin.query("UPDATE public.knowledge_nodes SET status='active' WHERE id=$1",[dependencyChild]);
 const reactivationCompletion=submit(b,dependencyLease,makeReview(dependencyLease));
 await bWait();await admin.query('COMMIT');
 assert.equal((await reactivationCompletion).status,'queued');
 assert.equal(await call(a,'uid_review_claim',[owner,'dot']),null);
 assert.deepEqual((await admin.query("SELECT to_jsonb(n) n FROM public.knowledge_nodes n WHERE id='90000000-0000-0000-0000-000000000101'")).rows[0].n,parentBefore);
 assert.equal((await admin.query('SELECT count(*)::int n FROM public.uid_governance_snapshots WHERE proposal_id=$1',[dependencyProposal])).rows[0].n,0);
 console.log('PASS dependency removal permits fresh QC; concurrent child reactivation fences old receipts');

} finally { for(const c of clients) {try {await c.query('ROLLBACK'); await c.end();} catch { /* best effort local teardown */ }} }
