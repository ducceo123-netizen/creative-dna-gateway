-- Private, owner-approved autonomous review intents. No cron, keys, baseline
-- approvals, artifact generation, or changes to the legacy manual merge path.
-- service_role is the existing verified Edge/trusted-dot boundary, not a client.
create table public.uid_review_requests (
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid not null references public.knowledge_proposals(id),
 owner_user_id uuid not null,
 intent_hash text not null,
 intent jsonb not null check(jsonb_typeof(intent)='object'),
 last_snapshot_hash text, next_attempt_at timestamptz,
 status text not null default 'queued' check(status in ('queued','leased','blocked','merged','cancelled','superseded','expired')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
 claimant text, lease_token uuid, lease_version integer not null default 0 check(lease_version>=0),
 leased_at timestamptz, lease_expires_at timestamptz,
 blockers jsonb not null default '[]' check(jsonb_typeof(blockers)='array'),
 outcome jsonb,

 check(expires_at>created_at),
 check(status<>'leased' or (claimant is not null and lease_token is not null and leased_at is not null and lease_expires_at>leased_at))
);
create unique index uid_review_active_intent on public.uid_review_requests(owner_user_id,proposal_id,intent_hash) where status in ('queued','leased','blocked');
create table public.uid_review_attempts (
 request_id uuid not null references public.uid_review_requests(id),
 lease_version integer not null, lease_token uuid not null unique, claimant text not null,
 candidate_hash text not null, snapshot_hash text not null, snapshot jsonb not null,
 leased_at timestamptz not null, lease_expires_at timestamptz not null,
 primary key(request_id,lease_version)
);
create index uid_review_claimable on public.uid_review_requests(owner_user_id,created_at,id) where status in ('queued','leased');
create index uid_review_owner_proposal on public.uid_review_requests(owner_user_id,proposal_id,created_at desc,id);
create table public.uid_review_events (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.uid_review_requests(id),
 owner_user_id uuid not null, from_status text, to_status text not null,
 lease_version integer not null, occurred_at timestamptz not null default clock_timestamp(),
 details jsonb not null
);
create table public.uid_agent_review_evaluations (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.uid_review_requests(id),
 proposal_id uuid not null references public.knowledge_proposals(id), owner_user_id uuid not null,
 evaluator_version text not null check(evaluator_version='dot-agent-v1-source-media'),
 candidate_hash text not null, snapshot_hash text not null,
 lease_version integer not null, claimant text not null,
 evaluation_status text not null check(evaluation_status in ('blocked','passed')),
 critical_failures integer not null check(critical_failures>=0),
 submitted_review jsonb not null, mechanical_results jsonb not null, blockers jsonb not null,
 before_snapshot jsonb not null, after_snapshot jsonb,
 completed_at timestamptz not null default clock_timestamp(),
 unique(request_id,lease_version)
);
comment on table public.uid_agent_review_evaluations is
 'Immutable trusted-executor source/media receipts and SQL mechanical checks. SQL verifies coverage and identity, not remote bytes or pixels. No manual-review flags.';
alter table public.uid_review_requests enable row level security;
alter table public.uid_review_attempts enable row level security;
alter table public.uid_review_events enable row level security;
alter table public.uid_agent_review_evaluations enable row level security;
revoke all on public.uid_review_requests,public.uid_review_attempts,public.uid_review_events,public.uid_agent_review_evaluations from public,anon,authenticated,service_role;
revoke all on sequence public.uid_review_events_id_seq from public,anon,authenticated,service_role;

create function public.uid_review_digest(p_value jsonb) returns text
 language sql immutable set search_path=public,pg_temp as $$
 select 'sha256:'||encode(sha256(convert_to(p_value::text,'UTF8')),'hex')
$$;
create function public.uid_review_assert_admin(p_actor uuid) returns void
 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.creative_dna_team_members where user_id=p_actor and role='admin' and is_active=true for share;
 if not found then raise exception 'Active admin required'; end if;
end $$;
-- Discover stored HTTP(S) locators without inventing source or visual media.
-- Insecure HTTP locators are retained so readiness blocks rather than hiding them.
-- Adjacent digest/object-version metadata is pinned when it exists.
create function public.uid_review_urls(p_doc jsonb,p_path text default '')
 returns table(path text,locator text,expected_content_sha256 text,object_version text)
 language plpgsql immutable set search_path=public,pg_temp as $$
declare x record; child record; prefix text;
begin
 if jsonb_typeof(p_doc)='string' and (p_doc#>>'{}')~'^https?://[^[:space:]]+$' then
  return query select p_path,p_doc#>>'{}',null::text,null::text;
 elsif jsonb_typeof(p_doc)='object' then
  for x in select key,value from jsonb_each(p_doc) order by key loop
   prefix:=p_path||'/'||replace(replace(x.key,'~','~0'),'/','~1');
   for child in select * from public.uid_review_urls(x.value,prefix) loop
    return query select child.path,child.locator,
     coalesce(child.expected_content_sha256,case when jsonb_typeof(x.value)='string' then coalesce(p_doc->>'content_sha256',p_doc->>'sha256') end),
     coalesce(child.object_version,case when jsonb_typeof(x.value)='string' then coalesce(p_doc->>'object_version',p_doc->>'version_id') end);
   end loop;
  end loop;
 elsif jsonb_typeof(p_doc)='array' then
  for x in select value,ordinality from jsonb_array_elements(p_doc) with ordinality loop
   return query select * from public.uid_review_urls(x.value,p_path||'/'||(x.ordinality-1)::text);
  end loop;
 end if;
end $$;

create function public.uid_review_snapshot(p_proposal_id uuid) returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb; s jsonb; runs jsonb; manifest jsonb;
begin
 c:=public.uid_governance_review_context(p_proposal_id);
 if c is null then return null; end if;
 select to_jsonb(n) into s from public.knowledge_nodes n where n.id=(c#>>'{proposal,knowledge_node_id}')::uuid;
 select coalesce(jsonb_agg(jsonb_build_object(
  'baseline_id',b->>'id','case_key',b->>'case_key','source_run_id',r->>'source_run_id',
  'artifact_url',r->>'artifact_url','output',r->'candidate_output',
  'evaluation_id',e.id,'evaluation_record_version',public.uid_review_digest(to_jsonb(e)),
  'evaluation_record',to_jsonb(e),'test_result_count',(select count(*) from jsonb_array_elements(e.test_results) x where x->>'baseline_id'=b->>'id')
 ) order by b->>'id'),'[]') into runs
 from jsonb_array_elements(c->'baselines') b
 join lateral (
  select ev.* from public.uid_governance_evaluations ev
  where ev.proposal_id=p_proposal_id and ev.candidate_hash=c->>'candidate_hash'
   and ev.evaluator_version='mechanical-v2-scope-freshness' and jsonb_typeof(ev.test_results)='array'
   and exists(select 1 from jsonb_array_elements(ev.test_results) x where x->>'baseline_id'=b->>'id')
  order by ev.created_at desc,ev.id desc limit 1
 )e on true
 join lateral (select value r from jsonb_array_elements(e.test_results) where value->>'baseline_id'=b->>'id' limit 1)r on true
 where b->>'approved_at' is not null and b->'is_reference_only'='false'::jsonb;
 with baselines as (
  select b from jsonb_array_elements(c->'baselines') b where b->>'approved_at' is not null and b->'is_reference_only'='false'::jsonb
 ), docs as (
  select b->>'id' baseline_id,b->>'brand_id' brand_id,'source' kind,'source_brief' origin,b->'source_brief' doc,public.uid_review_digest(b-'is_reference_only') record_version from baselines
  union all select b->>'id',b->>'brand_id','source','context_images',c#>'{proposal,context_images}',public.uid_review_digest(c->'proposal') from baselines
  union all select b->>'id',b->>'brand_id','baseline','approved_output',b->'approved_output',public.uid_review_digest(b-'is_reference_only') from baselines
  union all select b->>'id',b->>'brand_id','candidate','candidate_artifact',to_jsonb(r->>'artifact_url'),r->>'evaluation_record_version' from baselines join jsonb_array_elements(runs) r on r->>'baseline_id'=b->>'id'
  union all select b->>'id',b->>'brand_id','candidate','candidate_output',r->'output',r->>'evaluation_record_version' from baselines join jsonb_array_elements(runs) r on r->>'baseline_id'=b->>'id'
 ), evidence as (
  select jsonb_build_object('kind',d.kind,'origin',d.origin,'baseline_id',d.baseline_id,'brand_id',d.brand_id,
    'path',u.path,'locator',u.locator,'record_version',d.record_version,
    'expected_content_sha256',u.expected_content_sha256,'object_version',u.object_version) item
  from docs d cross join lateral public.uid_review_urls(d.doc)u
 ) select coalesce(jsonb_agg(item||jsonb_build_object('evidence_id',public.uid_review_digest(item)) order by item::text),'[]') into manifest from evidence;
 return jsonb_build_object('schema_version','uid.review-snapshot.v1','proposal',c->'proposal','source',s,
  'scope',c->'scope','candidate_hash',c->'candidate_hash','targets',c->'targets','baselines',c->'baselines',
  'eligible_baseline_ids',c->'eligible_baseline_ids','candidate_runs',runs,'media_manifest',manifest);
end $$;

-- No caller can turn a label or legacy checkbox into a mechanical pass.
create function public.uid_review_checks(p_snapshot jsonb) returns jsonb
 language plpgsql immutable set search_path=public,pg_temp as $$
declare blockers jsonb:='[]'; results jsonb:='[]'; issues jsonb; b jsonb; r jsonb; t jsonb; a jsonb; key text; val jsonb; token text; output_text text; n integer; bad boolean; critical integer:=0;
begin
 if p_snapshot is null or coalesce(jsonb_array_length(p_snapshot->'targets'),0)=0 or p_snapshot#>>'{proposal,status}' is distinct from 'pending' then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unavailable_scope','message','Pending feedback and active canonical targets required.','next_action','Refresh the feedback and verify its scope.'));
 end if;
 for t in select value from jsonb_array_elements(coalesce(p_snapshot->'targets','[]')) loop
  if not exists(select 1 from jsonb_array_elements(p_snapshot->'baselines') x where x->>'brand_id' is not distinct from t->>'brand_id' and x->>'approved_at' is not null and x->'is_reference_only'='false'::jsonb) then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_baseline','message','An approved non-reference quality baseline is missing for '||coalesce(t->>'brand_name','this brand')||'.','next_action','An administrator must supply and approve a genuine quality baseline for every affected brand.'));
  end if;
 end loop;
 if coalesce(jsonb_array_length(p_snapshot->'eligible_baseline_ids'),0)=0 then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_baseline','message','No approved non-reference quality baseline.','next_action','Supply approved quality baselines; saved reference corpora cannot approve a change.'));
 end if;
 for b in select value from jsonb_array_elements(coalesce(p_snapshot->'baselines','[]')) where value->>'approved_at' is not null and value->'is_reference_only'='false'::jsonb loop
  issues:='[]';
  select count(*) into n from jsonb_array_elements(p_snapshot->'candidate_runs') x where x->>'baseline_id'=b->>'id';
  select value into r from jsonb_array_elements(p_snapshot->'candidate_runs') x where x->>'baseline_id'=b->>'id' limit 1;
  if n<>1 or r->'test_result_count' is distinct from '1'::jsonb or r->>'case_key' is distinct from b->>'case_key'
   or coalesce(length(btrim(r->>'source_run_id')),0)=0 or coalesce(r->>'artifact_url','')!~'^https://[^[:space:]]+$'
   or jsonb_typeof(r->'output') is distinct from 'object' or r->'output'='{}'::jsonb then
   issues:=issues||jsonb_build_array('Exactly one stored candidate output, run ID and HTTPS artifact is required.');
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_candidate','message','Missing or invalid candidate for baseline '||(b->>'case_key')||'.','next_action','Record a real candidate run for this exact proposal hash, then refresh evidence and explicitly approve again.'));
  else
   a:=b->'expected_assertions'; bad:=jsonb_typeof(a) is distinct from 'object'; n:=0;
   foreach key in array array['required_text','forbidden_text','required_keys','immutable_fields'] loop
    if a ? key then
     if jsonb_typeof(a->key) is distinct from 'array' then bad:=true;
     else
      n:=n+jsonb_array_length(a->key);
      for val in select value from jsonb_array_elements(a->key) loop
       if jsonb_typeof(val) is distinct from 'string' or length(btrim(val#>>'{}'))=0 then bad:=true; end if;
      end loop;
     end if;
    end if;
   end loop;
   if bad or n=0 then issues:=issues||jsonb_build_array('Approved assertions are absent or malformed.');
   else
    output_text:=lower((r->'output')::text);
    for token in select value from jsonb_array_elements_text(coalesce(a->'required_text','[]')) loop
     if position(lower(token) in output_text)=0 then issues:=issues||jsonb_build_array('Required statement missing: '||token); end if;
    end loop;
    for token in select value from jsonb_array_elements_text(coalesce(a->'forbidden_text','[]')) loop
     if position(lower(token) in output_text)>0 then issues:=issues||jsonb_build_array('Forbidden statement found: '||token); end if;
    end loop;
    for token in select value from jsonb_array_elements_text(coalesce(a->'required_keys','[]')) loop
     if not (r->'output' ? token) then issues:=issues||jsonb_build_array('Required output field missing: '||token); end if;
    end loop;
    for token in select value from jsonb_array_elements_text(coalesce(a->'immutable_fields','[]')) loop
     if not (r->'output' ? token) or not (b->'approved_output' ? token) or r->'output'->token is distinct from b->'approved_output'->token then
      issues:=issues||jsonb_build_array('Approved immutable field missing or changed: '||token);
     end if;
    end loop;
   end if;
  end if;
  foreach key in array array['source_brief','approved_output','candidate_artifact'] loop
   if not exists(select 1 from jsonb_array_elements(p_snapshot->'media_manifest') m where m->>'baseline_id'=b->>'id' and m->>'origin'=key) then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_media','message','Missing '||key||' HTTPS evidence for baseline '||(b->>'case_key')||'.','next_action','Attach real product-source, approved baseline visual, and candidate media before approving again.'));
   end if;
  end loop;
  if jsonb_array_length(issues)>0 then critical:=critical+jsonb_array_length(issues); end if;
  results:=results||jsonb_build_array(jsonb_build_object('baseline_id',b->>'id','case_key',b->>'case_key','status',case when issues='[]'::jsonb then 'passed' else 'failed' end,'issues',issues));
 end loop;
 if critical>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','mechanical_failed','message','Candidate failed deterministic approved assertions.','next_action','Correct the candidate or approved assertions; run and record the candidate again.')); end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'media_manifest','[]')) m where m->>'locator'!~'^https://[^[:space:]]+$') then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','insecure_media','message','A stored media locator does not use HTTPS.','next_action','Provide secure source and artifact links before review.'));
 end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'media_manifest','[]')) m where m->>'expected_content_sha256' is not null and m->>'expected_content_sha256'!~'^[0-9a-f]{64}$') then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_digest','message','Stored media digest is malformed.','next_action','Correct the source digest metadata and explicitly approve the refreshed evidence.'));
 end if;
 return jsonb_build_object('blockers',blockers,'mechanical_results',results,'critical_failures',critical);
end $$;

create function public.uid_review_intent(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
 language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('schema_version','uid.review-intent.v1','owner_user_id',p_actor_user_id,
  'proposal_id',p.id,'source_node_id',p.knowledge_node_id,'proposed_content_md',p.proposed_content_md,
  'raw_feedback',p.raw_feedback,'proposed_version',p.proposed_version,'change_summary',p.change_summary,
  'proposed_scope',p.proposed_scope,'brand_id',p.brand_id,
  'targets',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'brand_id',t.brand_id,'slug',t.slug) order by t.id)
    from public.uid_governance_target_nodes(p.id)t),'[]'))
 from public.knowledge_proposals p where p.id=p_proposal_id
