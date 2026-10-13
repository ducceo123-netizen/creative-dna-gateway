-- Run after governance_fixture.sql and all migrations in a disposable database.
-- Every assertion is executed by PostgreSQL; the final rollback keeps it isolated.
begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION: %',message; end if; end $$;
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
   if position(lower(expected) in lower(sqlerrm))>0 then return; end if;
   raise exception 'Expected error %, got %',expected,sqlerrm;
 end;
 raise exception 'Expected error %, command succeeded',expected;
end $$;
insert into public.brands(id,slug,name) values
 ('00000000-0000-0000-0000-000000000001','a','Brand A'),
 ('00000000-0000-0000-0000-000000000002','b','Brand B'),
 ('00000000-0000-0000-0000-000000000003','c','Brand C'),
 ('00000000-0000-0000-0000-000000000004','inactive','Inactive Brand');
insert into public.creative_dna_team_members(user_id,role,is_active) values
 ('00000000-0000-0000-0000-000000000010','admin',true),
 ('00000000-0000-0000-0000-000000000011','admin',false),
 ('00000000-0000-0000-0000-000000000012','contributor',true);
insert into public.knowledge_nodes(id,brand_id,slug,title,content_md)
 select ('00000000-0000-0000-0000-00000000010'||i)::uuid,('00000000-0000-0000-0000-00000000000'||i)::uuid,
 'onepage-system','Onepage '||i,E'Canonical before\nFULL VERIFIED RULE\nCanonical after' from generate_series(1,3)i;
insert into public.knowledge_nodes(id,brand_id,slug,title,content_md,status) values
 ('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000004','onepage-system','Inactive','FULL VERIFIED RULE','inactive'),
 ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000001','hero','Hero','FULL VERIFIED RULE','active');
insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,raw_feedback,proposed_scope,evidence_summary,context_images) values
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001',
 'New interpretation of the verified headline rule','Shared Onepage structure','{"source":"original feedback"}','[{"url":"https://example.com/evidence.png"}]');
insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,raw_feedback,proposed_scope,status,merged_at) values
 ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001',
 'FULL VERIFIED RULE','Onepage headline product identity','merged','2026-10-01T12:00Z'),
 ('00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000001',
 'FULL VERIFIED RULE','Hero headline','merged','2026-10-01T12:00Z');
insert into public.uid_governance_baselines(id,brand_id,branch_slug,case_key,source_brief,approved_output,expected_assertions,approved_by,approved_at)
 select ('00000000-0000-0000-0000-00000000030'||i)::uuid,('00000000-0000-0000-0000-00000000000'||i)::uuid,
 'onepage-system','quality-'||i,'{"product":"Verified shirt"}','{"title":"Verified shirt"}',
 '{"required_keys":["title"]}','00000000-0000-0000-0000-000000000010',now() from generate_series(1,4)i;
insert into public.uid_governance_baselines(id,brand_id,branch_slug,case_key,source_brief,approved_output,expected_assertions,approved_at) values
 ('00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000001','onepage-system','reference',
 '{"schema_version":"onepage.bounded-reference-source.v1"}','{"schema_version":"onepage.bounded-reference-output.v1"}','{"required_keys":["schema_version"]}',now()),
 ('00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000001','onepage-system','unapproved',
 '{}','{}','{}',null);
create temp table test_state as select
 '00000000-0000-0000-0000-000000000201'::uuid proposal,
 '00000000-0000-0000-0000-000000000202'::uuid covered,
 '00000000-0000-0000-0000-000000000010'::uuid actor,
 public.uid_governance_review_context('00000000-0000-0000-0000-000000000201') context,
 (select jsonb_agg(to_jsonb(n) order by id) from public.knowledge_nodes n) nodes_before;
