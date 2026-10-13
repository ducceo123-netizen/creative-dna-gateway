-- Disposable PostgreSQL only. These are synthetic test receipts, never real QC.
begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION: %',message; end if; end $$;
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then if position(lower(expected) in lower(sqlerrm))>0 then return; end if; raise exception 'Expected %, got %',expected,sqlerrm; end;
 raise exception 'Expected %, command succeeded',expected;
end $$;
insert into public.brands(id,slug,name) values
 ('00000000-0000-0000-0000-000000000001','a','Brand A'),('00000000-0000-0000-0000-000000000002','b','Brand B');
insert into public.creative_dna_team_members(user_id,role,is_active) values
 ('00000000-0000-0000-0000-000000000010','admin',true),('00000000-0000-0000-0000-000000000011','admin',false),
 ('00000000-0000-0000-0000-000000000012','contributor',true),('00000000-0000-0000-0000-000000000013','admin',true);
-- Synthetic configured owner only; this transaction is rolled back.
insert into uid_rule_private.owner_config(singleton,owner_user_id,verified_at,verification_reference,enabled)
values(true,'00000000-0000-0000-0000-000000000010',clock_timestamp(),'synthetic queue SQL fixture',true);
insert into public.knowledge_nodes(id,brand_id,slug,title,content_md)
 select ('00000000-0000-0000-0000-00000000010'||i)::uuid,('00000000-0000-0000-0000-00000000000'||i)::uuid,'onepage-system','Onepage '||i,'Canonical rules before review' from generate_series(1,2)i;
insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,raw_feedback,proposed_scope) values
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','New approved structural feedback','Shared Onepage structure');
create temp table state as select
 '00000000-0000-0000-0000-000000000201'::uuid proposal,'00000000-0000-0000-0000-000000000010'::uuid owner,
 public.uid_review_intent_hash('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000010') intent_hash,
 null::jsonb request,null::jsonb claim,null::jsonb review;

-- Public and client roles cannot call a worker RPC, invoke helpers, read private
-- evidence or insert even a fabricated queue/evaluation row.
select pg_temp.assert_true(not has_function_privilege(role_name,signature,'EXECUTE'),'deny '||role_name||' '||signature)
from (values('anon'),('authenticated'))r(role_name) cross join (values
 ('public.uid_review_enqueue(uuid,uuid,text)'),('public.uid_review_get(uuid,uuid)'),('public.uid_review_preflight(uuid,uuid)'),
 ('public.uid_review_cancel(uuid,uuid,uuid)'),('public.uid_review_claim(uuid,text)'),
 ('public.uid_review_complete(uuid,uuid,text,uuid,integer,text,jsonb)'),('public.uid_review_intent_hash(uuid,uuid)'))f(signature);
select pg_temp.assert_true(not has_table_privilege(role_name,tablename,'SELECT,INSERT,UPDATE,DELETE'),'private '||role_name||' '||tablename)
from (values('anon'),('authenticated'),('service_role'))r(role_name) cross join (values
 ('public.uid_review_requests'),('public.uid_review_attempts'),('public.uid_review_events'),('public.uid_agent_review_evaluations'))t(tablename);
select pg_temp.assert_true(not has_function_privilege('service_role','public.admin_accept_merge_creative_dna_proposal(uuid,uuid,text)','EXECUTE'),'legacy direct bypass closed'),
 pg_temp.assert_true(not has_function_privilege('service_role','public.uid_review_snapshot(uuid)','EXECUTE'),'private snapshot helper'),
 pg_temp.assert_true(not has_function_privilege('service_role','public.uid_review_assess_receipts(jsonb,jsonb,timestamp with time zone,timestamp with time zone)','EXECUTE'),'private evaluator helper');
select pg_temp.expect_error(format('select public.uid_review_enqueue(%L,%L,%L)',proposal,'00000000-0000-0000-0000-000000000011',intent_hash),'Active admin required') from state;
select pg_temp.expect_error(format('select public.uid_review_enqueue(%L,%L,%L)',proposal,'00000000-0000-0000-0000-000000000012',intent_hash),'Active admin required') from state;
select pg_temp.expect_error(format('select public.uid_review_enqueue(%L,%L,%L)',proposal,owner,'forged'),'patch or target scope changed') from state;
update state set request=public.uid_review_enqueue(proposal,owner,intent_hash);
select pg_temp.assert_true(request->>'status'='blocked','missing baseline blocks'),
 pg_temp.assert_true(public.uid_review_claim(owner,'dot') is null,'missing baseline cannot be claimed'),
 pg_temp.assert_true(public.uid_review_enqueue(proposal,owner,intent_hash)->>'id'=request->>'id','owner intent enqueue idempotent'),
 pg_temp.assert_true(not(request ?| array['owner_user_id','intent','snapshot','lease_token','claimant']),'public status strips private packet') from state;
