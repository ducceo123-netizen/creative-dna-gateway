-- Additive review outcome. A resolution is an administrative acknowledgement,
-- never a canonical merge and never a compiler input. No existing rows are changed.
alter table public.knowledge_proposals add column if not exists resolution jsonb;
alter table public.knowledge_proposals drop constraint knowledge_proposals_status_check;
alter table public.knowledge_proposals add constraint knowledge_proposals_status_check
 check (status in ('pending','accepted','rejected','merged','resolved'));
alter table public.knowledge_proposals add constraint knowledge_proposals_resolution_check
 check ((status = 'resolved') = (resolution is not null)
   and (resolution is null or (jsonb_typeof(resolution) = 'object' and merged_at is null)));
comment on column public.knowledge_proposals.resolution is
 'Immutable already-covered review audit. Excluded from canonical knowledge and compiler inputs; merged_at remains NULL.';

-- Keep completed audit evidence, even if an older admin client attempts to
-- reclassify/delete it. Roll back application code without dropping this column,
-- status value, constraint, or trigger. Reopening requires a new proposal.
create or replace function public.uid_governance_preserve_resolution()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' and exists(select 1 from public.knowledge_proposals p
   where p.resolution->>'covered_proposal_id'=old.id::text)
 then raise exception 'Covered proposal is retained by a resolution audit'; end if;
 if old.resolution is not null then
   if tg_op='DELETE' then raise exception 'Resolution audit cannot be deleted'; end if;
   if new.resolution is distinct from old.resolution or new.status<>'resolved' or new.merged_at is not null
   then raise exception 'Resolution audit and terminal status are immutable'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger uid_governance_preserve_resolution
 before update or delete on public.knowledge_proposals
 for each row execute function public.uid_governance_preserve_resolution();
revoke all on function public.uid_governance_preserve_resolution() from public,anon,authenticated,service_role;

-- These owner-only helpers share exactly the structural Onepage target rule used
-- by admin_accept_merge_creative_dna_proposal. Scope is derived from stored data.
create or replace function public.uid_governance_target_nodes(p_proposal_id uuid)
returns setof public.knowledge_nodes language sql stable security definer set search_path=public,pg_temp as $$
 select target.* from public.knowledge_proposals p
 join public.knowledge_nodes source on source.id=p.knowledge_node_id
 join public.knowledge_nodes target on
   case when source.slug='onepage-system' and coalesce(p.proposed_scope,'') !~* 'brand[ _-]?style|vibe|mood'
     then target.slug='onepage-system' and target.status='active'
     else target.id=source.id end
 where p.id=p_proposal_id and source.status='active' order by target.id
$$;
create or replace function public.uid_governance_applicable_baselines(p_proposal_id uuid)
returns setof public.uid_governance_baselines language sql stable security definer set search_path=public,pg_temp as $$
 select b.* from public.knowledge_proposals p
 join public.knowledge_nodes source on source.id=p.knowledge_node_id
 join public.uid_governance_baselines b on b.branch_slug=source.slug
   and exists(select 1 from public.uid_governance_target_nodes(p.id) t
     where t.brand_id is not distinct from b.brand_id)
 where p.id=p_proposal_id order by b.id
$$;
create or replace function public.uid_governance_is_reference_only(p_baseline public.uid_governance_baselines)
returns boolean language sql immutable set search_path=public,pg_temp as $$
 select coalesce(p_baseline.source_brief->>'schema_version' like 'onepage.bounded-reference-%',false)
   or coalesce(p_baseline.approved_output->>'schema_version' like 'onepage.bounded-reference-%',false)
   or coalesce(p_baseline.source_brief->>'reference_scope'='USER_APPROVED_CORPUS_LIMITED_EVIDENCE_SCHEMA_AND_STRUCTURE',false)
   or coalesce(p_baseline.approved_output->>'reference_scope'='USER_APPROVED_CORPUS_LIMITED_EVIDENCE_SCHEMA_AND_STRUCTURE',false)
$$;
revoke all on function public.uid_governance_target_nodes(uuid) from public,anon,authenticated,service_role;
revoke all on function public.uid_governance_applicable_baselines(uuid) from public,anon,authenticated,service_role;
revoke all on function public.uid_governance_is_reference_only(public.uid_governance_baselines) from public,anon,authenticated,service_role;