$$;
create function public.uid_review_intent_hash(p_proposal_id uuid,p_actor_user_id uuid) returns text
 language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.creative_dna_team_members where user_id=p_actor_user_id and role='admin' and is_active)
 then raise exception 'Active admin required'; end if;
 return public.uid_review_digest(public.uid_review_intent(p_proposal_id,p_actor_user_id));
end $$;
create function public.uid_review_public(p_request public.uid_review_requests) returns jsonb
 language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('id',p_request.id,'proposal_id',p_request.proposal_id,'status',p_request.status,
  'created_at',p_request.created_at,'updated_at',p_request.updated_at,'expires_at',p_request.expires_at,
  'blockers',p_request.blockers,'outcome',p_request.outcome)
$$;

-- Table DML is not granted even to service_role. Triggers additionally constrain
-- owner-only RPC transitions. A database superuser remains outside this boundary.
create function public.uid_review_guard_request() returns trigger
 language plpgsql set search_path=public,pg_temp as $$
declare action text:=current_setting('uid.review_action',true); owner_name text;
begin
 select pg_get_userbyid(relowner) into owner_name from pg_class where oid=tg_relid;
 if tg_op='DELETE' then raise exception 'Review audit cannot be deleted'; end if;
 if current_user<>owner_name or action is null or action not in ('enqueue','claim','complete','cancel','expire') then
  raise exception 'Review writes require an authorized queue RPC';
 end if;
 if tg_op='INSERT' then
  if action<>'enqueue' or new.status not in ('queued','blocked') or new.lease_version<>0 then raise exception 'Invalid initial review state'; end if;
 else
  if row(new.id,new.proposal_id,new.owner_user_id,new.intent_hash,new.intent,new.created_at,new.expires_at)
     is distinct from row(old.id,old.proposal_id,old.owner_user_id,old.intent_hash,old.intent,old.created_at,old.expires_at)
   then raise exception 'Review intent and approval expiry are immutable'; end if;
  if old.status in ('merged','cancelled','superseded','expired') then raise exception 'Terminal review status is immutable'; end if;
  if action='enqueue' and new.status<>'superseded' then raise exception 'Invalid enqueue transition'; end if;
  if action='cancel' and new.status<>'cancelled' then raise exception 'Invalid cancellation transition'; end if;
  if action='expire' and new.status<>'expired' then raise exception 'Invalid expiry transition'; end if;
  if action='complete' and (old.status<>'leased' or new.status not in ('merged','blocked','queued','expired','superseded')) then raise exception 'Invalid completion transition'; end if;
  if action='claim' and new.status not in ('leased','blocked','expired','superseded') then raise exception 'Invalid claim transition'; end if;
  if new.status='leased' and (action<>'claim' or new.lease_version<>old.lease_version+1 or new.lease_token is not distinct from old.lease_token) then raise exception 'A fresh fenced lease is required'; end if;
  if new.status<>'leased' and new.lease_version<>old.lease_version then raise exception 'Lease version is immutable outside claim'; end if;
 end if;
 return new;
