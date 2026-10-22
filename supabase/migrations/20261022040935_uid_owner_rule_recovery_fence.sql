-- LOCAL PREPARATION ONLY. This migration changes a protected owner recovery
-- boundary and must not be applied before the separately approved deployment.
-- Recovery never approves/merges a rule, edits canonical nodes, grants ownership,
-- changes plans or creates evaluation evidence. It serializes with acceptance.
create table uid_rule_private.recovery_fences (
 proposal_id uuid primary key references public.knowledge_proposals(id),
 owner_user_id uuid not null,
 recovery_token uuid not null unique,
 recovery_id uuid not null unique,
 created_at timestamptz not null default now()
);
create table uid_rule_private.recovery_requests (
 recovery_id uuid primary key,
 proposal_id uuid not null references public.knowledge_proposals(id),
 owner_user_id uuid not null,
 result jsonb not null check(jsonb_typeof(result)='object'),
 created_at timestamptz not null default now()
);
alter table uid_rule_private.recovery_fences enable row level security;
alter table uid_rule_private.recovery_requests enable row level security;
revoke all on uid_rule_private.recovery_fences,uid_rule_private.recovery_requests from public,anon,authenticated,service_role;
comment on table uid_rule_private.recovery_requests is 'Immutable recovery request results. A replay never rotates the fence; current committed receipts or a superseded projection take precedence over historical negative results.';
create function uid_rule_private.preserve_recovery_request() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
declare owner_name text;
begin
 if tg_op<>'INSERT' then raise exception 'Owner recovery request audit is immutable'; end if;
 select pg_get_userbyid(relowner) into owner_name from pg_class where oid=tg_relid;
 if current_user<>owner_name or current_setting('uid.rule_recovery_action',true) is distinct from 'recover'
 then raise exception 'Owner recovery audit requires guarded recovery'; end if;
 return new;
end $$;
create trigger preserve_recovery_request before insert or update or delete on uid_rule_private.recovery_requests
 for each row execute function uid_rule_private.preserve_recovery_request();
revoke all on function uid_rule_private.preserve_recovery_request() from public,anon,authenticated,service_role;

-- An accept that was already executing the old function body at deployment
-- can miss the new early check. Its mandatory immutable decision INSERT is a
-- second transaction boundary: a stale body has no matching local token, so
-- this trigger aborts ALL its canonical/snapshot/training writes atomically.
create or replace function public.uid_rule_preserve_decision() returns trigger language plpgsql
set search_path=public,pg_temp as $$
declare owner_name text;
begin
 if tg_op<>'INSERT' then raise exception 'Owner rule decision audit is immutable'; end if;
 -- An old REPEATABLE READ snapshot could hide a newly committed fence even
 -- inside this trigger. Unsupported transaction isolation must fail closed.
 if current_setting('transaction_isolation')<>'read committed'
 then raise exception 'Owner acceptance requires READ COMMITTED isolation'; end if;
 select pg_get_userbyid(relowner) into owner_name from pg_class where oid=tg_relid;
 if current_user<>owner_name or current_setting('uid.rule_action',true) is distinct from 'accept'
 then raise exception 'Owner rule audit requires guarded acceptance'; end if;
 if exists(select 1 from uid_rule_private.recovery_fences f where f.proposal_id=new.proposal_id
  and (f.owner_user_id is distinct from new.owner_user_id
   or f.recovery_token::text is distinct from current_setting('uid.rule_recovery_token',true)))
 then raise exception 'Owner recovery fence changed; stale acceptance rolled back'; end if;
 return new;
end $$;
revoke all on function public.uid_rule_preserve_decision() from public,anon,authenticated,service_role;