-- Versioned identity deliberately invalidates every legacy content-only evaluation.
-- Complete rows include scope, evidence, images, source metadata/input schema,
-- target membership/content/version, and baseline assertions/output/approval.
create or replace function public.uid_governance_candidate_hash(p_proposal_id uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select 'scope-v2:' || md5(jsonb_build_object(
   'proposal',to_jsonb(p),'source',to_jsonb(source),
   'targets',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('brand_name',b.name) order by t.id)
     from public.uid_governance_target_nodes(p.id) t left join public.brands b on b.id=t.brand_id),'[]'::jsonb),
   'baselines',coalesce((select jsonb_agg(to_jsonb(b) order by b.id)
     from public.uid_governance_applicable_baselines(p.id) b where b.approved_at is not null),'[]'::jsonb)
 )::text)
 from public.knowledge_proposals p join public.knowledge_nodes source on source.id=p.knowledge_node_id
 where p.id=p_proposal_id
$$;
revoke all on function public.uid_governance_candidate_hash(uuid) from public,anon,authenticated;
grant execute on function public.uid_governance_candidate_hash(uuid) to service_role;

-- One statement/snapshot supplies all review context. This RPC is reachable only
-- from the existing admin-authenticated service-role Edge boundary.
create or replace function public.uid_governance_review_context(p_proposal_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with proposal as (
   select p.*,source.slug as branch_slug,source.brand_id as source_brand_id,
     source.slug='onepage-system' and coalesce(p.proposed_scope,'') !~* 'brand[ _-]?style|vibe|mood' as structural
   from public.knowledge_proposals p join public.knowledge_nodes source on source.id=p.knowledge_node_id
   where p.id=p_proposal_id
 ), targets as (
   select t.*,b.name as brand_name,'node-v2:'||md5(to_jsonb(t)::text) as node_hash
   from public.uid_governance_target_nodes(p_proposal_id) t left join public.brands b on b.id=t.brand_id
 ), baselines as (
   select b.*,public.uid_governance_is_reference_only(b) as is_reference_only
   from public.uid_governance_applicable_baselines(p_proposal_id) b
 ), covered as (
   select c.*,btrim(coalesce(c.proposed_content_md,c.raw_feedback,'')) as full_text,
     'covered-v1:'||md5(to_jsonb(c)::text) as covered_hash
   from public.knowledge_proposals c
   join public.knowledge_nodes source on source.id=c.knowledge_node_id
   cross join proposal p
   where c.id<>p.id and c.status='merged' and c.merged_at is not null and source.status='active'
     and source.slug=p.branch_slug
     and (source.slug='onepage-system' and coalesce(c.proposed_scope,'') !~* 'brand[ _-]?style|vibe|mood')=p.structural
     and (select array_agg(t.id order by t.id) from public.uid_governance_target_nodes(c.id) t)
         =(select array_agg(t.id order by t.id) from targets t)
     and length(btrim(coalesce(c.proposed_content_md,c.raw_feedback,'')))>0
     and exists(select 1 from targets)
     and not exists(select 1 from targets t
       where position(btrim(coalesce(c.proposed_content_md,c.raw_feedback,'')) in t.content_md)=0)
 )
 select jsonb_build_object(
   'proposal',to_jsonb(p)-'branch_slug'-'source_brand_id'-'structural',
   'scope',jsonb_build_object('branch_slug',p.branch_slug,'structural',p.structural,'cross_brand',p.structural,
     'brand_id',p.source_brand_id,'source_node_id',p.knowledge_node_id,'proposed_scope',p.proposed_scope,
     'target_node_ids',coalesce((select jsonb_agg(t.id order by t.id) from targets t),'[]'::jsonb)),
   'candidate_hash',public.uid_governance_candidate_hash(p.id),
   'targets',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from targets t),'[]'::jsonb),
   'baselines',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from baselines b),'[]'::jsonb),
   'eligible_baseline_ids',coalesce((select jsonb_agg(b.id order by b.id) from baselines b
     where b.approved_at is not null and not b.is_reference_only),'[]'::jsonb),
   'evaluations',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id)
     from public.uid_governance_evaluations e where e.proposal_id=p.id),'[]'::jsonb),
   'covered_candidates',coalesce((select jsonb_agg(jsonb_build_object(
     'id',c.id,'proposal_id',c.id,'candidate_hash',c.covered_hash,'covered_hash',c.covered_hash,
     'text',c.full_text,'full_text',c.full_text,'summary',c.change_summary,'change_summary',c.change_summary,
     'merged_at',c.merged_at,'knowledge_node_id',c.knowledge_node_id,'brand_id',c.brand_id,'proposed_scope',c.proposed_scope,
     'brand_names',(select jsonb_agg(x.brand_name order by x.brand_name) from (select distinct brand_name from targets)x)
   ) order by c.merged_at desc,c.id) from covered c),'[]'::jsonb)
 ) from proposal p
$$;
revoke all on function public.uid_governance_review_context(uuid) from public,anon,authenticated;
grant execute on function public.uid_governance_review_context(uuid) to service_role;