select pg_temp.assert_true(jsonb_array_length(context->'targets')=3,'all current active Onepage targets'),
 pg_temp.assert_true(jsonb_array_length(context->'baselines')=5,'relevant approved and unapproved baselines only'),
 pg_temp.assert_true(jsonb_array_length(context->'eligible_baseline_ids')=3,'reference and unapproved do not qualify'),
 pg_temp.assert_true(jsonb_array_length(context->'covered_candidates')=1,'only same-scope full-text covered candidate'),
 pg_temp.assert_true(context#>>'{covered_candidates,0,id}'=covered::text,'stable browser alias'),
 pg_temp.assert_true(context#>>'{covered_candidates,0,text}'='FULL VERIFIED RULE','full original text returned') from test_state;

-- RPCs retain the service-only trust boundary, owner-only helpers grant nothing.
select pg_temp.assert_true(not has_function_privilege(role_name,signature,'EXECUTE'),'deny '||role_name||' '||signature)
 from (values('anon'),('authenticated'))r(role_name)
 cross join (values('public.uid_governance_review_context(uuid)'),
 ('public.uid_governance_resolve_covered(uuid,uuid,text,uuid,text,text)'),
 ('public.uid_governance_accept_merge(uuid,uuid,uuid,text)'),
 ('public.uid_governance_target_nodes(uuid)'),('public.uid_governance_applicable_baselines(uuid)'))f(signature);
select pg_temp.assert_true(has_function_privilege('service_role','public.uid_governance_review_context(uuid)','EXECUTE'),'service context permission'),
 pg_temp.assert_true(not has_function_privilege('service_role','public.admin_accept_merge_creative_dna_proposal(uuid,uuid,text)','EXECUTE'),'legacy bypass stays closed');

-- Wrong actors, short notes, fabricated references and stale evidence fail closed.
do $$ declare s record; command text; x uuid; begin
 select * into s from test_state;
 foreach x in array array['00000000-0000-0000-0000-000000000011'::uuid,'00000000-0000-0000-0000-000000000012'::uuid,null::uuid] loop
  perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,x,s.context->>'candidate_hash',s.covered,s.context#>>'{covered_candidates,0,covered_hash}','Reviewed identical scope and exact full source text.'),'Active admin required');
 end loop;
 perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,s.context->>'candidate_hash',s.covered,s.context#>>'{covered_candidates,0,covered_hash}','too short'),'Meaningful review note');
 perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,s.context->>'candidate_hash','00000000-0000-0000-0000-000000000999',null,'Reviewed identical scope and exact full source text.'),'Previously merged');
 perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,s.context->>'candidate_hash','00000000-0000-0000-0000-000000000203',null,'Reviewed identical scope and exact full source text.'),'incompatible scope');
 perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,null,s.covered,s.context#>>'{covered_candidates,0,covered_hash}','Reviewed identical scope and exact full source text.'),'changed; refresh');
 perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,s.context->>'candidate_hash',s.covered,null,'Reviewed identical scope and exact full source text.'),'coverage changed');
end $$;