create function public.uid_rule_accept_fenced(p_proposal_id uuid,p_actor_user_id uuid,p_expected_candidate_hash text,p_expected_rule_hash text,p_plan jsonb,p_expected_plan_hash text,p_recovery_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.knowledge_proposals%rowtype; prior uid_rule_private.decisions%rowtype; context jsonb; eligibility jsonb;
 before_world jsonb; after_world jsonb; after_targets jsonb; target_ids uuid[];
 result jsonb; decision_id uuid:=gen_random_uuid(); candidate text; old_action text:=current_setting('uid.rule_action',true);
 old_recovery_token text:=current_setting('uid.rule_recovery_token',true);
begin
 -- Same lock ordering as governed merge/resolve. Configuration and active
 -- membership remain locked even for an exact idempotent retry.
 perform 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active for share;
 if not found then raise exception 'Active verified owner Admin required'; end if;
 perform 1 from uid_rule_private.owner_config where singleton and enabled and owner_user_id=p_actor_user_id for share;
 if not found then raise exception 'Active verified owner Admin required'; end if;
 if p_expected_candidate_hash is null or p_expected_rule_hash is null or p_expected_plan_hash is null then raise exception 'Exact displayed candidate, rule and plan hashes are required'; end if;
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 select * into p from public.knowledge_proposals where id=p_proposal_id for update;
 if not found then raise exception 'Proposal not found'; end if;
 select * into prior from uid_rule_private.decisions where proposal_id=p.id;
 if found then
  if prior.owner_user_id is distinct from p_actor_user_id or prior.candidate_hash is distinct from p_expected_candidate_hash or prior.rule_hash is distinct from p_expected_rule_hash or prior.result->>'plan_hash' is distinct from p_expected_plan_hash
  then raise exception 'Conflicting retry of an immutable owner rule decision'; end if;
  return prior.result||jsonb_build_object('owner_user_id',prior.owner_user_id);
 end if;
 -- A prior immutable receipt wins over a fence. Otherwise a null legacy
 -- token or a stale generation can never enter the canonical write path.
 if exists(select 1 from uid_rule_private.recovery_fences f where f.proposal_id=p.id
   and (f.owner_user_id is distinct from p_actor_user_id or f.recovery_token is distinct from p_recovery_token))
 then raise exception 'Owner recovery fence changed; refresh the owner preview before approving'; end if;
 if p_recovery_token is not null and not exists(select 1 from uid_rule_private.recovery_fences f
   where f.proposal_id=p.id and f.owner_user_id=p_actor_user_id and f.recovery_token=p_recovery_token)
 then raise exception 'Owner recovery token not found; refresh the owner preview before approving'; end if;
 perform set_config('uid.rule_recovery_token',coalesce(p_recovery_token::text,''),true);
 if p.status is distinct from 'pending' or p.merged_at is not null then raise exception 'Pending unmerged proposal required'; end if;
 if p_plan is null or p_expected_plan_hash is distinct from encode(sha256(convert_to(public.uid_rule_stable_json(p_plan),'UTF8')),'hex') then raise exception 'Exact server-computed compiler plan hash required'; end if;
 perform 1 from public.knowledge_nodes where id in(select id from public.uid_governance_target_nodes(p.id)) order by id for update;
 context:=public.uid_rule_context(p.id);
 if context is not null then context:=jsonb_set(context,'{compiler_context,owner_user_id}',to_jsonb(p_actor_user_id)); end if;
 if context is null or p_expected_candidate_hash is distinct from context->>'candidate_hash'
 then raise exception 'Proposal, scope, canonical nodes or baselines changed; refresh review'; end if;
 eligibility:=public.uid_rule_eligibility(context,p_actor_user_id);
 context:=context||jsonb_build_object('direct_rule',eligibility);
 if p_expected_rule_hash is distinct from eligibility->>'rule_hash' then raise exception 'Rule or owner configuration changed; refresh review'; end if;
 if eligibility->'eligible' is distinct from 'true' then raise exception 'Direct rule acceptance blocked: %',eligibility->'blockers'; end if;
 select array_agg((t->>'id')::uuid order by (t->>'id')::uuid) into target_ids from jsonb_array_elements(context->'targets') t;
 if coalesce(cardinality(target_ids),0)=0 then raise exception 'Affected canonical nodes unavailable'; end if;
 candidate:=btrim(p.proposed_content_md);
 -- Capture non-target rows to detect trigger side effects. Lock above prevents
 -- concurrent membership/row changes. Unexpected writes roll back atomically.
 select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') into before_world from public.knowledge_nodes n where not id=any(target_ids);
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'before',content_md,metadata,version,p_actor_user_id from public.knowledge_nodes where id=any(target_ids);
 result:=public.admin_accept_merge_creative_dna_proposal(p.id,p_actor_user_id,'Owner directly approved this exact creative rule and scope. Structural and detectable-conflict checks only; no visual QC performed.');
 select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') into after_world from public.knowledge_nodes n where not id=any(target_ids);
 if before_world is distinct from after_world then raise exception 'Merge trigger changed canonical nodes outside the approved scope'; end if;
 -- The legacy cursor can revisit a mirror after the master sync. Reconcile to
 -- the exact displayed, single-append projection through a master-only Onepage
 -- compiler write. The existing legacy merger remains the proposal/training-event
 -- boundary; all actual mirror rows are verified after its trigger fanout.
 -- No inferred field changes: the eligibility guard requires all non-content
 -- projection fields to equal the original records.
 perform public.uid_rule_apply_plan(context,p_plan);
 select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') into after_world from public.knowledge_nodes n where not id=any(target_ids);
 if before_world is distinct from after_world then raise exception 'Compiler trigger changed canonical nodes outside the approved scope'; end if;
 if not exists(select 1 from public.knowledge_proposals where id=p.id and status='merged' and reviewed_by=p_actor_user_id and merged_at is not null)
 then raise exception 'Legacy merge did not record the expected owner decision'; end if;
 insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
 select p.id,id,'after',content_md,metadata,version,p_actor_user_id from public.knowledge_nodes where id=any(target_ids);
 select jsonb_agg(to_jsonb(n) order by id) into after_targets from public.knowledge_nodes n where id=any(target_ids);
 result:=result||jsonb_build_object('owner_user_id',p_actor_user_id,'decision_kind','owner_direct_rule','rule_decision_id',decision_id,'candidate_hash',p_expected_candidate_hash,'rule_hash',p_expected_rule_hash,'plan_hash',p_expected_plan_hash,'visual_qc_performed',false,'check_scope','STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY');
 perform set_config('uid.rule_action','accept',true);
 insert into uid_rule_private.decisions(id,proposal_id,owner_user_id,candidate_hash,rule_hash,intent,before_context,after_targets,result)
 values(decision_id,p.id,p_actor_user_id,p_expected_candidate_hash,p_expected_rule_hash,
  jsonb_build_object('schema_version','uid.owner-rule-intent.v1','decision_kind','owner_direct_rule','owner_user_id',p_actor_user_id,'candidate_hash',p_expected_candidate_hash,'rule_hash',p_expected_rule_hash,'canonical_text',candidate,'scope',context->'scope','target_node_ids',to_jsonb(target_ids),'visual_qc_performed',false),
  context,after_targets,result);
 perform set_config('uid.rule_action',coalesce(old_action,''),true);
 perform set_config('uid.rule_recovery_token',coalesce(old_recovery_token,''),true);
 return result;
end $$;
revoke all on function public.uid_rule_accept_fenced(uuid,uuid,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.uid_rule_accept_fenced(uuid,uuid,text,text,jsonb,text,uuid) to service_role;
-- Legacy six-argument callers retain the exact protected accept behavior but
-- carry no generation. Once recovery commits they are rejected before mutation.
create or replace function public.uid_rule_accept(p_proposal_id uuid,p_actor_user_id uuid,p_expected_candidate_hash text,p_expected_rule_hash text,p_plan jsonb default null,p_expected_plan_hash text default null)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select public.uid_rule_accept_fenced(p_proposal_id,p_actor_user_id,p_expected_candidate_hash,p_expected_rule_hash,p_plan,p_expected_plan_hash,null::uuid)
$$;
revoke all on function public.uid_rule_accept(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.uid_rule_accept(uuid,uuid,text,text,jsonb,text) to service_role;

create or replace function public.uid_rule_preflight(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare context jsonb; eligibility jsonb; owner_ok boolean;
begin
 if not exists(select 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active)
 then raise exception 'Active admin required'; end if;
 context:=public.uid_rule_context(p_proposal_id);
 if context is not null then context:=jsonb_set(context,'{compiler_context,owner_user_id}',to_jsonb(p_actor_user_id)); end if;
 if context is null then return null; end if;
 eligibility:=public.uid_rule_eligibility(context,p_actor_user_id);
 owner_ok:=eligibility->'owner_authorized'='true';
 return context||jsonb_build_object('direct_rule',eligibility,
  'owner_user_id',case when owner_ok then p_actor_user_id else null end,
  'recovery_token',case when owner_ok then (select f.recovery_token from uid_rule_private.recovery_fences f
    where f.proposal_id=p_proposal_id and f.owner_user_id=p_actor_user_id) else null end,
  'direct_rule_receipt',(select d.result||jsonb_build_object('owner_user_id',d.owner_user_id)
    from uid_rule_private.decisions d where owner_ok and d.proposal_id=p_proposal_id and d.owner_user_id=p_actor_user_id));
end $$;
revoke all on function public.uid_rule_preflight(uuid,uuid) from public,anon,authenticated;
grant execute on function public.uid_rule_preflight(uuid,uuid) to service_role;

create function public.uid_rule_recover(p_proposal_id uuid,p_actor_user_id uuid,p_recovery_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.knowledge_proposals%rowtype;
 prior uid_rule_private.decisions%rowtype;
 request uid_rule_private.recovery_requests%rowtype;
 fence uid_rule_private.recovery_fences%rowtype;
 request_exists boolean; result jsonb; token uuid;
 old_action text:=current_setting('uid.rule_recovery_action',true);
begin
 if current_setting('transaction_isolation')<>'read committed'
 then raise exception 'Owner recovery requires READ COMMITTED isolation'; end if;
 -- Identical to accept: member -> owner config -> nodes -> baselines -> brands
 -- -> proposal. Therefore no negative outcome can precede an in-flight accept.
 perform 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active for share;
 if not found then raise exception 'Active verified owner Admin required' using errcode='42501'; end if;
 perform 1 from uid_rule_private.owner_config where singleton and enabled and owner_user_id=p_actor_user_id for share;
 if not found then raise exception 'Active verified owner Admin required' using errcode='42501'; end if;
 if p_recovery_id is null then raise exception 'Explicit recovery request id required'; end if;
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 select * into p from public.knowledge_proposals where id=p_proposal_id for update;
 if not found then raise exception 'Proposal not found'; end if;
 select * into request from uid_rule_private.recovery_requests where recovery_id=p_recovery_id;
 request_exists:=found;
 if request_exists and (request.proposal_id is distinct from p.id or request.owner_user_id is distinct from p_actor_user_id)
 then raise exception 'Conflicting recovery request identity'; end if;
 select * into prior from uid_rule_private.decisions where proposal_id=p.id;
 if found then
  if prior.owner_user_id is distinct from p_actor_user_id then raise exception 'Conflicting immutable owner rule decision'; end if;
  if p.status is distinct from 'merged' or p.merged_at is distinct from (prior.result->>'merged_at')::timestamptz
  then raise exception 'Owner decision exists but its proposal is no longer in the committed merged state'; end if;
  result:=jsonb_build_object('proposal_id',p.id,'owner_user_id',p_actor_user_id,'recovery_id',p_recovery_id,
   'status','merged','receipt',prior.result||jsonb_build_object('owner_user_id',prior.owner_user_id),'canonical_changed',true);
 elsif p.status in ('resolved','rejected') and p.merged_at is null then
  result:=jsonb_build_object('proposal_id',p.id,'owner_user_id',p_actor_user_id,'recovery_id',p_recovery_id,
   'status',p.status,'canonical_changed',false);
 elsif p.status is distinct from 'pending' or p.merged_at is not null then
  raise exception 'Pending unmerged proposal or matching immutable owner receipt required';
 elsif request_exists then
  select * into fence from uid_rule_private.recovery_fences where proposal_id=p.id;
  if fence.recovery_id is distinct from p_recovery_id or fence.owner_user_id is distinct from p_actor_user_id
   or fence.recovery_token::text is distinct from request.result->>'recovery_token'
  then
   return jsonb_build_object('proposal_id',p.id,'owner_user_id',p_actor_user_id,'recovery_id',p_recovery_id,
    'status','superseded','canonical_changed',false);
  end if;
  return request.result;
 else
  token:=gen_random_uuid();
  insert into uid_rule_private.recovery_fences(proposal_id,owner_user_id,recovery_token,recovery_id)
   values(p.id,p_actor_user_id,token,p_recovery_id)
   on conflict(proposal_id) do update set owner_user_id=excluded.owner_user_id,recovery_token=excluded.recovery_token,
    recovery_id=excluded.recovery_id,created_at=now();
  result:=jsonb_build_object('proposal_id',p.id,'owner_user_id',p_actor_user_id,'recovery_id',p_recovery_id,
   'status','fenced_not_applied','recovery_token',token,'canonical_changed',false);
 end if;
 if not request_exists then
  perform set_config('uid.rule_recovery_action','recover',true);
  insert into uid_rule_private.recovery_requests(recovery_id,proposal_id,owner_user_id,result)
   values(p_recovery_id,p.id,p_actor_user_id,result);
  perform set_config('uid.rule_recovery_action',coalesce(old_action,''),true);
 end if;
 return result;
end $$;
revoke all on function public.uid_rule_recover(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.uid_rule_recover(uuid,uuid,uuid) to service_role;