create or replace function public.uid_governance_resolve_covered(
 p_proposal_id uuid,p_actor_user_id uuid,p_expected_candidate_hash text,
 p_covered_proposal_id uuid,p_expected_covered_hash text,p_review_note text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.knowledge_proposals%rowtype;
 covered public.knowledge_proposals%rowtype;
 context jsonb;
 candidate jsonb;
 audit jsonb;
begin
 -- Keep membership active for the transaction, including idempotent retries.
 perform 1 from public.creative_dna_team_members
 where user_id=p_actor_user_id and role='admin' and is_active=true for share;
 if not found then raise exception 'Active admin required'; end if;
 if p_proposal_id is null or p_covered_proposal_id is null or p_proposal_id=p_covered_proposal_id
 then raise exception 'A distinct merged covered proposal is required'; end if;

 -- Table locks prevent target-membership phantoms, scope/name changes, and
 -- baseline inserts/edits while checking hashes. No canonical writes occur here.
 -- All new mutators take locks in the same order, before proposal row locks.
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 perform 1 from public.knowledge_proposals where id in (p_proposal_id,p_covered_proposal_id) order by id for update;
 select * into p from public.knowledge_proposals where id=p_proposal_id;
 if not found then raise exception 'Proposal not found'; end if;
 if p.status='resolved' then
   if p.resolution->>'covered_proposal_id' is distinct from p_covered_proposal_id::text
   then raise exception 'Proposal was already resolved against a different covered proposal'; end if;
   return jsonb_build_object('proposal_id',p.id,'status','resolved','merged_at',null,'resolution',p.resolution);
 end if;
 if p.status<>'pending' or p.merged_at is not null then raise exception 'Pending unmerged proposal required'; end if;
 if length(btrim(coalesce(p_review_note,'')))<20 then raise exception 'Meaningful review note of at least 20 characters required'; end if;
 select * into covered from public.knowledge_proposals where id=p_covered_proposal_id;
 if not found or covered.status<>'merged' or covered.merged_at is null
 then raise exception 'Previously merged covered proposal required'; end if;

 perform 1 from public.knowledge_nodes where id in
   (select id from public.uid_governance_target_nodes(p.id)) order by id for update;
 context:=public.uid_governance_review_context(p.id);
 if context is null or jsonb_array_length(context->'targets')=0 then raise exception 'Affected canonical nodes unavailable'; end if;
 if p_expected_candidate_hash is null or p_expected_candidate_hash is distinct from context->>'candidate_hash'
 then raise exception 'Proposal, scope, canonical nodes or baselines changed; refresh review'; end if;
 select value into candidate from jsonb_array_elements(context->'covered_candidates') where value->>'proposal_id'=covered.id::text;
 if not found then raise exception 'Covered proposal has incompatible scope or full text is absent from an affected canonical node'; end if;
 if p_expected_covered_hash is null or p_expected_covered_hash is distinct from candidate->>'covered_hash'
 then raise exception 'Covered proposal or canonical coverage changed; refresh review'; end if;

 audit:=jsonb_build_object(
   'schema_version','uid.covered-resolution.v1','kind','already_covered',
   'covered_proposal_id',covered.id,'covered_merged_at',covered.merged_at,
   'covered_text',candidate->>'full_text','covered_proposal',to_jsonb(covered),
   'original_proposal',to_jsonb(p),'raw_feedback',p.raw_feedback,'evidence_summary',p.evidence_summary,
   'context_images',p.context_images,'scope',context->'scope',
   'candidate_hash',context->>'candidate_hash','covered_hash',candidate->>'covered_hash',
   'targets',(select jsonb_agg(value-'content_md'-'input_schema' order by value->>'id') from jsonb_array_elements(context->'targets')),
   'reviewer_id',p_actor_user_id,'review_note',btrim(p_review_note),'resolved_at',now(),
   'canonical_unchanged',true,'merged_at',null
 );
 update public.knowledge_proposals set status='resolved',resolution=audit,
   reviewed_at=now(),reviewed_by=p_actor_user_id,review_note=btrim(p_review_note),merged_at=null,updated_at=now()
 where id=p.id;
 return jsonb_build_object('proposal_id',p.id,'status','resolved','merged_at',null,'resolution',audit);
end $$;
revoke all on function public.uid_governance_resolve_covered(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.uid_governance_resolve_covered(uuid,uuid,text,uuid,text,text) to service_role;

-- Preserve the existing genuine-change boundary, strengthen its transaction and
-- evidence identity, and fail closed on legacy evaluations or reference corpora.
create or replace function public.uid_governance_accept_merge(
 p_proposal_id uuid,p_actor_user_id uuid,p_evaluation_id uuid,p_review_note text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.knowledge_proposals%rowtype;
 e public.uid_governance_evaluations%rowtype;
 context jsonb;
 expected_ids uuid[];
 evaluated_ids uuid[];
 result jsonb;
begin
 perform 1 from public.creative_dna_team_members
 where user_id=p_actor_user_id and role='admin' and is_active=true for share;
 if not found then raise exception 'Active admin required'; end if;
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 select * into p from public.knowledge_proposals where id=p_proposal_id and status='pending' for update;
 if not found then raise exception 'Pending proposal not found'; end if;
 perform 1 from public.knowledge_nodes where id in
   (select id from public.uid_governance_target_nodes(p.id)) order by id for update;
 select * into e from public.uid_governance_evaluations where id=p_evaluation_id and proposal_id=p.id for update;
 if not found or e.evaluation_status<>'passed' or e.critical_failures<>0 or e.completed_at is null
   or e.evaluator_version<>'mechanical-v2-scope-freshness' or jsonb_typeof(e.test_results)<>'array'
   or jsonb_typeof(e.conflict_results)<>'array'
 then raise exception 'Fresh approved regression evaluation required'; end if;
 context:=public.uid_governance_review_context(p.id);
 if context is null or jsonb_array_length(context->'targets')=0 then raise exception 'Affected canonical nodes unavailable'; end if;
 if e.candidate_hash is distinct from context->>'candidate_hash'
 then raise exception 'Proposal, scope, canonical nodes or baselines changed after evaluation'; end if;
 select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into expected_ids
 from jsonb_array_elements_text(context->'eligible_baseline_ids');
 select coalesce(array_agg(x order by x),'{}'::uuid[]) into evaluated_ids from unnest(e.baseline_ids) x;
 if cardinality(expected_ids)=0 or expected_ids<>evaluated_ids
 then raise exception 'Evaluation baseline IDs must exactly match all applicable approved regression cases'; end if;
 if exists(select 1 from jsonb_array_elements(context->'targets') t where not exists(
   select 1 from public.uid_governance_applicable_baselines(p.id) b
   where b.approved_at is not null and not public.uid_governance_is_reference_only(b)
     and b.brand_id::text is not distinct from t->>'brand_id'))
 then raise exception 'A non-reference approved regression baseline is required for every affected brand'; end if;
 if jsonb_array_length(e.test_results)<>cardinality(expected_ids)
   or exists(select 1 from jsonb_array_elements(e.test_results) r
     where jsonb_typeof(r)<>'object' or r->>'status' is distinct from 'passed'
       or coalesce(length(btrim(r->>'source_run_id')),0)=0 or coalesce(r->>'artifact_url','')!~'^https://[^[:space:]]+$'
       or r->'issues' is distinct from '[]'::jsonb
       or jsonb_typeof(r->'candidate_output') is distinct from 'object' or r->'candidate_output'='{}'::jsonb
       or not exists(select 1 from public.uid_governance_applicable_baselines(p.id) b
         where b.id::text=r->>'baseline_id' and b.id=any(expected_ids) and b.case_key=r->>'case_key'))
   or exists(select 1 from unnest(expected_ids) id where
     (select count(*) from jsonb_array_elements(e.test_results) r where r->>'baseline_id'=id::text)<>1)
 then raise exception 'Exactly one complete passed result per approved baseline is required'; end if;
 if not exists(select 1 from jsonb_array_elements(e.conflict_results) a
   where a->'product_truth_verified'='true'::jsonb and a->'visual_reviewed'='true'::jsonb
     and a->'manually_reviewed'='true'::jsonb and a->'issues'='[]'::jsonb
     and length(btrim(coalesce(a->>'note','')))>=20
     and exists(select 1 from public.creative_dna_team_members m
       where m.user_id::text=a->>'actor_user_id' and m.role='admin'))
 then raise exception 'Stored administrator product-truth, visual and conflict review evidence required'; end if;
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'before',content_md,metadata,version,p_actor_user_id from public.uid_governance_target_nodes(p.id);
 result:=public.admin_accept_merge_creative_dna_proposal(p.id,p_actor_user_id,p_review_note);
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'after',content_md,metadata,version,p_actor_user_id from public.uid_governance_target_nodes(p.id);
 return result||jsonb_build_object('evaluation_id',e.id,'governance_passed',true);
end $$;
revoke all on function public.uid_governance_accept_merge(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.uid_governance_accept_merge(uuid,uuid,uuid,text) to service_role;
-- Defense in depth: leave the legacy merge unavailable to direct service calls.
revoke all on function public.admin_accept_merge_creative_dna_proposal(uuid,uuid,text) from public,anon,authenticated,service_role;
