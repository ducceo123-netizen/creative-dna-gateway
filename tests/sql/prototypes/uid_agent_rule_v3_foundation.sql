-- INACTIVE PROTOTYPE. Load only in a disposable test database.
-- Not in supabase/migrations: activation and privileges require separate review.
-- No enabled policy, compiler release, API grant or canonical writer is installed.
create schema uid_rule_v3_private;
revoke all on schema uid_rule_v3_private from public,anon,authenticated,service_role;

create table uid_rule_v3_private.authorization_epoch (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 1 check(revision>0)
);
insert into uid_rule_v3_private.authorization_epoch(singleton) values(true);
-- This is an authorization-version fence, not a new source of owner authority.
-- Fence actual owner authority changes, including revoke/re-enable. Unrelated
-- team-member edits and no-op writes do not invalidate delegated work.
create function uid_rule_v3_private.bump_authorization_epoch() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if tg_level='ROW' then
  if tg_op='UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then return null; end if;
  if tg_table_name='creative_dna_team_members' then
   if not exists(select 1 from uid_rule_private.owner_config c where c.singleton and
    (c.owner_user_id=(to_jsonb(new)->>'user_id')::uuid or c.owner_user_id=(to_jsonb(old)->>'user_id')::uuid)) then return null; end if;
   if tg_op='UPDATE' and row(new.user_id,new.role,new.is_active) is not distinct from row(old.user_id,old.role,old.is_active) then return null; end if;
  end if;
 end if;
 update uid_rule_v3_private.authorization_epoch set revision=revision+1 where singleton;
 return null;
end $$;
create trigger uid_rule_v3_owner_epoch after insert or update or delete on uid_rule_private.owner_config
 for each row execute function uid_rule_v3_private.bump_authorization_epoch();
create trigger uid_rule_v3_membership_epoch after insert or update or delete on public.creative_dna_team_members
 for each row execute function uid_rule_v3_private.bump_authorization_epoch();

create table uid_rule_v3_private.release (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 revision bigint not null check(revision>0),
 compiler_version text not null check(compiler_version='2026-10-15-agent-rule-general-v1'),
 source_manifest jsonb not null check(jsonb_typeof(source_manifest)='array'),
 compiler_bundle_hash text not null check(compiler_bundle_hash~'^[0-9a-f]{64}$'),
 approved_release_reference text not null check(length(approved_release_reference) between 8 and 500)
);
-- Any release mutation also fences outstanding requests, including
-- disable/re-enable with the same explicit revision or delete/reinsert release.
create trigger uid_rule_v3_release_epoch after insert or update or delete on uid_rule_v3_private.release
 for each statement execute function uid_rule_v3_private.bump_authorization_epoch();

-- Tables intentionally empty. Test-only fixtures may seed them in a rollback.

create table uid_rule_v3_private.requests (
 id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.knowledge_proposals(id),
 owner_user_id uuid not null, operation text not null check(operation='creative_rule_supplement.v1'),
 idempotency_key uuid not null, intent_hash text not null,
 intent jsonb not null check(jsonb_typeof(intent)='object'),
 authorization_revision bigint not null, release_revision bigint not null,
 status text not null default 'queued' check(status in ('queued','leased','blocked','merged','cancelled','superseded','expired')),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, next_attempt_at timestamptz,
 claimant text, lease_token uuid, lease_version integer not null default 0 check(lease_version>=0),
 leased_at timestamptz, lease_expires_at timestamptz,
 blockers jsonb not null default '[]' check(jsonb_typeof(blockers)='array'), outcome jsonb,
 unique(owner_user_id,operation,idempotency_key),
 check(expires_at>created_at and expires_at<=created_at+interval '24 hours'),
 check(status<>'leased' or (claimant='dot' and lease_token is not null and leased_at is not null
  and lease_expires_at>leased_at and lease_expires_at<=leased_at+interval '900 seconds' and lease_expires_at<=expires_at))
);
create unique index uid_rule_v3_one_active_proposal on uid_rule_v3_private.requests(proposal_id)
 where status in ('queued','leased','blocked');
create table uid_rule_v3_private.attempts (
 request_id uuid not null references uid_rule_v3_private.requests(id), lease_version integer not null,
 lease_token uuid not null unique, claimant text not null check(claimant='dot'),
 candidate_hash text not null, snapshot_hash text not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 leased_at timestamptz not null, lease_expires_at timestamptz not null,
 primary key(request_id,lease_version), check(lease_version>0),
 check(lease_expires_at>leased_at and lease_expires_at<=leased_at+interval '900 seconds')
);
create table uid_rule_v3_private.audit (
 id uuid primary key default gen_random_uuid(), request_id uuid not null,
 lease_version integer not null, proposal_id uuid not null references public.knowledge_proposals(id),
 owner_user_id uuid not null, decision_kind text not null default 'agent_rule_review' check(decision_kind='agent_rule_review'),
 visual_qc_performed boolean not null default false check(not visual_qc_performed),
 review_scope text not null default 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'
  check(review_scope='RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'),
 result text not null check(result in ('blocked','merged','superseded','expired')),
 review jsonb not null, compiler_plan jsonb, compiler_receipt jsonb,
 before_snapshot jsonb not null, after_snapshot jsonb, blockers jsonb not null,
 completed_at timestamptz not null default clock_timestamp(),
 foreign key(request_id,lease_version) references uid_rule_v3_private.attempts(request_id,lease_version),
 unique(request_id,lease_version)
);
create unique index uid_rule_v3_one_merge_audit on uid_rule_v3_private.audit(proposal_id) where result='merged';
create table uid_rule_v3_private.events (
 id bigint generated always as identity primary key,
 request_id uuid not null references uid_rule_v3_private.requests(id),
 from_status text,to_status text not null,lease_version integer not null,
 occurred_at timestamptz not null default clock_timestamp(),details jsonb not null
);