end $$;
create trigger uid_review_guard_request before insert or update or delete on public.uid_review_requests for each row execute function public.uid_review_guard_request();
create function public.uid_review_guard_audit() returns trigger
 language plpgsql set search_path=public,pg_temp as $$
declare action text:=current_setting('uid.review_action',true); owner_name text;
begin
 if tg_op<>'INSERT' then raise exception 'Review audit is immutable'; end if;
 select pg_get_userbyid(relowner) into owner_name from pg_class where oid=tg_relid;
 if current_user<>owner_name or action is null or action not in ('enqueue','claim','complete','cancel','expire') then raise exception 'Review audit writes require an authorized queue RPC'; end if;
 if tg_table_name='uid_review_attempts' and action<>'claim' then raise exception 'Attempt snapshot requires claim'; end if;
 if tg_table_name='uid_agent_review_evaluations' and action<>'complete' then raise exception 'Agent evaluation requires completion'; end if;
 return new;
end $$;
create trigger uid_review_attempt_guard before insert or update or delete on public.uid_review_attempts for each row execute function public.uid_review_guard_audit();
create trigger uid_review_event_guard before insert or update or delete on public.uid_review_events for each row execute function public.uid_review_guard_audit();
create trigger uid_agent_review_guard before insert or update or delete on public.uid_agent_review_evaluations for each row execute function public.uid_review_guard_audit();
create function public.uid_review_log_event() returns trigger
 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.uid_review_events(request_id,owner_user_id,from_status,to_status,lease_version,details)
 values(new.id,new.owner_user_id,case when tg_op='INSERT' then null else old.status end,new.status,new.lease_version,
  jsonb_build_object('blockers',new.blockers,'outcome',new.outcome,'snapshot_hash',new.last_snapshot_hash,
   'claimant',new.claimant,'lease_expires_at',new.lease_expires_at));
 return new;