select pg_temp.assert_true((public.uid_review_preflight(proposal,owner)->>'review_intent_hash')=intent_hash,'atomic displayed approval identity'),
 pg_temp.assert_true(public.uid_review_preflight(proposal,owner)#>>'{review_request,id}'=request->>'id','preflight own request only') from state;
select pg_temp.expect_error(format('select public.uid_review_cancel(%L,%L,%L)',request->>'id',proposal,'00000000-0000-0000-0000-000000000013'),'Enabled verified configured owner required') from state;
select pg_temp.expect_error(format('select public.uid_review_cancel(%L,%L,%L)',request->>'id','00000000-0000-0000-0000-000000000999',owner),'Owner review request not found') from state;

-- Every public queue operation rejects a non-owner, a missing/disabled config,
-- and revoked membership before exposing status, packets or completion replays.
create function pg_temp.expect_owner_error(command text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when insufficient_privilege then
  if sqlerrm='Enabled verified configured owner required' then return; end if;
  raise exception 'Wrong owner boundary error: %',sqlerrm;
 end;
 raise exception 'Configured-owner denial did not occur';
end $$;
create function pg_temp.owner_commands(p_actor uuid,p_proposal uuid,p_request uuid,p_hash text) returns setof text language sql as $$
 select format('select public.%s',part) from unnest(array[
  format('uid_review_preflight(%L,%L)',p_proposal,p_actor),
  format('uid_review_intent_hash(%L,%L)',p_proposal,p_actor),
  format('uid_review_enqueue(%L,%L,%L)',p_proposal,p_actor,p_hash),
  format('uid_review_get(%L,%L)',p_proposal,p_actor),
  format('uid_review_cancel(%L,%L,%L)',p_request,p_proposal,p_actor),
  format('uid_review_claim(%L,''dot'')',p_actor),
  format('uid_review_complete(%L,%L,''dot'',%L,1,''irrelevant'',''{}'')',p_request,p_actor,gen_random_uuid())
 ])part
$$;
do $$ declare s record; command text; mutation text; begin
 select * into s from state;
 for command in select * from pg_temp.owner_commands('00000000-0000-0000-0000-000000000013',s.proposal,(s.request->>'id')::uuid,s.intent_hash) loop
  perform pg_temp.expect_owner_error(command);
 end loop;
 for mutation in select * from (values
  ('delete from uid_rule_private.owner_config'),
  ('update uid_rule_private.owner_config set enabled=false'),
  ($q$update uid_rule_private.owner_config set owner_user_id='00000000-0000-0000-0000-000000000013'$q$)
 )x(command) loop
  begin
   execute mutation;
   for command in select * from pg_temp.owner_commands(s.owner,s.proposal,(s.request->>'id')::uuid,s.intent_hash) loop
    perform pg_temp.expect_owner_error(command);
   end loop;
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
 begin
  update public.creative_dna_team_members set is_active=false where user_id=s.owner;
  for command in select * from pg_temp.owner_commands(s.owner,s.proposal,(s.request->>'id')::uuid,s.intent_hash) loop
   perform pg_temp.expect_error(command,'Active admin required');
  end loop;
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 -- The replacement owner still cannot access the old owner's request or lease.
 begin
  update uid_rule_private.owner_config set owner_user_id='00000000-0000-0000-0000-000000000013';
  perform pg_temp.assert_true(public.uid_review_get(s.proposal,'00000000-0000-0000-0000-000000000013') is null,'new configured owner cannot read old request');
  perform pg_temp.assert_true(public.uid_review_claim('00000000-0000-0000-0000-000000000013','dot') is null,'new owner cannot claim old owner approval');
  perform pg_temp.expect_error(format('select public.uid_review_cancel(%L,%L,%L)',s.request->>'id',s.proposal,'00000000-0000-0000-0000-000000000013'),'Owner review request not found');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;
select pg_temp.assert_true(not has_function_privilege('service_role','uid_rule_private.assert_review_owner(uuid)','EXECUTE'),'owner assertion remains internal'),
 pg_temp.assert_true(not has_function_privilege('service_role','uid_rule_private.review_preflight_snapshot(uuid,uuid)','EXECUTE'),'atomic snapshot reader remains internal'),
 pg_temp.assert_true(not has_schema_privilege('service_role','uid_rule_private','USAGE'),'no private schema exposure'),
 pg_temp.assert_true(not has_table_privilege('service_role','uid_rule_private.owner_config','SELECT,INSERT,UPDATE,DELETE'),'no owner config API exposure');
select pg_temp.assert_true(public.uid_review_preflight(proposal,owner)->'direct_rule'=public.uid_rule_preflight(proposal,owner)->'direct_rule','combined preflight preserves direct eligibility'),
 pg_temp.assert_true(public.uid_review_preflight(proposal,owner)->'compiler_context'=public.uid_rule_preflight(proposal,owner)->'compiler_context','combined preflight includes same compiler scope'),
 pg_temp.assert_true(public.uid_review_preflight(proposal,owner)->>'review_intent_hash'=intent_hash,'combined preflight binds queue intent') from state;

-- The intent pins the displayed actual mirror closure, even inactive mirrors.
do $$ declare s record; h text; begin
 select * into s from state;
 begin
  insert into public.brands(id,slug,name) values('00000000-0000-0000-0000-000000000099','giftsoul','GiftSoul');
  insert into public.knowledge_nodes(id,brand_id,slug,title,status,content_md) values
   ('00000000-0000-0000-0000-000000000199','00000000-0000-0000-0000-000000000099','onepage-system','Inactive mirror','inactive','Current inactive mirror');
  h:=public.uid_review_intent_hash(s.proposal,s.owner);
  perform pg_temp.assert_true(h<>s.intent_hash,'new inactive mirror changes approval membership');
  perform pg_temp.assert_true(public.uid_review_preflight(s.proposal,s.owner)->>'review_intent_hash'=h,'display and hash share actual closure');
  update public.knowledge_nodes set content_md='Changed inactive mirror content' where id='00000000-0000-0000-0000-000000000199';
  perform pg_temp.assert_true(public.uid_review_intent_hash(s.proposal,s.owner)=h,'inactive mirror content is fresh QC state, not a new intent');
  perform pg_temp.expect_error(format('select public.uid_review_enqueue(%L,%L,%L)',s.proposal,s.owner,s.intent_hash),'target scope changed');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Real baseline arrival changes QC state without changing the approved idea.
insert into public.uid_governance_baselines(id,brand_id,branch_slug,case_key,source_brief,approved_output,expected_assertions,approved_by,approved_at)
select ('00000000-0000-0000-0000-00000000030'||i)::uuid,('00000000-0000-0000-0000-00000000000'||i)::uuid,'onepage-system','quality-'||i,
 jsonb_build_object('product','Verified shirt','source_image',jsonb_build_object('url','https://example.test/source-'||i||'.png','content_sha256',repeat('a',64),'object_version','source-v1')),
 jsonb_build_object('title','Verified shirt','product_id','sku-'||i,'image_url','https://example.test/approved-'||i||'.png'),
 '{"required_text":["Verified shirt"],"forbidden_text":["fake claim"],"required_keys":["title","image_url"],"immutable_fields":["product_id"]}',
 '00000000-0000-0000-0000-000000000010',clock_timestamp() from generate_series(1,2)i;
select pg_temp.assert_true(public.uid_review_intent_hash(proposal,owner)=intent_hash,'baseline arrival does not require new approval'),
 pg_temp.assert_true(public.uid_review_claim(owner,'dot') is null,'missing candidates blocks after baseline arrival') from state;
select pg_temp.assert_true(public.uid_review_get(proposal,owner)->'blockers' @> '[{"code":"missing_candidate"}]','candidate remediation') from state;
select pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(public.uid_review_get(proposal,owner)->'blockers') b where b->>'code'='missing_candidate' and b->>'next_action' ilike '%approve again%'),'evidence-only arrival does not require reapproval') from state;