create function uid_rule_v3_private.guard_request() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare action text:=current_setting('uid.rule_v3_action',true); owner_name text;
begin
 select pg_get_userbyid(relowner) into owner_name from pg_class where oid=tg_relid;
 if tg_op='DELETE' or current_user<>owner_name or action is null or action not in ('handoff','claim','complete','cancel','expire') then
  raise exception 'V3 requests require a guarded transaction'; end if;
 if tg_op='INSERT' then
  if action<>'handoff' or new.status<>'queued' or new.lease_version<>0 then raise exception 'Invalid initial rule request'; end if;
 else
  if row(new.id,new.proposal_id,new.owner_user_id,new.operation,new.idempotency_key,new.intent_hash,new.intent,
    new.authorization_revision,new.release_revision,new.created_at,new.expires_at)
   is distinct from row(old.id,old.proposal_id,old.owner_user_id,old.operation,old.idempotency_key,old.intent_hash,old.intent,
    old.authorization_revision,old.release_revision,old.created_at,old.expires_at)
  then raise exception 'Intent, authority and expiry are immutable'; end if;
  if old.status in ('merged','cancelled','superseded','expired') then raise exception 'Terminal rule request is immutable'; end if;
  if action='handoff' and new.status<>'superseded' then raise exception 'Invalid handoff transition'; end if;
  if action='cancel' and new.status<>'cancelled' then raise exception 'Invalid cancellation'; end if;
  if action='expire' and new.status<>'expired' then raise exception 'Invalid expiry'; end if;
  if action='claim' and new.status not in ('leased','blocked','expired','superseded') then raise exception 'Invalid claim transition'; end if;
  if action='complete' and (old.status<>'leased' or new.status not in ('merged','blocked','queued','superseded','expired')) then raise exception 'Invalid completion transition'; end if;
  if new.status='leased' and (action<>'claim' or new.lease_version<>old.lease_version+1 or new.lease_token is not distinct from old.lease_token)
  then raise exception 'Fresh fenced lease required'; end if;
  if new.status<>'leased' and new.lease_version<>old.lease_version then raise exception 'Lease version changed outside claim'; end if;
 end if;
 return new;
end $$;
create trigger uid_rule_v3_request_guard before insert or update or delete on uid_rule_v3_private.requests
 for each row execute function uid_rule_v3_private.guard_request();
create function uid_rule_v3_private.guard_audit() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare action text:=current_setting('uid.rule_v3_action',true); owner_name text;
begin
 select pg_get_userbyid(relowner) into owner_name from pg_class where oid=tg_relid;
 if tg_op<>'INSERT' or current_user<>owner_name or action is null or action not in ('handoff','claim','complete','cancel','expire')
 then raise exception 'V3 audit is append-only and transaction guarded'; end if;
 if tg_table_name='attempts' and action<>'claim' then raise exception 'Attempt requires claim'; end if;
 if tg_table_name='audit' and action<>'complete' then raise exception 'Decision requires completion'; end if;
 return new;
end $$;
create trigger uid_rule_v3_attempt_guard before insert or update or delete on uid_rule_v3_private.attempts for each row execute function uid_rule_v3_private.guard_audit();
create trigger uid_rule_v3_audit_guard before insert or update or delete on uid_rule_v3_private.audit for each row execute function uid_rule_v3_private.guard_audit();
create trigger uid_rule_v3_event_guard before insert or update or delete on uid_rule_v3_private.events for each row execute function uid_rule_v3_private.guard_audit();
create function uid_rule_v3_private.log_event() returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 insert into uid_rule_v3_private.events(request_id,from_status,to_status,lease_version,details)
 values(new.id,case when tg_op='INSERT' then null else old.status end,new.status,new.lease_version,
  jsonb_build_object('blockers',new.blockers,'outcome',new.outcome));
 return new;
end $$;
create trigger uid_rule_v3_event_log after insert or update on uid_rule_v3_private.requests for each row execute function uid_rule_v3_private.log_event();

alter table uid_rule_v3_private.authorization_epoch enable row level security;
alter table uid_rule_v3_private.release enable row level security;

alter table uid_rule_v3_private.requests enable row level security;
alter table uid_rule_v3_private.attempts enable row level security;
alter table uid_rule_v3_private.audit enable row level security;
alter table uid_rule_v3_private.events enable row level security;
revoke all on all tables in schema uid_rule_v3_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema uid_rule_v3_private from public,anon,authenticated,service_role;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;