end $$;
create trigger uid_review_log_event after insert or update on public.uid_review_requests for each row execute function public.uid_review_log_event();

create function public.uid_review_enqueue(p_proposal_id uuid,p_actor_user_id uuid,p_expected_intent_hash text) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.knowledge_proposals%rowtype; q public.uid_review_requests%rowtype; intent jsonb; h text; s jsonb; checks jsonb; previous text:=current_setting('uid.review_action',true);
begin
 perform public.uid_review_assert_admin(p_actor_user_id);
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 lock table public.uid_governance_evaluations in share mode;
 select * into p from public.knowledge_proposals where id=p_proposal_id for update;
 if not found then raise exception 'Proposal not found'; end if;
 intent:=public.uid_review_intent(p.id,p_actor_user_id); h:=public.uid_review_digest(intent);
 if p_expected_intent_hash is null or p_expected_intent_hash is distinct from h then raise exception 'Proposal patch or target scope changed; refresh and approve again'; end if;
 select * into q from public.uid_review_requests where owner_user_id=p_actor_user_id and proposal_id=p.id and intent_hash=h
 order by created_at desc,id desc limit 1 for update;
 if found and (q.status='merged' or (q.status in ('queued','leased','blocked') and q.expires_at>clock_timestamp())) then return public.uid_review_public(q); end if;
 if p.status<>'pending' or p.merged_at is not null then raise exception 'Pending unmerged proposal required'; end if;
 if jsonb_array_length(intent->'targets')=0 then raise exception 'Active target scope required'; end if;
 if q.id is not null and q.status in ('queued','leased','blocked') then
  perform set_config('uid.review_action','expire',true);
  update public.uid_review_requests set status='expired',updated_at=clock_timestamp(),blockers='[{"code":"intent_expired","message":"Approval expired.","next_action":"Review the current feedback and approve again."}]' where id=q.id;
 end if;
 perform set_config('uid.review_action','enqueue',true);
 update public.uid_review_requests set status='superseded',updated_at=clock_timestamp(),blockers='[{"code":"intent_changed","message":"A new patch or scope was approved.","next_action":"Use the latest approval."}]'
 where owner_user_id=p_actor_user_id and proposal_id=p.id and status in ('queued','leased','blocked') and intent_hash<>h;
 s:=public.uid_review_snapshot(p.id); checks:=public.uid_review_checks(s);
 insert into public.uid_review_requests(proposal_id,owner_user_id,intent_hash,intent,last_snapshot_hash,status,blockers)
 values(p.id,p_actor_user_id,h,intent,public.uid_review_digest(s),case when checks->'blockers'='[]'::jsonb then 'queued' else 'blocked' end,checks->'blockers') returning * into q;
 perform set_config('uid.review_action',coalesce(previous,''),true);
 return public.uid_review_public(q);