-- Hash completeness: reversible single-field changes, not only proposed text.
do $$ declare s record; command text; old_hash text; begin
 select * into s from test_state;
 old_hash:=s.context->>'candidate_hash';
 for command in select * from (values
  ($q$update public.knowledge_proposals set proposed_scope='Onepage different structural scope' where id='00000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set evidence_summary='{"changed":true}' where id='00000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set context_images='[{"url":"https://example.com/new.png"}]' where id='00000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_proposals set raw_feedback='Changed original evidence' where id='00000000-0000-0000-0000-000000000201'$q$),
  ($q$update public.knowledge_nodes set content_md=content_md||' changed' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$update public.knowledge_nodes set metadata='{"changed":true}' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$update public.knowledge_nodes set version='new' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$update public.knowledge_nodes set input_schema='{"changed":true}' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$update public.knowledge_nodes set status='inactive' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$update public.knowledge_nodes set status='active' where id='00000000-0000-0000-0000-000000000104'$q$),
  ($q$update public.uid_governance_baselines set approved_output='{"changed":true}' where id='00000000-0000-0000-0000-000000000301'$q$),
  ($q$update public.uid_governance_baselines set expected_assertions='{"required_keys":["changed"]}' where id='00000000-0000-0000-0000-000000000301'$q$),
  ($q$update public.uid_governance_baselines set approved_by=null where id='00000000-0000-0000-0000-000000000301'$q$),
  ($q$update public.uid_governance_baselines set approved_at=null where id='00000000-0000-0000-0000-000000000301'$q$),
  ($q$update public.uid_governance_baselines set approved_at=now() where id='00000000-0000-0000-0000-000000000306'$q$),
  ($q$update public.uid_governance_baselines set source_brief='{"changed":true}' where id='00000000-0000-0000-0000-000000000305'$q$),
  ($q$insert into public.knowledge_nodes(brand_id,slug,title) values('00000000-0000-0000-0000-000000000001','onepage-system','New target')$q$)
 )changes(statement) loop
  begin
   execute command;
   perform pg_temp.assert_true(public.uid_governance_candidate_hash(s.proposal)<>old_hash,'hash covers '||command);
   perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,old_hash,s.covered,s.context#>>'{covered_candidates,0,covered_hash}','Reviewed identical scope and exact full source text.'),'changed; refresh');
   raise exception sqlstate 'ZX001' using message='rollback test change';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
end $$;

-- Exact all-target presence, proposed_content priority, and stale covered history.
do $$ declare s record; h text; begin
 select * into s from test_state;
 begin
  update public.knowledge_nodes set content_md='Only FULL VERIFIED, missing final word' where id='00000000-0000-0000-0000-000000000103';
  perform pg_temp.assert_true(jsonb_array_length(public.uid_governance_review_context(s.proposal)->'covered_candidates')=0,'partial/2-of-3 coverage never qualifies');
  h:=public.uid_governance_candidate_hash(s.proposal);
  perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,h,s.covered,s.context#>>'{covered_candidates,0,covered_hash}','Reviewed identical scope and exact full source text.'),'full text is absent');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update public.knowledge_proposals set proposed_content_md='NEW PROPOSED RULE NOT IN CANONICAL' where id=s.covered;
  perform pg_temp.assert_true(jsonb_array_length(public.uid_governance_review_context(s.proposal)->'covered_candidates')=0,'cannot fall back to raw when proposed content exists');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update public.knowledge_proposals set evidence_summary='{"new":"covered evidence"}' where id=s.covered;
  perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,s.context->>'candidate_hash',s.covered,s.context#>>'{covered_candidates,0,covered_hash}','Reviewed identical scope and exact full source text.'),'coverage changed');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update public.knowledge_proposals set proposed_scope='brand style only' where id=s.proposal;
  perform pg_temp.assert_true(jsonb_array_length(public.uid_governance_review_context(s.proposal)->'targets')=1,'brand style is local');
  perform pg_temp.assert_true(jsonb_array_length(public.uid_governance_review_context(s.proposal)->'eligible_baseline_ids')=1,'brand style baselines local');
  perform pg_temp.assert_true(jsonb_array_length(public.uid_governance_review_context(s.proposal)->'covered_candidates')=0,'structural history cannot prove brand style');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

do $$ declare s record; begin
 select * into s from test_state;
 begin
  update public.knowledge_nodes set status='inactive' where id='00000000-0000-0000-0000-000000000101';
  perform pg_temp.assert_true(jsonb_array_length(public.uid_governance_review_context(s.proposal)->'targets')=0,'inactive source fails closed');
  perform pg_temp.expect_error(format('select public.uid_governance_resolve_covered(%L,%L,%L,%L,%L,%L)',s.proposal,s.actor,s.context->>'candidate_hash',s.covered,s.context#>>'{covered_candidates,0,covered_hash}','Reviewed identical scope and exact full source text.'),'Affected canonical nodes unavailable');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;

-- Successful resolution changes only the review record. Retry returns byte-for-
-- byte equal JSON without revalidating an obsolete pre-resolution token.
set local role anon;
do $$ begin
 perform public.uid_governance_review_context('00000000-0000-0000-0000-000000000201');
 raise exception 'ASSERTION: anonymous context access succeeded';
exception when insufficient_privilege then null; end $$;
reset role;
set local role authenticated;
do $$ begin
 perform public.uid_governance_resolve_covered('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000010',null,'00000000-0000-0000-0000-000000000202',null,'Client may not impersonate admin via RPC');
 raise exception 'ASSERTION: authenticated direct resolution succeeded';
exception when insufficient_privilege then null; end $$;
reset role;
set local role service_role;
select public.uid_governance_resolve_covered('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000010',
 public.uid_governance_review_context('00000000-0000-0000-0000-000000000201')->>'candidate_hash',
 '00000000-0000-0000-0000-000000000202',
 public.uid_governance_review_context('00000000-0000-0000-0000-000000000201')#>>'{covered_candidates,0,covered_hash}',
 'Reviewed identical structural scope and the complete merged rule on every current target.');
reset role;
create temp table resolution_result as select jsonb_build_object('proposal_id',id,'status',status,'merged_at',null,'resolution',resolution) result
 from public.knowledge_proposals where id='00000000-0000-0000-0000-000000000201';
select pg_temp.assert_true((select jsonb_agg(to_jsonb(n) order by id) from public.knowledge_nodes n)=nodes_before,'zero canonical row/metadata/timestamp writes'),
 pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'no canonical snapshots for resolution'),
 pg_temp.assert_true((select count(*) from public.training_events)=0,'no compiler/training merge events for resolution') from test_state;
select pg_temp.assert_true(status='resolved' and merged_at is null,'distinct resolved status and no merge timestamp'),
 pg_temp.assert_true(resolution->'raw_feedback'=to_jsonb(raw_feedback),'original feedback retained'),
 pg_temp.assert_true(resolution->'evidence_summary'=evidence_summary and resolution->'context_images'=context_images,'evidence and images retained'),
 pg_temp.assert_true(jsonb_array_length(resolution->'targets')=3,'all canonical hashes retained'),
 pg_temp.assert_true(resolution->>'covered_text'='FULL VERIFIED RULE','full covered rule retained'),
 pg_temp.assert_true(resolution->>'reviewer_id'='00000000-0000-0000-0000-000000000010','reviewer retained')
 from public.knowledge_proposals where id='00000000-0000-0000-0000-000000000201';
select pg_temp.assert_true(public.uid_governance_resolve_covered(s.proposal,s.actor,s.context->>'candidate_hash',s.covered,
 s.context#>>'{covered_candidates,0,covered_hash}','Different retry note does not replace the original.')=r.result,'identical retry result') from test_state s cross join resolution_result r;
select pg_temp.expect_error($q$select public.uid_governance_resolve_covered('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000010',null,'00000000-0000-0000-0000-000000000203',null,'Different reference may not replace audit')$q$,'different covered proposal');
select pg_temp.expect_error($q$update public.knowledge_proposals set resolution='{}' where id='00000000-0000-0000-0000-000000000201'$q$,'immutable');
select pg_temp.expect_error($q$update public.knowledge_proposals set status='pending' where id='00000000-0000-0000-0000-000000000201'$q$,'immutable');
select pg_temp.expect_error($q$delete from public.knowledge_proposals where id='00000000-0000-0000-0000-000000000201'$q$,'cannot be deleted');
select pg_temp.expect_error($q$delete from public.knowledge_proposals where id='00000000-0000-0000-0000-000000000202'$q$,'retained by a resolution audit');
select pg_temp.expect_error($q$delete from public.knowledge_proposals$q$,'resolution audit');

-- Genuine-change merge: legacy, stale, incomplete, corpus-only, duplicated,
-- fabricated result labels and missing attestations must all fail atomically.
insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,raw_feedback,proposed_scope) values
 ('00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001',
 'A genuinely new structural rule requiring evaluated artifacts','Shared Onepage structure');
insert into public.uid_governance_evaluations(id,proposal_id,candidate_hash,baseline_ids,test_results,conflict_results,evaluation_status,critical_failures,evaluator_version,completed_at)
 select '00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000211',
 public.uid_governance_candidate_hash('00000000-0000-0000-0000-000000000211'),
 array_agg(id order by id),jsonb_agg(jsonb_build_object('baseline_id',id,'case_key',case_key,'status','passed','issues','[]'::jsonb,
   'source_run_id','actual-run-'||id,'artifact_url','https://example.com/artifact/'||id,'candidate_output',jsonb_build_object('title','Verified shirt')) order by id),
 '[{"note":"Reviewed product truth, pixels and canonical conflicts carefully.","actor_user_id":"00000000-0000-0000-0000-000000000010","product_truth_verified":true,"visual_reviewed":true,"manually_reviewed":true,"issues":[]}]',
 'passed',0,'mechanical-v2-scope-freshness',now()
 from public.uid_governance_baselines where id in ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000303');
do $$ declare command text; call text:=$q$select public.uid_governance_accept_merge('00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000401','Reviewed fresh candidate artifacts across all affected brands')$q$; begin
 for command in select * from (values
  ($q$update public.uid_governance_evaluations set evaluator_version='mechanical-v1-plus-human-review' where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set candidate_hash=md5('A genuinely new structural rule requiring evaluated artifacts') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set baseline_ids=baseline_ids[1:2] where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set baseline_ids=array_append(baseline_ids,baseline_ids[1]) where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=test_results-0 where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=jsonb_set(test_results,'{0,baseline_id}',to_jsonb('00000000-0000-0000-0000-000000000302'::text)) where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=jsonb_set(test_results,'{0,case_key}','"invented-key"') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=jsonb_set(test_results,'{0,status}','"failed"') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=jsonb_set(test_results,'{0,issues}','["critical mismatch"]') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=jsonb_set(test_results,'{0,source_run_id}','""') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=jsonb_set(test_results,'{0,artifact_url}','"javascript:bad"') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=jsonb_set(test_results,'{0,candidate_output}','{}') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set test_results=test_results#-'{0,candidate_output}' where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set conflict_results='[]' where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set conflict_results=jsonb_set(conflict_results,'{0,actor_user_id}','"invented actor"') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set conflict_results=jsonb_set(conflict_results,'{0,product_truth_verified}','false') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set conflict_results=jsonb_set(conflict_results,'{0,visual_reviewed}','false') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set conflict_results=jsonb_set(conflict_results,'{0,manually_reviewed}','false') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.uid_governance_evaluations set conflict_results=jsonb_set(conflict_results,'{0,issues}','["not reviewed"]') where id='00000000-0000-0000-0000-000000000401'$q$),
  ($q$update public.knowledge_nodes set metadata='{"post_eval_edit":true}' where id='00000000-0000-0000-0000-000000000102'$q$),
  ($q$update public.knowledge_proposals set evidence_summary='{"post_eval_edit":true}' where id='00000000-0000-0000-0000-000000000211'$q$),
  ($q$update public.uid_governance_baselines set approved_output='{"post_eval_edit":true}' where id='00000000-0000-0000-0000-000000000301'$q$),
  ($q$update public.knowledge_nodes set status='active' where id='00000000-0000-0000-0000-000000000104'$q$)
 )changes(statement) loop
  begin
   execute command;
   -- Any successful merge is an assertion failure. Error should be deliberate.
   begin execute call; exception when others then
    if sqlerrm~'Fresh approved|changed after|baseline IDs|complete passed result|Stored administrator' then
      raise exception sqlstate 'ZX001';
    else raise; end if;
   end;
   raise exception 'ASSERTION: merge accepted mutation %',command;
  exception when sqlstate 'ZX001' then null; end;
 end loop;
 -- Corpus-only cases cannot qualify even after constructing a fresh-looking hash.
 begin
  update public.uid_governance_baselines set source_brief='{"schema_version":"onepage.bounded-reference-source.v2"}' where id in
   ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000303');
  update public.uid_governance_evaluations set candidate_hash=public.uid_governance_candidate_hash(proposal_id) where id='00000000-0000-0000-0000-000000000401';
  perform pg_temp.expect_error(call,'baseline IDs must exactly match');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
 -- Missing one affected brand cannot be hidden by an otherwise matching suite.
 begin
  update public.uid_governance_baselines set approved_at=null where id='00000000-0000-0000-0000-000000000303';
  update public.uid_governance_evaluations set candidate_hash=public.uid_governance_candidate_hash(proposal_id),baseline_ids=baseline_ids[1:2],test_results=test_results-2 where id='00000000-0000-0000-0000-000000000401';
  perform pg_temp.expect_error(call,'required for every affected brand');
  raise exception sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null; end;
end $$;
select pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'failed merges leave zero snapshots'),
 pg_temp.assert_true((select jsonb_agg(to_jsonb(n) order by id) from public.knowledge_nodes n)=nodes_before,'failed merges leave zero canonical changes') from test_state;

-- The owner-rule migration now guards compiled/Onepage routes even when an
-- older service client supplies an otherwise complete passed evaluation.
set local role service_role;
do $$ begin
 begin
  perform public.uid_governance_accept_merge('00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000401','Reviewed fresh candidate artifacts across all affected brands');
 exception when others then
  if position('Compiler integration required' in sqlerrm)>0 then return; end if;
  raise;
 end;
 raise exception 'ASSERTION: legacy Onepage compiler bypass succeeded';
end $$;
reset role;
select pg_temp.assert_true((select count(*) from public.uid_governance_snapshots)=0,'legacy compiler block writes no snapshots'),
 pg_temp.assert_true((select jsonb_agg(to_jsonb(n) order by id) from public.knowledge_nodes n)=nodes_before,'legacy compiler block changes no canonical nodes'),
 pg_temp.assert_true((select status='pending' from public.knowledge_proposals where id='00000000-0000-0000-0000-000000000211'),'evaluated Onepage remains pending') from test_state;
select 'covered-resolution SQL assertions passed' as result;
rollback;