create function pg_temp.record_candidates(p_proposal uuid) returns uuid language plpgsql as $$
declare e uuid;
begin
 insert into public.uid_governance_evaluations(proposal_id,candidate_hash,baseline_ids,test_results,evaluation_status,evaluator_version,created_at,completed_at)
 select p_proposal,public.uid_governance_candidate_hash(p_proposal),array_agg(b.id order by b.id),
 jsonb_agg(jsonb_build_object('baseline_id',b.id,'case_key',b.case_key,'source_run_id','test-run-'||b.id,
 'artifact_url','https://example.test/candidate-'||b.id||'.png','candidate_output',jsonb_build_object('title','Verified shirt',
 'product_id',b.approved_output->>'product_id','image_url','https://example.test/candidate-'||b.id||'.png'),
 'status','passed','issues','[]'::jsonb) order by b.id),
 'blocked','mechanical-v2-scope-freshness',clock_timestamp(),clock_timestamp()
 from public.uid_governance_applicable_baselines(p_proposal)b where b.approved_at is not null and not public.uid_governance_is_reference_only(b) returning id into e;
 return e;
end $$;
select pg_temp.record_candidates(proposal) from state;
update state set claim=public.uid_review_claim(owner,'dot');
select pg_temp.assert_true(claim->>'request_id'=request->>'id','same approved request wakes after real evidence arrives'),
 pg_temp.assert_true(claim->>'lease_version'='1','first lease generation'),
 pg_temp.assert_true(jsonb_array_length(claim#>'{snapshot,candidate_runs}')=2,'full brand candidate coverage'),
 pg_temp.assert_true(jsonb_array_length(claim#>'{snapshot,media_manifest}')=8,'source baseline and candidate artifact/output pinned'),
 pg_temp.assert_true(public.uid_review_claim(owner,'dot') is null,'active lease not claimed twice') from state;
select pg_temp.expect_error(format('select public.uid_review_complete(%L,%L,%L,%L,%s,%L,%L)',claim->>'request_id',owner,'other',claim->>'lease_token',claim->>'lease_version',claim->>'candidate_hash','{}'),'Matching fenced review lease') from state;
select pg_temp.expect_error(format('select public.uid_review_complete(%L,%L,%L,%L,%s,%L,%L)',claim->>'request_id',owner,'dot',gen_random_uuid(),claim->>'lease_version',claim->>'candidate_hash','{}'),'Matching fenced review lease') from state;

create function pg_temp.make_review(c jsonb) returns jsonb language sql as $$
 select jsonb_build_object('schema_version','uid.agent-review.v1','decision','passed','review_note','Synthetic fixture: all controlled checks passed for both brands.',
 'media_receipts',(select jsonb_agg(jsonb_build_object('evidence_id',m->>'evidence_id','locator',m->>'locator','record_version',m->>'record_version',
  'content_sha256',coalesce(m->>'expected_content_sha256',repeat('a',64)),'revalidated_sha256',coalesce(m->>'expected_content_sha256',repeat('a',64)),
  'object_version',m->'object_version','inspected',true,'media_type','image/png','inspection_method','image',
  'retrieved_at',clock_timestamp(),'revalidated_at',clock_timestamp(),'note','Synthetic fixture only: bytes and visual evidence inspected.') order by m->>'evidence_id')
  from jsonb_array_elements(c#>'{snapshot,media_manifest}')m),
 'findings',(select jsonb_agg(jsonb_build_object('brand_id',b.brand,'criterion',criterion,'result','passed','critical',false,
  'note','Synthetic fixture only: criterion checked against all required evidence.',
  'evidence_ids',(select jsonb_agg(m->'evidence_id' order by m->>'evidence_id') from jsonb_array_elements(c#>'{snapshot,media_manifest}')m where m->'brand_id'=b.brand),
  'canonical_node_ids',(select jsonb_agg(t->'id' order by t->>'id') from jsonb_array_elements(c#>'{snapshot,targets}')t where t->'brand_id'=b.brand)) order by b.brand::text,criterion)
  from (select distinct t->'brand_id' brand from jsonb_array_elements(c#>'{snapshot,targets}')t)b cross join unnest(array['product_truth','visual_quality','canonical_conflicts'])criterion))
$$;
update state set review=pg_temp.make_review(claim);

-- Each malformed/unknown review independently blocks with zero canonical writes.
-- Savepoints restore the same active claim between adversarial inputs.
do $$ declare s record; change text; bad jsonb; result jsonb; before_nodes jsonb; begin
 select * into s from state;
 select jsonb_agg(to_jsonb(n) order by id) into before_nodes from public.knowledge_nodes n;
 for change in select * from (values
  ('null'),('''{}''::jsonb'),('jsonb_set($1,''{decision}'',''"blocked"'')'),('jsonb_set($1,''{review_note}'',''"short"'')'),
  ('jsonb_set($1,''{media_receipts}'',''null'')'),('jsonb_set($1,''{media_receipts}'',''[]'')'),
  ('jsonb_set($1,''{media_receipts,0,inspected}'',''null'')'),('jsonb_set($1,''{media_receipts,0,content_sha256}'',''"invalid"'')'),
  ('jsonb_set($1,''{media_receipts,0,revalidated_sha256}'',to_jsonb(repeat(''b'',64)))'),
  ('jsonb_set($1,''{media_receipts,0,record_version}'',''"wrong-version"'')'),
  ('jsonb_set($1,''{media_receipts,0,locator}'',''"https://example.test/wrong.png"'')'),
  ('jsonb_set($1,''{media_receipts,0,retrieved_at}'',''"2020-01-01T00:00:00Z"'')'),
  ('jsonb_set($1,''{media_receipts,0,revalidated_at}'',''"2099-01-01T00:00:00Z"'')'),
  ('jsonb_set($1,''{media_receipts,0,revalidated_at}'',''"not-a-date"'')'),
  ('jsonb_set($1,''{media_receipts,0,media_type}'',''"application/octet-stream"'')'),
  ('jsonb_set($1,''{media_receipts,0,inspection_method}'',''"assumed"'')'),
  ('jsonb_set($1,''{media_receipts,0}'',$1#>''{media_receipts,1}'')'),
  ('jsonb_set($1,''{findings}'',''null'')'),('jsonb_set($1,''{findings}'',''[]'')'),
  ('jsonb_set($1,''{findings,0,result}'',''"unknown"'')'),('jsonb_set($1,''{findings,0,result}'',''"failed"'')'),
  ('jsonb_set($1,''{findings,0,critical}'',''true'')'),('jsonb_set($1,''{findings,0,critical}'',''null'')'),
  ('jsonb_set($1,''{findings,0,evidence_ids}'',''[]'')'),('jsonb_set($1,''{findings,0,canonical_node_ids}'',''[]'')'),
  ('jsonb_set($1,''{findings,0}'',$1#>''{findings,1}'')'),('jsonb_set($1,''{manually_reviewed}'',''true'')')
 )x(expression) loop
  begin
   execute 'select '||change into bad using s.review;
   result:=public.uid_review_complete((s.claim->>'request_id')::uuid,s.owner,'dot',(s.claim->>'lease_token')::uuid,(s.claim->>'lease_version')::int,s.claim->>'candidate_hash',bad);
   perform pg_temp.assert_true(result->>'status'='blocked','malformed review blocked: '||change);
   perform pg_temp.assert_true((select jsonb_agg(to_jsonb(n) order by id) from public.knowledge_nodes n)=before_nodes,'no canonical write for '||change);
   perform pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'no merge snapshots for blocked review');
   perform pg_temp.assert_true(public.uid_review_claim(s.owner,'dot') is null,'unchanged review failure waits one hour');
   perform pg_temp.assert_true(public.uid_review_complete((s.claim->>'request_id')::uuid,s.owner,'dot',(s.claim->>'lease_token')::uuid,(s.claim->>'lease_version')::int,s.claim->>'candidate_hash',bad)=result,'blocked completion replay idempotent');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
end $$;

-- Records and approved intent cannot be rewritten, even with a caller-set GUC.
select pg_temp.expect_error(format('update public.uid_review_requests set status=''merged'' where id=%L',request->>'id'),'authorized queue RPC') from state;
select pg_temp.expect_error(format('delete from public.uid_review_requests where id=%L',request->>'id'),'cannot be deleted') from state;
select pg_temp.expect_error(format('update public.uid_review_attempts set snapshot=''{}'' where request_id=%L',request->>'id'),'immutable') from state;
select pg_temp.expect_error('update public.uid_review_events set details=''{}''','immutable');
select set_config('uid.review_action','claim',true);
select pg_temp.expect_error(format('update public.uid_review_requests set intent=''{}'' where id=%L',request->>'id'),'immutable') from state;
select set_config('uid.review_action','',true);

-- Owner cancellation races safely with completion on the same row.
do $$ declare s record; result jsonb; begin select * into s from state;
 begin
  result:=public.uid_review_cancel((s.request->>'id')::uuid,s.proposal,s.owner);
  perform pg_temp.assert_true(result->>'status'='cancelled','cancel active lease');
  perform pg_temp.expect_error(format('select public.uid_review_complete(%L,%L,%L,%L,%s,%L,%L)',s.claim->>'request_id',s.owner,'dot',s.claim->>'lease_token',s.claim->>'lease_version',s.claim->>'candidate_hash',s.review),'Matching active review lease');
  perform pg_temp.assert_true(public.uid_review_cancel((s.request->>'id')::uuid,s.proposal,s.owner)=result,'cancel replay idempotent');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Every material QC mutation invalidates the old completion without revoking the
-- approved idea; the old receipts can never be combined with fresh evidence.
do $$ declare s record; change text; result jsonb; begin select * into s from state;
 for change in select * from (values
  ($q$update public.knowledge_nodes set content_md=content_md||' new rule' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$update public.knowledge_nodes set metadata='{"new":true}' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$update public.uid_governance_baselines set approved_output=jsonb_set(approved_output,'{title}','"Different shirt"') where id='00000000-0000-0000-0000-000000000301'$q$),
  ($q$update public.uid_governance_baselines set source_brief=jsonb_set(source_brief,'{product}','"Different source"') where id='00000000-0000-0000-0000-000000000301'$q$),
  ($q$update public.uid_governance_evaluations set test_results=jsonb_set(test_results,'{0,artifact_url}','"https://example.test/new.png"')$q$)
 )x(statement) loop
  begin
   execute change;
   perform pg_temp.assert_true(public.uid_review_intent_hash(s.proposal,s.owner)=s.intent_hash,'QC drift preserves intent');
   result:=public.uid_review_complete((s.claim->>'request_id')::uuid,s.owner,'dot',(s.claim->>'lease_token')::uuid,(s.claim->>'lease_version')::int,s.claim->>'candidate_hash',s.review);
   perform pg_temp.assert_true(result->>'status'='queued','QC drift requires fresh claim');
   perform pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'no snapshots on stale completion');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
 for change in select * from (values
  ($q$update public.knowledge_proposals set raw_feedback='Different proposal patch' where id='00000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set proposed_scope='Brand style only' where id='00000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_nodes set status='inactive' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$insert into public.knowledge_nodes(brand_id,slug,title) values('00000000-0000-0000-0000-000000000001','onepage-system','New target')$q$)
 )x(statement) loop
  begin
   execute change;
   perform pg_temp.assert_true(public.uid_review_intent_hash(s.proposal,s.owner)<>s.intent_hash,'patch/membership drift changes intent');
   result:=public.uid_review_complete((s.claim->>'request_id')::uuid,s.owner,'dot',(s.claim->>'lease_token')::uuid,(s.claim->>'lease_version')::int,s.claim->>'candidate_hash',s.review);
   perform pg_temp.assert_true(result->>'status'='superseded','material intent drift requires new owner approval');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
end $$;

-- Mechanical checks are recomputed from pinned stored output and approved assertions.
do $$ declare c jsonb; altered jsonb; change text; begin
 select claim->'snapshot' into c from state;
 for change in select * from (values
  ('jsonb_set($1,''{candidate_runs,0,output,title}'',''"Missing approved words"'')'),
  ('jsonb_set($1,''{candidate_runs,0,output,title}'',''"Verified shirt with fake claim"'')'),
  ('$1#-''{candidate_runs,0,output,title}'''),
  ('jsonb_set($1,''{candidate_runs,0,output,product_id}'',''"wrong-product"'')'),
  ('jsonb_set($1,''{baselines,0,expected_assertions,required_text}'',''null'')'),
  ('jsonb_set($1,''{baselines,0,expected_assertions,required_keys}'',''[null]'')'),
  ('jsonb_set($1,''{baselines,0,expected_assertions}'',''{}'')'),
  ('jsonb_set($1,''{candidate_runs,0,test_result_count}'',''2'')'),
  ('jsonb_set($1,''{candidate_runs,0,artifact_url}'',''"http://insecure.test/output"'')'),
  ('jsonb_set($1,''{candidate_runs,0,source_run_id}'',''""'')'),
  ('jsonb_set($1,''{candidate_runs,0,output}'',''null'')'),
  ('jsonb_set($1,''{media_manifest}'',''[]'')'),
  ('jsonb_set($1,''{dependent_nodes}'',''null'')'),
  ('$1-''dependent_nodes''')
 )x(expression) loop
  execute 'select '||change into altered using c;
  perform pg_temp.assert_true(public.uid_review_checks(altered)->'blockers'<>'[]'::jsonb,'mechanical/media mutation blocked: '||change);
 end loop;
end $$;

-- Expiry/fencing fixtures are owner-only test setup, never production RPCs.
do $$ declare s record; q uuid; old_token uuid:=gen_random_uuid(); claim2 jsonb; result jsonb; begin
 select * into s from state;
 begin
  perform public.uid_review_cancel((s.request->>'id')::uuid,s.proposal,s.owner);
  perform set_config('uid.review_action','enqueue',true);
  insert into public.uid_review_requests(proposal_id,owner_user_id,intent_hash,intent,status,created_at,updated_at,expires_at)
  values(s.proposal,s.owner,s.intent_hash,public.uid_review_intent(s.proposal,s.owner),'queued',clock_timestamp()-interval '25 hours',clock_timestamp()-interval '25 hours',clock_timestamp()-interval '1 hour') returning id into q;
  perform set_config('uid.review_action','',true);
  perform public.uid_review_claim(s.owner,'dot');
  perform pg_temp.assert_true((select status='expired' from public.uid_review_requests where id=q),'expired intent never claimed');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  perform public.uid_review_cancel((s.request->>'id')::uuid,s.proposal,s.owner);
  perform set_config('uid.review_action','enqueue',true);
  insert into public.uid_review_requests(proposal_id,owner_user_id,intent_hash,intent,status)
  values(s.proposal,s.owner,s.intent_hash,public.uid_review_intent(s.proposal,s.owner),'queued') returning id into q;
  perform set_config('uid.review_action','claim',true);
  update public.uid_review_requests set status='leased',claimant='dot',lease_token=old_token,lease_version=1,
   leased_at=clock_timestamp()-interval '20 minutes',lease_expires_at=clock_timestamp()-interval '5 minutes' where id=q;
  insert into public.uid_review_attempts(request_id,lease_version,lease_token,claimant,candidate_hash,snapshot_hash,snapshot,leased_at,lease_expires_at)
  values(q,1,old_token,'dot',s.claim->>'candidate_hash',s.claim->>'snapshot_hash',s.claim->'snapshot',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '5 minutes');
  perform set_config('uid.review_action','',true);
  perform pg_temp.expect_error(format('select public.uid_review_complete(%L,%L,%L,%L,1,%L,%L)',q,s.owner,'dot',old_token,s.claim->>'candidate_hash',s.review),'Review lease expired');
  claim2:=public.uid_review_claim(s.owner,'dot');
  perform pg_temp.assert_true((claim2->>'request_id')::uuid=q and claim2->>'lease_version'='2' and (claim2->>'lease_token')::uuid<>old_token,'expired lease reclaimed with new token and version');
  perform pg_temp.expect_error(format('select public.uid_review_complete(%L,%L,%L,%L,1,%L,%L)',q,s.owner,'dot',old_token,s.claim->>'candidate_hash',s.review),'Matching active review lease');
  result:=public.uid_review_complete(q,s.owner,'dot',(claim2->>'lease_token')::uuid,2,claim2->>'candidate_hash',s.review);
  perform pg_temp.assert_true(result->>'status'='blocked','old lease media receipts cannot be reused');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Onepage cannot use append-only legacy finalization while compiler/mirror
-- integration is pending. Passing QC is not misreported as a successful merge.
update state set request=public.uid_review_complete((claim->>'request_id')::uuid,owner,'dot',(claim->>'lease_token')::uuid,(claim->>'lease_version')::int,claim->>'candidate_hash',review);
select pg_temp.assert_true(request->>'status'='blocked' and request->'blockers' @> '[{"code":"compiler_integration_required"}]','Onepage compiler integration explicitly blocked'),
 pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'no append-only Onepage canonical writes') from state;

-- Exercise the supported non-Onepage branch finalization separately.
insert into public.knowledge_nodes(id,brand_id,slug,title,content_md) values
 ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000001','hero','Hero rules','Current hero rules');
insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,raw_feedback,proposed_scope) values
 ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000001','Approved local hero change','Hero layout');
insert into public.uid_governance_baselines(id,brand_id,branch_slug,case_key,source_brief,approved_output,expected_assertions,approved_by,approved_at)
 select '00000000-0000-0000-0000-000000000306',brand_id,'hero','hero-quality',source_brief,approved_output,expected_assertions,approved_by,approved_at
 from public.uid_governance_baselines where id='00000000-0000-0000-0000-000000000301';
update state set proposal='00000000-0000-0000-0000-000000000202';
update state set intent_hash=public.uid_review_intent_hash(proposal,owner);
select pg_temp.record_candidates(proposal) from state;
update state set request=public.uid_review_enqueue(proposal,owner,intent_hash);
update state set claim=public.uid_review_claim(owner,'dot');
update state set review=pg_temp.make_review(claim);

-- Existing active children block even an uncompiled parent. Child arrival,
-- activation and reparenting after a lease invalidate QC but not owner intent.
do $$ declare s record; change text; result jsonb; snap jsonb; changed jsonb; q jsonb; begin
 select * into s from state;
 for change in select * from (values
  ($q$insert into public.knowledge_nodes(id,brand_id,parent_id,slug,title,metadata) values('00000000-0000-0000-0000-000000000198','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000105','child','Compiled child','{"creative_quality_contract":{"revision":"child"}}')$q$),
  ($q$insert into public.knowledge_nodes(id,brand_id,parent_id,slug,title,status) values('00000000-0000-0000-0000-000000000198','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000105','child','Inactive child','inactive'); update public.knowledge_nodes set status='active' where id='00000000-0000-0000-0000-000000000198'$q$),
  ($q$insert into public.knowledge_nodes(id,brand_id,slug,title) values('00000000-0000-0000-0000-000000000198','00000000-0000-0000-0000-000000000001','child','Reparented child'); update public.knowledge_nodes set parent_id='00000000-0000-0000-0000-000000000105' where id='00000000-0000-0000-0000-000000000198'$q$)
 )x(statement) loop
  begin
   execute change;
   snap:=public.uid_review_snapshot(s.proposal);
   perform pg_temp.assert_true(jsonb_array_length(snap->'dependent_nodes')=1 and snap#>>'{dependent_nodes,0,id}'='00000000-0000-0000-0000-000000000198','exact dependency row pinned');
   perform pg_temp.assert_true(public.uid_review_intent_hash(s.proposal,s.owner)=s.intent_hash,'dependency QC drift does not invent a different owner patch');
   perform pg_temp.assert_true(public.uid_review_checks(snap)->'blockers' @> '[{"code":"unsupported_dependency_scope"}]','existing active child blocks readiness');
   update public.knowledge_nodes set metadata=metadata||'{"changed_child_evidence":true}' where id='00000000-0000-0000-0000-000000000198';
   changed:=public.uid_review_snapshot(s.proposal);
   perform pg_temp.assert_true(public.uid_review_digest(changed)<>public.uid_review_digest(snap),'dependency content is snapshot-pinned');
   result:=public.uid_review_complete((s.claim->>'request_id')::uuid,s.owner,'dot',(s.claim->>'lease_token')::uuid,(s.claim->>'lease_version')::int,s.claim->>'candidate_hash',s.review);
   perform pg_temp.assert_true(result->>'status'='queued' and result->'blockers' @> '[{"code":"snapshot_changed"}]','dependency phantom invalidates old review');
   perform pg_temp.assert_true(public.uid_review_claim(s.owner,'dot') is null,'unsupported dependency cannot be claimed');
   perform pg_temp.assert_true(public.uid_review_get(s.proposal,s.owner)->'blockers' @> '[{"code":"unsupported_dependency_scope"}]','claim reports dependency blocker');
   perform public.uid_review_cancel((s.request->>'id')::uuid,s.proposal,s.owner);
   q:=public.uid_review_enqueue(s.proposal,s.owner,s.intent_hash);
   perform pg_temp.assert_true(q->>'status'='blocked' and q->'blockers' @> '[{"code":"unsupported_dependency_scope"}]','new enqueue with existing child also blocks');
   perform pg_temp.assert_true((select content_md='Current hero rules' from public.knowledge_nodes where id='00000000-0000-0000-0000-000000000105'),'parent canonical unchanged');
   perform pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'dependency attempts create no canonical snapshots');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
end $$;

-- Defense in depth: even a hypothetical future snapshot regression that
-- omits a real dependency cannot bypass the live final-write guard.
-- The function replacement is privileged disposable-test setup and rolled back.
do $$ declare s record; begin select * into s from state;
 begin
  insert into public.knowledge_nodes(id,brand_id,parent_id,slug,title) values
   ('00000000-0000-0000-0000-000000000198','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000105','child','Live dependency');
  execute format('create or replace function public.uid_review_snapshot(p_proposal_id uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as %L','select '||quote_literal(s.claim->'snapshot')||'::jsonb');
  perform pg_temp.expect_error(format('select public.uid_review_complete(%L,%L,%L,%L,%s,%L,%L)',s.claim->>'request_id',s.owner,'dot',s.claim->>'lease_token',s.claim->>'lease_version',s.claim->>'candidate_hash',s.review),'Unsupported active child dependency scope');
  perform pg_temp.assert_true((select content_md='Current hero rules' from public.knowledge_nodes where id='00000000-0000-0000-0000-000000000105'),'live guard preserves parent');
  perform pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'live guard rejects before snapshots or writes');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Compiled non-Onepage targets and brand-DNA dependencies also fail closed.
do $$ declare s record; change text; c jsonb; q jsonb; result jsonb; begin
 select * into s from state;
 for change in select * from (values
  ($q$update public.knowledge_nodes set metadata='{"creative_quality_contract":{"revision":"test"}}' where id='00000000-0000-0000-0000-000000000105'$q$),
  ($q$update public.knowledge_nodes set slug='brand-dna' where id='00000000-0000-0000-0000-000000000105'; update public.uid_governance_baselines set branch_slug='brand-dna' where id='00000000-0000-0000-0000-000000000306'$q$)
 )x(statement) loop
  begin
   perform public.uid_review_cancel((s.request->>'id')::uuid,s.proposal,s.owner);
   execute change;
   perform pg_temp.record_candidates(s.proposal);
   q:=public.uid_review_enqueue(s.proposal,s.owner,public.uid_review_intent_hash(s.proposal,s.owner));
   c:=public.uid_review_claim(s.owner,'dot');
   perform pg_temp.assert_true(c is not null,'compiled dependency fixture is claimable for honest review');
   result:=public.uid_review_complete((c->>'request_id')::uuid,s.owner,'dot',(c->>'lease_token')::uuid,(c->>'lease_version')::int,c->>'candidate_hash',pg_temp.make_review(c));
   perform pg_temp.assert_true(result->>'status'='blocked' and result->'blockers' @> '[{"code":"compiler_integration_required"}]','compiled dependency finalization blocked');
   perform pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'compiled dependency never append-merged');
   raise exception sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
end $$;

-- Unknown live trigger fanout must never escape approved/snapshotted scope.
create function pg_temp.scope_escape() returns trigger language plpgsql as $$
begin
 if new.id='00000000-0000-0000-0000-000000000105' then
  update public.knowledge_nodes set metadata='{"outside_scope":true}' where id='00000000-0000-0000-0000-000000000102';
 end if;
 return new;
end $$;
do $$ declare s record; fresh jsonb; result jsonb; prior record; begin select * into s from state;
 begin
  for prior in select * from public.uid_review_requests where proposal_id<>s.proposal and status in ('queued','blocked','leased') loop
   perform public.uid_review_cancel(prior.id,prior.proposal_id,s.owner);
  end loop;
  create trigger test_scope_escape after update on public.knowledge_nodes for each row execute function pg_temp.scope_escape();
  result:=public.uid_review_complete((s.claim->>'request_id')::uuid,s.owner,'dot',(s.claim->>'lease_token')::uuid,(s.claim->>'lease_version')::int,s.claim->>'candidate_hash',s.review);
  perform pg_temp.assert_true(result->>'status'='queued','changed trigger definition invalidates old QC snapshot');
  fresh:=public.uid_review_claim(s.owner,'dot');
  perform pg_temp.expect_error(format('select public.uid_review_complete(%L,%L,%L,%L,%s,%L,%L)',fresh->>'request_id',s.owner,'dot',fresh->>'lease_token',fresh->>'lease_version',fresh->>'candidate_hash',pg_temp.make_review(fresh)),'outside approved scope');
  perform pg_temp.assert_true((select metadata='{}'::jsonb from public.knowledge_nodes where id='00000000-0000-0000-0000-000000000102'),'escaped trigger changes rolled back');
  perform pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'failed trigger scope leaves no merge snapshots');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update public.creative_dna_team_members set is_active=false where user_id=s.owner;
  perform pg_temp.expect_error(format('select public.uid_review_complete(%L,%L,%L,%L,%s,%L,%L)',s.claim->>'request_id',s.owner,'dot',s.claim->>'lease_token',s.claim->>'lease_version',s.claim->>'candidate_hash',s.review),'Active admin required');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Real successful service-role completion. Synthetic test-only receipts are
-- generated locally above; no manual-review flags or legacy passed row exists.
grant select,update on state to service_role;
set local role service_role;
update state set request=public.uid_review_complete((claim->>'request_id')::uuid,owner,'dot',(claim->>'lease_token')::uuid,(claim->>'lease_version')::int,claim->>'candidate_hash',review);
reset role;
select pg_temp.assert_true(request->>'status'='merged','complete merge result'),
 pg_temp.assert_true((select count(*) from public.uid_governance_snapshots where checkpoint='before')=1,'one before snapshot per target'),
 pg_temp.assert_true((select count(*) from public.uid_governance_snapshots where checkpoint='after')=1,'one after snapshot per target'),
 pg_temp.assert_true((select count(*) from public.training_events)=1,'one merge event per target'),
 pg_temp.assert_true((select count(*) from public.uid_agent_review_evaluations where evaluation_status='passed')=1,'separate immutable agent evaluation'),
 pg_temp.assert_true((select count(*) from public.uid_governance_evaluations where evaluation_status='passed')=0,'no fabricated legacy manual pass'),
 pg_temp.assert_true(public.uid_review_complete((claim->>'request_id')::uuid,owner,'dot',(claim->>'lease_token')::uuid,(claim->>'lease_version')::int,claim->>'candidate_hash',review)=request,'successful completion replay identical'),
 pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=2,'replay does not duplicate snapshots') from state;
select pg_temp.assert_true((select review_note like 'Agent review by dot under owner-approved request %' from public.knowledge_proposals where id=proposal),'proposal audit distinguishes agent QC from owner approval') from state;
select pg_temp.expect_error('update public.uid_agent_review_evaluations set critical_failures=4','immutable');
select pg_temp.expect_error('delete from public.uid_agent_review_evaluations','immutable');
select 'uid-agent-review-queue SQL assertions passed' result;
rollback;