end $$;

create function public.uid_review_get(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.uid_review_requests%rowtype; previous text:=current_setting('uid.review_action',true);
begin
 perform public.uid_review_assert_admin(p_actor_user_id);
 select * into q from public.uid_review_requests where proposal_id=p_proposal_id and owner_user_id=p_actor_user_id order by created_at desc,id desc limit 1 for update;
 if not found then return null; end if;
 if q.status in ('queued','leased','blocked') and q.expires_at<=clock_timestamp() then
  perform set_config('uid.review_action','expire',true);
  update public.uid_review_requests set status='expired',updated_at=clock_timestamp(),blockers='[{"code":"intent_expired","message":"Approval expired.","next_action":"Review the current feedback and approve again."}]' where id=q.id returning * into q;
  perform set_config('uid.review_action',coalesce(previous,''),true);
 end if;
 return public.uid_review_public(q);
end $$;
create function public.uid_review_cancel(p_request_id uuid,p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.uid_review_requests%rowtype; previous text:=current_setting('uid.review_action',true);
begin
 perform public.uid_review_assert_admin(p_actor_user_id);
 select * into q from public.uid_review_requests where id=p_request_id and proposal_id=p_proposal_id and owner_user_id=p_actor_user_id for update;
 if not found then raise exception 'Owner review request not found'; end if;
 if q.status='cancelled' then return public.uid_review_public(q); end if;
 if q.status not in ('queued','leased','blocked') then raise exception 'Review request is already terminal'; end if;
 perform set_config('uid.review_action','cancel',true);
 update public.uid_review_requests set status='cancelled',updated_at=clock_timestamp(),outcome=jsonb_build_object('canonical_changed',false,'reason','Cancelled by the approval owner.') where id=q.id returning * into q;
 perform set_config('uid.review_action',coalesce(previous,''),true);
 return public.uid_review_public(q);
end $$;

create function public.uid_review_claim(p_owner_user_id uuid,p_claimant text default 'dot') returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.uid_review_requests%rowtype; s jsonb; h text; checks jsonb; seen uuid[]:='{}'; p public.knowledge_proposals%rowtype; previous text:=current_setting('uid.review_action',true);
begin
 perform public.uid_review_assert_admin(p_owner_user_id);
 if p_claimant is null or length(btrim(p_claimant))=0 or length(p_claimant)>100 then raise exception 'Valid claimant required'; end if;
 lock table public.knowledge_nodes in share mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 lock table public.uid_governance_evaluations in share mode;
 perform set_config('uid.review_action','claim',true);
 loop
  -- Fetch one row at a time: a PL/pgSQL FOR cursor may prefetch/lock multiple
  -- requests and defeat concurrent SKIP LOCKED claimers.
  select * into q from public.uid_review_requests where owner_user_id=p_owner_user_id and not(id=any(seen))
   and (status in ('queued','blocked') or (status='leased' and lease_expires_at<=clock_timestamp()))
   order by created_at,id limit 1 for update skip locked;
  exit when not found;
  seen:=array_append(seen,q.id);
  if q.expires_at<=clock_timestamp() then
   update public.uid_review_requests set status='expired',updated_at=clock_timestamp(),blockers='[{"code":"intent_expired","message":"Approval expired.","next_action":"Review the current feedback and approve again."}]' where id=q.id;
   continue;
  end if;
  select * into p from public.knowledge_proposals where id=q.proposal_id for share;
  if p.status is distinct from 'pending' or p.merged_at is not null or public.uid_review_digest(public.uid_review_intent(q.proposal_id,q.owner_user_id)) is distinct from q.intent_hash then
   update public.uid_review_requests set status='superseded',updated_at=clock_timestamp(),blockers='[{"code":"intent_changed","message":"Feedback patch, target scope, or proposal state changed.","next_action":"Refresh and approve the new feedback if still needed."}]' where id=q.id;
   continue;
  end if;
  s:=public.uid_review_snapshot(q.proposal_id); h:=public.uid_review_digest(s);
  if q.status='blocked' and q.last_snapshot_hash=h and (q.next_attempt_at is null or q.next_attempt_at>clock_timestamp()) then continue; end if;
  checks:=public.uid_review_checks(s);
  if checks->'blockers'<>'[]'::jsonb then
   update public.uid_review_requests set status='blocked',updated_at=clock_timestamp(),last_snapshot_hash=h,blockers=checks->'blockers' where id=q.id;
   continue;
  end if;
  update public.uid_review_requests set status='leased',claimant=btrim(p_claimant),lease_token=gen_random_uuid(),lease_version=lease_version+1,
   leased_at=clock_timestamp(),lease_expires_at=least(clock_timestamp()+interval '900 seconds',expires_at),
   updated_at=clock_timestamp(),last_snapshot_hash=h,blockers='[]',outcome=null,next_attempt_at=null where id=q.id returning * into q;
  insert into public.uid_review_attempts(request_id,lease_version,lease_token,claimant,candidate_hash,snapshot_hash,snapshot,leased_at,lease_expires_at)
   values(q.id,q.lease_version,q.lease_token,q.claimant,s->>'candidate_hash',h,s,q.leased_at,q.lease_expires_at);
  perform set_config('uid.review_action',coalesce(previous,''),true);
  return jsonb_build_object('request_id',q.id,'owner_user_id',q.owner_user_id,'proposal_id',q.proposal_id,'intent_hash',q.intent_hash,
   'candidate_hash',s->>'candidate_hash','snapshot_hash',h,'lease_token',q.lease_token,'lease_version',q.lease_version,
   'leased_at',q.leased_at,'lease_expires_at',q.lease_expires_at,'expires_at',q.expires_at,'snapshot',s,
   'current_context',public.uid_governance_review_context(q.proposal_id));
 end loop;
 perform set_config('uid.review_action',coalesce(previous,''),true);
 return null;
end $$;

create function public.uid_review_assess_receipts(p_snapshot jsonb,p_review jsonb,p_leased_at timestamptz,p_now timestamptz) returns jsonb
 language plpgsql set search_path=public,pg_temp as $$
declare blockers jsonb:='[]'; receipts jsonb; findings jsonb; m jsonb; r jsonb; f jsonb; brand jsonb; criterion text;
 expected_ids jsonb; actual_ids jsonb; node_ids jsonb; actual_nodes jsonb; retrieved timestamptz; revalidated timestamptz;
 critical integer:=0; n integer; valid boolean;
begin
 if jsonb_typeof(p_review) is distinct from 'object' or p_review->>'schema_version' is distinct from 'uid.agent-review.v1'
  or coalesce(p_review->>'decision','') not in ('passed','blocked')
  or jsonb_typeof(p_review->'review_note') is distinct from 'string' or coalesce(length(btrim(p_review->>'review_note')),0)<20
  or p_review ? 'manually_reviewed' then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_review','message','A complete agent review packet is required.','next_action','Use the agent review schema with evidence-linked findings; manual flags cannot approve it.'));
 end if;
 receipts:=case when jsonb_typeof(p_review->'media_receipts')='array' then p_review->'media_receipts' else '[]'::jsonb end;
 findings:=case when jsonb_typeof(p_review->'findings')='array' then p_review->'findings' else '[]'::jsonb end;
 if jsonb_array_length(receipts)<>jsonb_array_length(p_snapshot->'media_manifest') then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','media_coverage','message','Media receipts do not exactly cover the pinned manifest.','next_action','Inspect every required source, approved baseline and candidate artifact.'));
 end if;
 for m in select value from jsonb_array_elements(p_snapshot->'media_manifest') loop
  select count(*) into n from jsonb_array_elements(receipts) x where x->>'evidence_id'=m->>'evidence_id';
  select value into r from jsonb_array_elements(receipts) x where x->>'evidence_id'=m->>'evidence_id' limit 1;
  valid:=n=1 and jsonb_typeof(r)='object'
   and r->>'locator' is not distinct from m->>'locator' and r->>'record_version' is not distinct from m->>'record_version'
   and coalesce(r->>'content_sha256','')~'^[0-9a-f]{64}$'
   and r->>'revalidated_sha256' is not distinct from r->>'content_sha256'
   and (m->>'expected_content_sha256' is null or m->>'expected_content_sha256'=r->>'content_sha256')
   and (m->>'object_version' is null or m->>'object_version'=r->>'object_version')
   and r->'inspected'='true'::jsonb and jsonb_typeof(r->'note')='string' and coalesce(length(btrim(r->>'note')),0)>=20
   and jsonb_typeof(r->'retrieved_at')='string' and jsonb_typeof(r->'revalidated_at')='string'
   and ((r->>'media_type'~'^image/' and r->>'inspection_method'='image')
     or (r->>'media_type'~'^video/' and r->>'inspection_method'='video')
     or (r->>'media_type' in ('application/pdf','text/html') and r->>'inspection_method'='rendered')
     or (m->>'kind'='source' and r->>'media_type'~'^text/' and r->>'inspection_method' in ('read','rendered')));
  begin
   retrieved:=(r->>'retrieved_at')::timestamptz; revalidated:=(r->>'revalidated_at')::timestamptz;
   valid:=valid and retrieved>=p_leased_at and retrieved<=p_now and revalidated>=retrieved and revalidated<=p_now;
  exception when others then valid:=false; end;
  if valid is distinct from true then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_media_receipt','message','Missing, stale or inconsistent receipt for '||(m->>'evidence_id')||'.','next_action','Fetch and inspect this exact locator; hash its bytes and revalidate identical bytes within the current lease.'));
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(receipts) rr group by rr->>'locator' having count(distinct rr->>'content_sha256')>1) then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','inconsistent_media_bytes','message','Receipts disagree about the bytes at the same locator.','next_action','Fetch and revalidate a consistent byte version for every repeated locator.'));
 end if;
 if exists(select 1 from jsonb_array_elements(receipts) rr where not exists(select 1 from jsonb_array_elements(p_snapshot->'media_manifest') mm where mm->>'evidence_id'=rr->>'evidence_id')) then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unknown_media','message','Receipt refers to evidence outside the pinned manifest.','next_action','Use only the evidence IDs returned by this claim.'));
 end if;
 select count(*) into n from (select distinct value->'brand_id' from jsonb_array_elements(p_snapshot->'targets'))brands;
 if jsonb_array_length(findings)<>n*3 then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','criterion_coverage','message','Exactly three criterion findings per affected brand are required.','next_action','Assess product_truth, visual_quality and canonical_conflicts separately for every affected brand.'));
 end if;
 for brand in select distinct value->'brand_id' from jsonb_array_elements(p_snapshot->'targets') loop
  select coalesce(jsonb_agg(mm->'evidence_id' order by mm->>'evidence_id'),'[]') into expected_ids from jsonb_array_elements(p_snapshot->'media_manifest') mm where mm->'brand_id' is not distinct from brand;
  select coalesce(jsonb_agg(t->'id' order by t->>'id'),'[]') into node_ids from jsonb_array_elements(p_snapshot->'targets') t where t->'brand_id' is not distinct from brand;
  foreach criterion in array array['product_truth','visual_quality','canonical_conflicts'] loop
   select count(*) into n from jsonb_array_elements(findings) x where x->'brand_id' is not distinct from brand and x->>'criterion'=criterion;
   select value into f from jsonb_array_elements(findings) x where x->'brand_id' is not distinct from brand and x->>'criterion'=criterion limit 1;
   actual_ids:=null; actual_nodes:=null;
   if jsonb_typeof(f->'evidence_ids')='array' then select coalesce(jsonb_agg(value order by value#>>'{}'),'[]') into actual_ids from jsonb_array_elements(f->'evidence_ids'); end if;
   if jsonb_typeof(f->'canonical_node_ids')='array' then select coalesce(jsonb_agg(value order by value#>>'{}'),'[]') into actual_nodes from jsonb_array_elements(f->'canonical_node_ids'); end if;
   if n<>1 or jsonb_typeof(f) is distinct from 'object' or f->>'result' is distinct from 'passed'
    or f->'critical' is distinct from 'false'::jsonb or jsonb_typeof(f->'note') is distinct from 'string'
    or coalesce(length(btrim(f->>'note')),0)<20 or actual_ids is distinct from expected_ids or actual_nodes is distinct from node_ids then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('code','criterion_not_passed','message',criterion||' is incomplete, failed or unknown for brand '||coalesce(brand#>>'{}','global')||'.','next_action','Record a source-linked finding covering all pinned media and canonical targets for this brand; unknowns cannot pass.'));
   end if;
  end loop;
 end loop;
 select count(*) into critical from jsonb_array_elements(findings) ff where ff->'critical'='true'::jsonb;
 if p_review->>'decision' is distinct from 'passed' then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','review_blocked','message','The reviewer did not approve this evidence.','next_action','Resolve the reported issues; fresh evidence can be reviewed within the unexpired approval.'));
 end if;
 return jsonb_build_object('blockers',blockers,'critical_failures',critical);
end $$;

create function public.uid_review_complete(p_request_id uuid,p_owner_user_id uuid,p_claimant text,p_lease_token uuid,
 p_lease_version integer,p_candidate_hash text,p_review jsonb) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.uid_review_requests%rowtype; a public.uid_review_attempts%rowtype; p public.knowledge_proposals%rowtype;
 s jsonb; checks jsonb; assessment jsonb; v_blockers jsonb:='[]'; new_status text:='blocked'; result jsonb;
 before_nodes jsonb; after_nodes jsonb; outside_nodes jsonb; evaluation_id uuid:=gen_random_uuid(); critical integer:=0;
 previous text:=current_setting('uid.review_action',true);
begin
 perform public.uid_review_assert_admin(p_owner_user_id);
 -- Same lock ordering as the existing guarded merger. Table locks prevent
 -- target/baseline/evaluation phantoms during the final atomic check and merge.
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.uid_governance_baselines in share mode;
 lock table public.brands in share mode;
 lock table public.uid_governance_evaluations in share mode;
 select * into q from public.uid_review_requests where id=p_request_id and owner_user_id=p_owner_user_id for update;
 if not found then raise exception 'Owner review request not found'; end if;
 select * into a from public.uid_review_attempts where request_id=q.id and lease_version=p_lease_version;
 if not found or a.lease_token is distinct from p_lease_token or a.claimant is distinct from p_claimant or a.candidate_hash is distinct from p_candidate_hash
 then raise exception 'Matching fenced review lease and candidate hash required'; end if;
 -- A replay is a read of the already committed result; it never re-merges.
 if exists(select 1 from public.uid_agent_review_evaluations e where e.request_id=q.id and e.lease_version=a.lease_version) then
  return public.uid_review_public(q);
 end if;
 if q.status<>'leased' or q.lease_token is distinct from p_lease_token or q.lease_version is distinct from p_lease_version or q.claimant is distinct from p_claimant then
  raise exception 'Matching active review lease required'; end if;
 if q.lease_expires_at<=clock_timestamp() then raise exception 'Review lease expired; reclaim and inspect a fresh snapshot'; end if;
 select * into p from public.knowledge_proposals where id=q.proposal_id for update;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into before_nodes from public.uid_governance_target_nodes(q.proposal_id)t;
 if q.expires_at<=clock_timestamp() then
  new_status:='expired'; v_blockers:='[{"code":"intent_expired","message":"Approval expired during review.","next_action":"Review the current feedback and approve again."}]';
 elsif p.status is distinct from 'pending' or p.merged_at is not null or public.uid_review_digest(public.uid_review_intent(q.proposal_id,q.owner_user_id)) is distinct from q.intent_hash then
  new_status:='superseded'; v_blockers:='[{"code":"intent_changed","message":"Feedback patch, scope or proposal state changed during review.","next_action":"Refresh and approve the new feedback if still needed."}]';
 else
  s:=public.uid_review_snapshot(q.proposal_id);
  if public.uid_review_digest(s) is distinct from a.snapshot_hash or s->>'candidate_hash' is distinct from a.candidate_hash then
   new_status:='queued'; v_blockers:='[{"code":"snapshot_changed","message":"Canonical rules or review evidence changed during inspection.","next_action":"Claim again and inspect the fresh snapshot; old receipts cannot be reused."}]';
  else
   checks:=public.uid_review_checks(a.snapshot);
   assessment:=public.uid_review_assess_receipts(a.snapshot,p_review,q.leased_at,clock_timestamp());
   v_blockers:=(checks->'blockers')||(assessment->'blockers');
   critical:=(checks->>'critical_failures')::integer+(assessment->>'critical_failures')::integer;
   if a.snapshot#>>'{source,slug}'='onepage-system' or exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t
    where t->>'slug'='brand-dna' or t->'metadata' ? 'creative_quality_contract') then
    v_blockers:=v_blockers||'[{"code":"compiler_integration_required","message":"Compiled routes and source dependencies require validated compiler and mirror updates.","next_action":"Keep this feedback pending until the shared atomic compiler-plan integration is available; append-only merge is disabled."}]'::jsonb;
   end if;
   if v_blockers='[]'::jsonb and critical=0 then new_status:='merged'; end if;
  end if;
 end if;
 perform set_config('uid.review_action','complete',true);
 if new_status='merged' then
  -- Recheck wall-clock deadlines after all potentially blocking locks/checks.
  if q.expires_at<=clock_timestamp() or q.lease_expires_at<=clock_timestamp() then raise exception 'Review lease or approval expired before merge; claim fresh review'; end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') into outside_nodes from public.knowledge_nodes n
   where not exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=n.id::text);
  insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
  select q.proposal_id,id,'before',content_md,metadata,version,q.owner_user_id from public.uid_governance_target_nodes(q.proposal_id);
  result:=public.admin_accept_merge_creative_dna_proposal(q.proposal_id,q.owner_user_id,
   'Agent review by '||q.claimant||' under owner-approved request '||q.id::text||' (lease '||q.lease_version||'). Source/media QC is recorded in the separate agent audit; the owner approved the proposed change. '||left(p_review->>'review_note',3400));
  if outside_nodes is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') from public.knowledge_nodes n
    where not exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where t->>'id'=n.id::text))
  then raise exception 'Merge trigger changed canonical rows outside approved scope; all changes rolled back'; end if;
  if exists(select 1 from jsonb_array_elements(a.snapshot->'targets') t where not exists(select 1 from public.knowledge_nodes n where n.id::text=t->>'id'))
  then raise exception 'Merge removed an approved canonical target; all changes rolled back'; end if;
  insert into public.uid_governance_snapshots(proposal_id,node_id,checkpoint,content_md,metadata,node_version,actor_id)
  select q.proposal_id,id,'after',content_md,metadata,version,q.owner_user_id from public.uid_governance_target_nodes(q.proposal_id);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into after_nodes from public.uid_governance_target_nodes(q.proposal_id)t;
 end if;
 insert into public.uid_agent_review_evaluations(id,request_id,proposal_id,owner_user_id,evaluator_version,candidate_hash,snapshot_hash,
  lease_version,claimant,evaluation_status,critical_failures,submitted_review,mechanical_results,blockers,before_snapshot,after_snapshot)
 values(evaluation_id,q.id,q.proposal_id,q.owner_user_id,'dot-agent-v1-source-media',a.candidate_hash,a.snapshot_hash,a.lease_version,a.claimant,
  case when new_status='merged' then 'passed' else 'blocked' end,critical,coalesce(p_review,'null'::jsonb),coalesce(checks->'mechanical_results','[]'),v_blockers,before_nodes,after_nodes);
 update public.uid_review_requests set status=new_status,updated_at=clock_timestamp(),blockers=v_blockers,
  next_attempt_at=case when new_status='blocked' then clock_timestamp()+interval '1 hour' else null end,
  outcome=jsonb_build_object('evaluation_id',evaluation_id,'canonical_changed',new_status='merged','merged_nodes',case when new_status='merged' then result->'merged_nodes' else '0'::jsonb end,
   'merged_at',case when new_status='merged' then result->'merged_at' else null end)
 where id=q.id returning * into q;
 perform set_config('uid.review_action',coalesce(previous,''),true);
 return public.uid_review_public(q);
end $$;

-- One MVCC snapshot binds the displayed proposal and its approval identity.
create function public.uid_review_preflight(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb; request_view jsonb; h text;
begin
 h:=public.uid_review_intent_hash(p_proposal_id,p_actor_user_id);
 c:=public.uid_governance_review_context(p_proposal_id);
 if c is null then return null; end if;
 select public.uid_review_public(q)||case when q.status in ('queued','leased','blocked') and q.expires_at<=statement_timestamp()
   then jsonb_build_object('status','expired') else '{}'::jsonb end into request_view
 from public.uid_review_requests q where q.owner_user_id=p_actor_user_id and q.proposal_id=p_proposal_id order by q.created_at desc,q.id desc limit 1;
 return c||jsonb_build_object('review_intent_hash',h,'review_request',request_view);
end $$;

-- Revoke defaults explicitly, including service_role on implementation helpers.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'uid_review_%') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.uid_review_preflight(uuid,uuid),public.uid_review_intent_hash(uuid,uuid),public.uid_review_enqueue(uuid,uuid,text),
 public.uid_review_get(uuid,uuid),public.uid_review_cancel(uuid,uuid,uuid),public.uid_review_claim(uuid,text),
 public.uid_review_complete(uuid,uuid,text,uuid,integer,text,jsonb) to service_role;
