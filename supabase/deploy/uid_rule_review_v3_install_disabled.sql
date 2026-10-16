-- Reviewed disabled installation body for Supabase apply_migration.
-- No security grants or activation; record the applied body hash in migration history.
-- This deployment installs a disabled capability. No release seed or RPC grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
 IF to_regnamespace('uid_rule_v3_private') IS NOT NULL THEN RAISE EXCEPTION 'V3 already exists: reconcile state, never replay blindly'; END IF;
 IF to_regprocedure('public.uid_review_claim(uuid,text)') IS NULL OR
    to_regprocedure('public.uid_rule_catalog_plan(jsonb)') IS NULL THEN RAISE EXCEPTION 'Required prior reviewed migrations missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM uid_rule_private.owner_config c JOIN public.creative_dna_team_members m ON m.user_id=c.owner_user_id WHERE c.singleton AND c.enabled AND c.owner_user_id='cf6721f5-86ce-46c2-8a1b-3c6ddabc64c6' AND m.is_active AND m.role='admin') THEN RAISE EXCEPTION 'Verified configured active owner missing'; END IF;
END $$;
-- SOURCE SHA256 29461894c644307c2f8ccae67c7c3d6d922c74185edeb552e345f93291eb2e50 tests/sql/prototypes/uid_agent_rule_v3_foundation.sql
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

-- SOURCE SHA256 d73250f334abaf33373f6904a317121eedbeb9fb2b3380b50d9301b0deb3e3fd tests/sql/prototypes/uid_agent_rule_v3_context.sql
-- INACTIVE PROTOTYPE. Disposable tests only; no grants or canonical writes.
create function uid_rule_v3_private.hex(p_value jsonb) returns text language sql immutable
set search_path=pg_catalog,public,pg_temp as $$ select encode(sha256(convert_to(public.uid_rule_stable_json(p_value),'UTF8')),'hex') $$;
create function uid_rule_v3_private.operation_for(p_text text,p_scope text) returns text
language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select case when public.uid_rule_parse_canonical(p_text) is not null and nullif(btrim(p_scope),'') is not null then 'creative_rule_supplement.v1' end
$$;
create function uid_rule_v3_private.context(p_proposal uuid,p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare raw jsonb; c jsonb;
begin
 raw:=public.uid_rule_context(p_proposal);
 if raw is null then return null; end if;
 c:=jsonb_build_object('proposal',raw->'proposal','scope',raw->'scope','targets',raw->'targets',
  'compiler_context',(raw->'compiler_context')||jsonb_build_object('owner_user_id',p_owner));
 -- Never reuse the outcome-QC candidate hash: baselines/evaluations do not grant
 -- authority or alter the rule-only freshness identity.
 return c||jsonb_build_object('candidate_hash','sha256:'||uid_rule_v3_private.hex(c));
end $$;
create function uid_rule_v3_private.intent(p_context jsonb,p_owner uuid,p_operation text) returns jsonb
language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('schema_version','uid.review-intent.v3','review_mode','agent_rule_review',
  'owner_user_id',p_owner,'operation',p_operation,'proposal_id',p_context#>'{proposal,id}',
  'source_node_id',p_context#>'{proposal,knowledge_node_id}',
  'proposed_content_md',p_context#>'{proposal,proposed_content_md}','proposed_scope',p_context#>'{proposal,proposed_scope}',
  'targets',(select jsonb_agg(jsonb_build_object('id',t->'id','brand_id',t->'brand_id','slug',t->'slug') order by t->>'id')
   from jsonb_array_elements(p_context->'targets') t))
$$;
create function uid_rule_v3_private.adapt_context(p_context jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb:=p_context; catalog jsonb; t jsonb; bundle jsonb; item jsonb; old jsonb; contracts jsonb; adapted jsonb;
 slug text; field text; all_rules jsonb; arr jsonb; targets jsonb; proof_keys text[]:=array[
 'schema_version','id','proposal_id','request_id','attempt_id','decision_kind','evaluator_version','snapshot_hash','review_hash',
 'review_scope','canonical_text','declared_scope','scope','rule_class','confidence','source','accepted_source_hashes','precedence','visual_qc_performed'];
begin
 select target_row.value#>'{metadata,creative_quality_contract}' into catalog from jsonb_array_elements(c->'targets') as target_row(value) order by target_row.value->>'id' limit 1;
 if catalog is null and not exists(select 1 from jsonb_array_elements(c->'targets') n where n#>'{metadata,creative_quality_contract}' is not null) then return c; end if;
 if catalog->>'schema_version' is distinct from 'uid-creative-quality-catalog/1' or jsonb_typeof(catalog->'contracts') is distinct from 'object'
 then raise exception 'Complete existing catalog required'; end if;
 if exists(select 1 from jsonb_array_elements(c->'targets') as target_row(value) where target_row.value#>'{metadata,creative_quality_contract}' is distinct from catalog)
 or exists(select 1 from jsonb_array_elements(c#>'{compiler_context,projected_targets}') as target_row(value) where target_row.value#>'{metadata,creative_quality_contract}' is distinct from catalog)
 then raise exception 'Prior catalog or mirror provenance drift'; end if;
 contracts:=catalog->'contracts';
 for t in select value from jsonb_array_elements(c->'targets') loop
  slug:=t->>'brand_slug'; bundle:=contracts->slug;
  foreach field in array array['owner_supplemental_rules','agent_reviewed_supplemental_rules','agent_rule_reviewed_supplemental_rules'] loop
   if bundle ? field and jsonb_typeof(bundle->field) is distinct from 'array' then raise exception 'Malformed prior supplemental array'; end if;
  end loop;
  arr:=coalesce(bundle->'agent_rule_reviewed_supplemental_rules','[]');
  if (bundle->>'schema_version'='uid-creative-quality/4' and jsonb_array_length(arr)=0)
   or (bundle ? 'agent_rule_reviewed_supplemental_rules' and bundle->>'schema_version' is distinct from 'uid-creative-quality/4')
  then raise exception 'Prior rule schema downgrade or empty history'; end if;
  all_rules:=coalesce(bundle->'owner_supplemental_rules','[]')||coalesce(bundle->'agent_reviewed_supplemental_rules','[]')||arr;
  if jsonb_array_length(all_rules)>=16 or exists(select 1 from jsonb_array_elements(all_rules) r group by r->>'id' having count(*)>1)
   or exists(select 1 from jsonb_array_elements(all_rules) r group by r->>'proposal_id' having count(*)>1)
   or exists(select 1 from jsonb_array_elements(all_rules) r where r->>'proposal_id'=c#>>'{proposal,id}' or r->>'canonical_text'=c#>>'{proposal,proposed_content_md}')
  then raise exception 'Prior capacity or supplemental collision'; end if;
  for item in select value from jsonb_array_elements(arr) loop
   if jsonb_typeof(item) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from (select array_agg(k order by k) from unnest(proof_keys) k)
    or item->>'schema_version' is distinct from 'uid.agent-rule-reviewed-supplemental-rule.v1'
    or item->>'decision_kind' is distinct from 'agent_rule_review' or item->'visual_qc_performed' is distinct from 'false'
    or item->>'review_scope' is distinct from 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'
    or item->>'evaluator_version' is distinct from 'dot-agent-v3-rule-semantics'
    or coalesce(item->>'request_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(item->>'proposal_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or item->>'attempt_id' is distinct from (item->>'request_id')||':'||split_part(item->>'attempt_id',':',2)
    or split_part(item->>'attempt_id',':',2) !~ '^[1-9][0-9]{0,8}$'
    or item->>'id' is distinct from 'agent-rule:'||(item->>'attempt_id')
    or coalesce(item->>'snapshot_hash','') !~ '^sha256:[0-9a-f]{64}$' or coalesce(item->>'review_hash','') !~ '^[0-9a-f]{64}$'
    or uid_rule_v3_private.operation_for(item->>'canonical_text',item->>'declared_scope') is null
    or jsonb_typeof(item->'scope') is distinct from 'object'
    or jsonb_typeof(item#>'{scope,brands}') is distinct from 'array'
    or (item#>'{scope,brands}' @> jsonb_build_array(t->>'brand_slug')) is distinct from true
    or item#>'{scope,branches}' is distinct from jsonb_build_array(t->>'slug')
    or coalesce(item->>'rule_class','') not in ('STRUCTURAL','BRAND_STYLE','WORKFLOW')
    or coalesce(item->>'confidence','') not in ('HIGH','MEDIUM')
    or item->>'precedence' is distinct from 'SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH'
    or item->'source' is distinct from jsonb_build_object('node','branch','locator','agent-rule:'||(item->>'proposal_id')||':'||(item->>'attempt_id'),
       'canonical_text_hash',encode(sha256(convert_to(item->>'canonical_text','UTF8')),'hex'))
    or jsonb_typeof(item->'accepted_source_hashes') is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(item->'accepted_source_hashes') k) is distinct from array['branch','brand_dna']
    or coalesce(item#>>'{accepted_source_hashes,branch}','') !~ '^[0-9a-f]{64}$'
    or coalesce(item#>>'{accepted_source_hashes,brand_dna}','') !~ '^[0-9a-f]{64}$'
    or position(item->>'canonical_text' in coalesce(t->>'content_md',''))=0
   then raise exception 'Malformed or unbound prior agent-rule provenance'; end if;
  end loop;
  if bundle->>'schema_version'='uid-creative-quality/4' then
   bundle:=(bundle-'agent_rule_reviewed_supplemental_rules')||jsonb_build_object('schema_version',
    case when jsonb_array_length(coalesce(bundle->'agent_reviewed_supplemental_rules','[]'))>0 then 'uid-creative-quality/3'
     when jsonb_array_length(coalesce(bundle->'owner_supplemental_rules','[]'))>0 then 'uid-creative-quality/2' else 'uid-creative-quality/1' end);
   contracts:=jsonb_set(contracts,array[slug],bundle);
  end if;
 end loop;
 adapted:=catalog||jsonb_build_object('contracts',contracts);
 select jsonb_agg(jsonb_set(target_row.value,'{metadata,creative_quality_contract}',adapted) order by target_row.value->>'id') into targets from jsonb_array_elements(c->'targets') as target_row(value);
 c:=jsonb_set(c,'{targets}',targets);
 select jsonb_agg(jsonb_set(target_row.value,'{metadata,creative_quality_contract}',adapted) order by target_row.value->>'id') into targets from jsonb_array_elements(c#>'{compiler_context,projected_targets}') as target_row(value);
 return jsonb_set(c,'{compiler_context,projected_targets}',targets);
end $$;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;

-- SOURCE SHA256 dc3803be0f0dda856a6e8fd1eb205324274ffbdbdbf2fe91e2476016ff420246 tests/sql/prototypes/uid_agent_rule_v3_queue.sql
-- INACTIVE PROTOTYPE: no execute grants, no production migration.
create function uid_rule_v3_private.lock_authority(p_owner uuid) returns bigint
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare revision bigint;
begin
 perform uid_rule_private.assert_review_owner(p_owner);
 -- Policy writers acquire RowExclusive before the epoch trigger; take SHARE
 -- first to preserve that order and avoid epoch/policy inversion.
 lock table uid_rule_v3_private.release in share mode;
 select e.revision into revision from uid_rule_v3_private.authorization_epoch e where singleton for share;
 if revision is null then raise exception 'Rule authority epoch missing'; end if;
 return revision;
end $$;
create function uid_rule_v3_private.snapshot(p_context jsonb,p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare op text; r uid_rule_v3_private.release%rowtype; adapted jsonb; eligibility jsonb; capability jsonb; slugs jsonb;
begin
 op:=uid_rule_v3_private.operation_for(p_context#>>'{proposal,proposed_content_md}',p_context#>>'{proposal,proposed_scope}');
 if op is null then raise exception 'Normalized scoped creative rule required'; end if;
 select * into r from uid_rule_v3_private.release where singleton and enabled;
 if not found then raise exception 'Rule compiler release is not activated'; end if;
 if r.compiler_bundle_hash is distinct from uid_rule_v3_private.hex(r.source_manifest)
  or jsonb_array_length(r.source_manifest)<>9
  or exists(select 1 from jsonb_array_elements(r.source_manifest) x where jsonb_typeof(x) is distinct from 'object'
    or x is distinct from jsonb_build_object('path',x->'path','sha256',x->'sha256') or coalesce(x->>'sha256','')!~'^[0-9a-f]{64}$')
  or (select jsonb_agg(x->>'path' order by x->>'path') from jsonb_array_elements(r.source_manifest) x) is distinct from
   '["bun.lock","package.json","scripts/agent-rule-review-compiler.bundle.mjs","scripts/compile-agent-rule-review-plan.mjs","supabase/functions/_shared/agent-rule-policy.ts","supabase/functions/_shared/agent-rule-quality.ts","supabase/functions/_shared/agent-rule-review-plan.ts","supabase/functions/_shared/creative-quality.ts","supabase/functions/_shared/owner-rule-plan.ts"]'::jsonb
 then raise exception 'Invalid released compiler manifest'; end if;
 select jsonb_agg(t->>'brand_slug' order by t->>'brand_slug') into slugs from jsonb_array_elements(p_context->'targets') t;
 adapted:=uid_rule_v3_private.adapt_context(p_context);
 eligibility:=public.uid_rule_eligibility(adapted,p_owner);
 if eligibility->'eligible' is distinct from 'true' then raise exception 'Rule structure/scope/compiler blocked: %',eligibility->'blockers'; end if;
 capability:=jsonb_build_object('review_mode','agent_rule_review','compiler_version',r.compiler_version,
  'compiler_bundle_hash',r.compiler_bundle_hash,'source_manifest',r.source_manifest,'release_revision',r.revision);
 return jsonb_build_object('candidate_hash',p_context->'candidate_hash','rule_context',p_context,'compiler_capability',capability,
  'rule_policy',jsonb_build_object('enabled',true,'operation',op,'canonical_sha256',encode(sha256(convert_to(p_context#>>'{proposal,proposed_content_md}','UTF8')),'hex'),
   'brand_slugs',slugs,'target_node_ids',(select jsonb_agg(t->'id' order by t->>'id') from jsonb_array_elements(p_context->'targets') t)));
end $$;
create function uid_rule_v3_private.public_request(q uid_rule_v3_private.requests) returns jsonb
language sql stable set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('proposal_id',q.proposal_id,'intent_hash',q.intent_hash,'idempotency_key',q.idempotency_key,'status',case when q.status in ('queued','leased','blocked') and q.expires_at<=statement_timestamp() then 'expired' else q.status end,'review_mode','agent_rule_review','operation',q.operation,
  'created_at',q.created_at,'expires_at',q.expires_at,'blockers',q.blockers,'outcome',q.outcome)
$$;
create function uid_rule_v3_private.preview(p_proposal uuid,p_owner uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare epoch bigint; c jsonb; s jsonb; intent jsonb;
begin
 epoch:=uid_rule_v3_private.lock_authority(p_owner);
 c:=uid_rule_v3_private.context(p_proposal,p_owner);
 s:=uid_rule_v3_private.snapshot(c,p_owner);
 intent:=uid_rule_v3_private.intent(c,p_owner,s#>>'{rule_policy,operation}');
 return jsonb_build_object('proposal_id',p_proposal,'review_request',(select uid_rule_v3_private.public_request(q) from uid_rule_v3_private.requests q where q.proposal_id=p_proposal and q.owner_user_id=p_owner order by q.created_at desc,q.id desc limit 1),'review_mode','agent_rule_review','operation',s#>'{rule_policy,operation}',
  'scope',c->'scope','proposed_content_md',c#>'{proposal,proposed_content_md}',
  'intent_hash','sha256:'||uid_rule_v3_private.hex(intent),'authorization_revision',epoch,
  'release_revision',s#>'{compiler_capability,release_revision}');
end $$;
create function uid_rule_v3_private.handoff(p_proposal uuid,p_owner uuid,p_expected_intent text,p_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare epoch bigint; c jsonb; s jsonb; intent jsonb; h text; op text; q uid_rule_v3_private.requests%rowtype;
 started timestamptz:=clock_timestamp(); previous text:=current_setting('uid.rule_v3_action',true);
begin
 epoch:=uid_rule_v3_private.lock_authority(p_owner);
 if p_key is null then raise exception 'Stable handoff idempotency key required'; end if;
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.brands in share mode;
 perform 1 from public.knowledge_proposals where id=p_proposal for update;
 if not found then raise exception 'Feedback not found'; end if;
 c:=uid_rule_v3_private.context(p_proposal,p_owner);
 op:=uid_rule_v3_private.operation_for(c#>>'{proposal,proposed_content_md}',c#>>'{proposal,proposed_scope}');
 intent:=uid_rule_v3_private.intent(c,p_owner,op); h:='sha256:'||uid_rule_v3_private.hex(intent);
 select * into q from uid_rule_v3_private.requests where owner_user_id=p_owner and operation=op and idempotency_key=p_key;
 if found then
  if q.proposal_id<>p_proposal or q.intent_hash is distinct from p_expected_intent or q.intent_hash<>h then raise exception 'Handoff idempotency conflict'; end if;
  return uid_rule_v3_private.public_request(q); -- no renewal, including terminal replay
 end if;
 if h is distinct from p_expected_intent then raise exception 'Exact current displayed intent required'; end if;
 s:=uid_rule_v3_private.snapshot(c,p_owner);
 if exists(select 1 from public.uid_review_requests where proposal_id=p_proposal and status in ('queued','leased','blocked') and expires_at>clock_timestamp())
 then raise exception 'An existing outcome-QC delegation is active; no automatic route conversion'; end if;
 perform set_config('uid.rule_v3_action','handoff',true);
 select * into q from uid_rule_v3_private.requests where proposal_id=p_proposal and status in ('queued','leased','blocked') for update;
 if found then
  if q.intent_hash=h and q.expires_at>clock_timestamp() and q.authorization_revision=epoch and q.release_revision=(s#>>'{compiler_capability,release_revision}')::bigint then
   perform set_config('uid.rule_v3_action',coalesce(previous,''),true); return uid_rule_v3_private.public_request(q); end if;
  update uid_rule_v3_private.requests set status='superseded',updated_at=clock_timestamp(),blockers='[{"code":"new_explicit_delegation"}]' where id=q.id;
 end if;
 insert into uid_rule_v3_private.requests(proposal_id,owner_user_id,operation,idempotency_key,intent_hash,intent,
  authorization_revision,release_revision,created_at,expires_at)
 values(p_proposal,p_owner,op,p_key,h,intent,epoch,
  (s#>>'{compiler_capability,release_revision}')::bigint,started,started+interval '24 hours') returning * into q;
 perform set_config('uid.rule_v3_action',coalesce(previous,''),true);
 return uid_rule_v3_private.public_request(q);
end $$;
create function uid_rule_v3_private.claim(p_owner uuid,p_claimant text default 'dot') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare epoch bigint; q uid_rule_v3_private.requests%rowtype; c jsonb; s jsonb; intent jsonb; h text; now_at timestamptz;
 seen uuid[]:='{}'; previous text:=current_setting('uid.rule_v3_action',true);
begin
 epoch:=uid_rule_v3_private.lock_authority(p_owner);
 if p_claimant is distinct from 'dot' then raise exception 'Expected dot claimant'; end if;
 lock table public.knowledge_nodes in share mode;
 lock table public.brands in share mode;
 perform set_config('uid.rule_v3_action','claim',true);
 loop
  select * into q from uid_rule_v3_private.requests where owner_user_id=p_owner and not(id=any(seen))
   and (status in ('queued','blocked') or(status='leased' and lease_expires_at<=clock_timestamp()))
   -- Fresh queued work precedes retries, including blocked work with snapshot drift.
   order by case when status='queued' then 0 else 1 end,created_at,id limit 1 for update skip locked;
  exit when not found;
  seen:=array_append(seen,q.id);
  if q.expires_at<=clock_timestamp() then
   update uid_rule_v3_private.requests set status='expired',updated_at=clock_timestamp(),blockers='[{"code":"intent_expired"}]' where id=q.id; continue;
  end if;
  if q.authorization_revision<>epoch then
   update uid_rule_v3_private.requests set status='superseded',updated_at=clock_timestamp(),blockers='[{"code":"authority_changed"}]' where id=q.id; continue;
  end if;
  -- Table locks above share the canonical finalizers' order. Do not take a
  -- proposal lock while another route could be waiting for canonical tables.
  perform 1 from public.knowledge_proposals where id=q.proposal_id for share;
  c:=uid_rule_v3_private.context(q.proposal_id,p_owner);
  intent:=uid_rule_v3_private.intent(c,p_owner,q.operation);
  if c#>>'{proposal,status}' is distinct from 'pending' or c#>>'{proposal,merged_at}' is not null
   or 'sha256:'||uid_rule_v3_private.hex(intent) is distinct from q.intent_hash then
   update uid_rule_v3_private.requests set status='superseded',updated_at=clock_timestamp(),blockers='[{"code":"intent_changed"}]' where id=q.id; continue;
  end if;
  begin s:=uid_rule_v3_private.snapshot(c,p_owner);
  exception when others then
   update uid_rule_v3_private.requests set status='blocked',updated_at=clock_timestamp(),next_attempt_at=clock_timestamp()+interval '1 hour',
    blockers=jsonb_build_array(jsonb_build_object('code','rule_snapshot_blocked','message',sqlerrm)) where id=q.id;
   continue;
  end;
  h:='sha256:'||uid_rule_v3_private.hex(s);
  if q.status='blocked' and q.next_attempt_at>clock_timestamp() and exists(select 1 from uid_rule_v3_private.attempts where request_id=q.id and snapshot_hash=h) then continue; end if;
  now_at:=clock_timestamp();
  if now_at>=q.expires_at then
   update uid_rule_v3_private.requests set status='expired',updated_at=now_at,blockers='[{"code":"intent_expired"}]' where id=q.id; continue;
  end if;
  update uid_rule_v3_private.requests set status='leased',claimant=p_claimant,lease_token=gen_random_uuid(),lease_version=lease_version+1,
   leased_at=now_at,lease_expires_at=least(now_at+interval '900 seconds',expires_at),updated_at=now_at,blockers='[]',outcome=null,next_attempt_at=null
   where id=q.id returning * into q;
  insert into uid_rule_v3_private.attempts values(q.id,q.lease_version,q.lease_token,q.claimant,s->>'candidate_hash',h,s,q.leased_at,q.lease_expires_at);
  perform set_config('uid.rule_v3_action',coalesce(previous,''),true);
  return jsonb_build_object('request_id',q.id,'proposal_id',q.proposal_id,'owner_user_id',q.owner_user_id,'intent',q.intent,
   'attempt_id',q.id::text||':'||q.lease_version,'evaluator_version','dot-agent-v3-rule-semantics',
   'lease_token',q.lease_token,'lease_version',q.lease_version,'leased_at',q.leased_at,'lease_expires_at',q.lease_expires_at,'expires_at',q.expires_at,
   'candidate_hash',s->'candidate_hash','snapshot_hash',h,'snapshot',s);
 end loop;
 perform set_config('uid.rule_v3_action',coalesce(previous,''),true); return null;
end $$;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;

-- Owner-authenticated lifecycle. Cancellation takes the same canonical/request
-- lock order as completion; whichever commits first establishes the outcome.
create function uid_rule_v3_private.get_request(p_proposal uuid,p_owner uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare q uid_rule_v3_private.requests%rowtype;
begin
 perform uid_rule_private.assert_review_owner(p_owner);
 select * into q from uid_rule_v3_private.requests where proposal_id=p_proposal and owner_user_id=p_owner order by created_at desc,id desc limit 1;
 if not found then return null; end if;
 return uid_rule_v3_private.public_request(q);
end $$;
create function uid_rule_v3_private.cancel(p_proposal uuid,p_owner uuid,p_expected_intent text,p_expected_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare q uid_rule_v3_private.requests%rowtype; previous text:=current_setting('uid.rule_v3_action',true);
begin
 perform uid_rule_private.assert_review_owner(p_owner);
 lock table public.knowledge_nodes in share row exclusive mode;
 select * into q from uid_rule_v3_private.requests where proposal_id=p_proposal and owner_user_id=p_owner order by created_at desc,id desc limit 1 for update;
 if not found then raise exception 'Delegated rule request not found'; end if;
 if q.intent_hash is distinct from p_expected_intent or q.idempotency_key is distinct from p_expected_key then raise exception 'Cancellation delegation changed'; end if;
 if q.status in ('merged','cancelled','superseded','expired') then return uid_rule_v3_private.public_request(q); end if;
 perform set_config('uid.rule_v3_action','cancel',true);
 update uid_rule_v3_private.requests set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp(),
  blockers='[{"code":"owner_cancelled"}]',outcome=jsonb_build_object('canonical_changed',false,'visual_qc_performed',false)
  where id=q.id returning * into q;
 perform set_config('uid.rule_v3_action',coalesce(previous,''),true);
 return uid_rule_v3_private.public_request(q);
end $$;
create function public.uid_rule_review_v3_preview(p_proposal_id uuid,p_owner_user_id uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select uid_rule_v3_private.preview(p_proposal_id,p_owner_user_id) $$;
create function public.uid_rule_review_v3_handoff(p_proposal_id uuid,p_owner_user_id uuid,p_expected_intent_hash text,p_idempotency_key uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select uid_rule_v3_private.handoff(p_proposal_id,p_owner_user_id,p_expected_intent_hash,p_idempotency_key) $$;
create function public.uid_rule_review_v3_get(p_proposal_id uuid,p_owner_user_id uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select uid_rule_v3_private.get_request(p_proposal_id,p_owner_user_id) $$;
create function public.uid_rule_review_v3_cancel(p_proposal_id uuid,p_owner_user_id uuid,p_expected_intent_hash text,p_expected_idempotency_key uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select uid_rule_v3_private.cancel(p_proposal_id,p_owner_user_id,p_expected_intent_hash,p_expected_idempotency_key) $$;
create function public.uid_rule_review_v3_claim(p_owner_user_id uuid,p_claimant text default 'dot') returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select uid_rule_v3_private.claim(p_owner_user_id,p_claimant) $$;
revoke all on function public.uid_rule_review_v3_preview(uuid,uuid),public.uid_rule_review_v3_handoff(uuid,uuid,text,uuid),public.uid_rule_review_v3_get(uuid,uuid),public.uid_rule_review_v3_cancel(uuid,uuid,text,uuid),public.uid_rule_review_v3_claim(uuid,text) from public,anon,authenticated,service_role;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;
-- Reciprocal coexistence fence; existing v2 intents are never converted.
-- Both handoff paths already serialize on knowledge_nodes before inserting.
create function uid_rule_v3_private.guard_v2_delegation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if new.status in ('queued','leased','blocked') and new.expires_at>clock_timestamp()
  and exists(select 1 from uid_rule_v3_private.requests where proposal_id=new.proposal_id
    and status in ('queued','leased','blocked') and expires_at>clock_timestamp())
 then raise exception 'An existing rule-only delegation is active; no automatic route conversion'; end if;
 return new;
end $$;
create trigger uid_rule_v3_v2_coexistence before insert on public.uid_review_requests
 for each row execute function uid_rule_v3_private.guard_v2_delegation();
revoke all on function uid_rule_v3_private.guard_v2_delegation() from public,anon,authenticated,service_role;
-- Read fresh sources in the same fenced lease; does not renew or claim anything.
create function public.uid_rule_review_v3_revalidate(p_request_id uuid,p_owner_user_id uuid,p_lease_token uuid,p_lease_version integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare epoch bigint; q uid_rule_v3_private.requests%rowtype; s jsonb; a uid_rule_v3_private.attempts%rowtype;
begin
 epoch:=uid_rule_v3_private.lock_authority(p_owner_user_id);
 lock table public.knowledge_nodes in share mode;
 lock table public.brands in share mode;
 select * into q from uid_rule_v3_private.requests where id=p_request_id and owner_user_id=p_owner_user_id for share;
 if not found or q.status<>'leased' or q.lease_token is distinct from p_lease_token or q.lease_version is distinct from p_lease_version
  or q.authorization_revision<>epoch or q.lease_expires_at<=clock_timestamp() or q.expires_at<=clock_timestamp()
 then raise exception 'Matching current authorized lease required'; end if;
 select * into a from uid_rule_v3_private.attempts where request_id=q.id and lease_version=q.lease_version;
 s:=uid_rule_v3_private.snapshot(uid_rule_v3_private.context(q.proposal_id,p_owner_user_id),p_owner_user_id);
 if 'sha256:'||uid_rule_v3_private.hex(s) is distinct from a.snapshot_hash then raise exception 'Review sources changed'; end if;
 return jsonb_build_object('snapshot_hash',a.snapshot_hash,'rule_context',s->'rule_context','checked_at',clock_timestamp());
end $$;
revoke all on function public.uid_rule_review_v3_revalidate(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;

-- SOURCE SHA256 1c270fc073976e5501663f60daa64b8f20085f8bdc4d7d7f0abc4bc287a76968 tests/sql/prototypes/uid_agent_rule_v3_finalize.sql
-- INACTIVE PROTOTYPE. No grants; requires disposable parity and race tests.
create function uid_rule_v3_private.review_core(p_review jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select p_review-'compiler_plan'-'compiler_receipt'
$$;
create function uid_rule_v3_private.validate_review(a uid_rule_v3_private.attempts,p_review jsonb) returns text
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb:=a.snapshot->'rule_context'; core jsonb:=uid_rule_v3_private.review_core(p_review);
 sources jsonb; src jsonb; receipt jsonb; f jsonb; t jsonb; criterion text; ids jsonb; n integer;
 read_time timestamptz; revalidated timestamptz; now_at timestamptz:=clock_timestamp();
begin
 if jsonb_typeof(p_review) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_review) k where k not in
  ('schema_version','decision','review_note','source_receipts','findings','visual_qc_performed','review_scope','compiler_plan','compiler_receipt'))
  or (select count(*) from jsonb_object_keys(core))<>7
  or core->>'schema_version' is distinct from 'uid.agent-rule-review.v1' or core->>'decision' is distinct from 'passed'
  or core->'visual_qc_performed' is distinct from 'false'
  or core->>'review_scope' is distinct from 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'
  or jsonb_typeof(core->'review_note') is distinct from 'string' or length(btrim(core->>'review_note')) not between 40 and 4000
  or jsonb_typeof(core->'source_receipts') is distinct from 'array' or jsonb_typeof(core->'findings') is distinct from 'array'
 then raise exception 'Exact genuine rule-only semantic review required'; end if;
 sources:=jsonb_build_array(jsonb_build_object('id','rule-context','record',c))||(c->'targets')||(c#>'{compiler_context,brand_dna_nodes}')||(c#>'{compiler_context,dependent_nodes}');
 if exists(select 1 from jsonb_array_elements(sources) s where jsonb_typeof(s->'id') is distinct from 'string')
  or exists(select 1 from jsonb_array_elements(sources) s group by s->>'id' having count(distinct s)>1)
 then raise exception 'Source identity collision'; end if;
 select jsonb_agg(s order by s->>'id') into sources from (select distinct value s from jsonb_array_elements(sources)) x;
 select jsonb_agg(s->'id' order by s->>'id') into ids from jsonb_array_elements(sources) s;
 if jsonb_array_length(sources)>128 or jsonb_array_length(core->'source_receipts')<>jsonb_array_length(sources) then raise exception 'Complete source coverage required'; end if;
 for src in select value from jsonb_array_elements(sources) loop
  select count(*) into n from jsonb_array_elements(core->'source_receipts') x where x->>'node_id'=src->>'id';
  select value into receipt from jsonb_array_elements(core->'source_receipts') x where x->>'node_id'=src->>'id' limit 1;
  if n<>1 or receipt is distinct from jsonb_build_object('node_id',src->'id','record_sha256',uid_rule_v3_private.hex(src),
     'read_at',receipt->'read_at','revalidated_at',receipt->'revalidated_at','note',receipt->'note')
   or jsonb_typeof(receipt->'note') is distinct from 'string' or length(btrim(receipt->>'note')) not between 40 and 4000
  then raise exception 'Exact source receipt hash/schema required'; end if;
  read_time:=(receipt->>'read_at')::timestamptz; revalidated:=(receipt->>'revalidated_at')::timestamptz;
  if read_time is null or revalidated is null or not isfinite(read_time) or not isfinite(revalidated)
   or read_time<a.leased_at or revalidated<read_time or revalidated>now_at or revalidated>=a.lease_expires_at
  then raise exception 'Source receipt is outside current fenced lease'; end if;
 end loop;
 if jsonb_array_length(core->'findings')<>jsonb_array_length(c->'targets')*3 then raise exception 'Complete target criterion coverage required'; end if;
 for t in select value from jsonb_array_elements(c->'targets') loop
  foreach criterion in array array['rule_semantics','scope_fidelity','canonical_conflicts'] loop
   select count(*) into n from jsonb_array_elements(core->'findings') x where x->>'node_id'=t->>'id' and x->>'criterion'=criterion;
   select value into f from jsonb_array_elements(core->'findings') x where x->>'node_id'=t->>'id' and x->>'criterion'=criterion limit 1;
   if n<>1 or f is distinct from jsonb_build_object('node_id',t->'id','criterion',criterion,'result','passed','note',f->'note','source_node_ids',ids)
    or jsonb_typeof(f->'note') is distinct from 'string' or length(btrim(f->>'note')) not between 40 and 4000
   then raise exception 'Genuine source-linked passed criterion required'; end if;
  end loop;
 end loop;
 return uid_rule_v3_private.hex(core);
end $$;
create function uid_rule_v3_private.catalog(a uid_rule_v3_private.attempts,p_review_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb:=a.snapshot->'rule_context'; catalog jsonb; contracts jsonb; t jsonb; projected jsonb; dna jsonb; bundle jsonb;
 supplement jsonb; hashes jsonb; canonical text:=c#>>'{proposal,proposed_content_md}'; spec jsonb; attempt_id text:=a.request_id::text||':'||a.lease_version;
begin
 perform public.uid_rule_catalog_plan(uid_rule_v3_private.adapt_context(c));
 select target_row.value#>'{metadata,creative_quality_contract}' into catalog from jsonb_array_elements(c->'targets') as target_row(value) order by target_row.value->>'id' limit 1;
 if catalog is null then return null; end if;
 contracts:=catalog->'contracts'; spec:=public.uid_rule_parse_canonical(canonical);
 for t in select value from jsonb_array_elements(c->'targets') order by value->>'id' loop
  bundle:=contracts->(t->>'brand_slug');
  select value into projected from jsonb_array_elements(c#>'{compiler_context,projected_targets}') n where n->>'id'=t->>'id';
  select value into dna from jsonb_array_elements(c#>'{compiler_context,brand_dna_nodes}') n where n->>'brand_id'=t->>'brand_id';
  hashes:=jsonb_build_object('branch',public.uid_rule_source_hash(projected),'brand_dna',public.uid_rule_source_hash(dna));
  supplement:=jsonb_build_object('schema_version','uid.agent-rule-reviewed-supplemental-rule.v1','id','agent-rule:'||attempt_id,
   'proposal_id',c#>'{proposal,id}','request_id',a.request_id,'attempt_id',attempt_id,
   'decision_kind','agent_rule_review','evaluator_version','dot-agent-v3-rule-semantics',
   'snapshot_hash',a.snapshot_hash,'review_hash',p_review_hash,'review_scope','RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC','visual_qc_performed',false,
   'canonical_text',canonical,'declared_scope',spec->'scope','scope',jsonb_build_object('brands',(select jsonb_agg(n->>'brand_slug' order by n->>'brand_slug') from jsonb_array_elements(c->'targets') n),'branches',jsonb_build_array(c#>>'{scope,branch_slug}')),
   'rule_class',spec->'rule_class','confidence',spec->'confidence',
   'source',jsonb_build_object('node','branch','locator','agent-rule:'||(c#>>'{proposal,id}')||':'||attempt_id,'canonical_text_hash',encode(sha256(convert_to(canonical,'UTF8')),'hex')),
   'accepted_source_hashes',hashes,'precedence','SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH');
  bundle:=bundle||jsonb_build_object('schema_version','uid-creative-quality/4','revision','agent-rule:'||attempt_id,'source_hashes',hashes,
   'agent_rule_reviewed_supplemental_rules',coalesce(bundle->'agent_rule_reviewed_supplemental_rules','[]')||jsonb_build_array(supplement));
  if length(public.uid_rule_stable_json(bundle))>100000 then raise exception 'Quality catalog capacity exceeded'; end if;
  contracts:=jsonb_set(contracts,array[t->>'brand_slug'],bundle);
 end loop;
 return catalog||jsonb_build_object('contracts',contracts);
end $$;
create function uid_rule_v3_private.validate_plan(a uid_rule_v3_private.attempts,p_review jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c jsonb:=a.snapshot->'rule_context'; cap jsonb:=a.snapshot->'compiler_capability';
 review_hash text; catalog jsonb; targets jsonb; expected jsonb; proof jsonb:=p_review->'compiler_receipt';
 t jsonb; entry jsonb; n integer; identity jsonb; attempt_id text:=a.request_id::text||':'||a.lease_version;
begin
 review_hash:=uid_rule_v3_private.validate_review(a,p_review); catalog:=uid_rule_v3_private.catalog(a,review_hash);
 select jsonb_agg(jsonb_build_object('node_id',target_value->'id','content_md',target_value->'content_md',
  'metadata',case when catalog is null then target_value->'metadata' else jsonb_set(target_value->'metadata','{creative_quality_contract}',catalog) end,
  'version',target_value->'version','input_schema',target_value->'input_schema','status',target_value->'status','confidence',target_value->'confidence') order by target_value->>'id') into targets
 from jsonb_array_elements(c#>'{compiler_context,projected_targets}') target_value;
 identity:=jsonb_build_object('request_id',a.request_id,'attempt_id',attempt_id,'proposal_id',c#>'{proposal,id}',
  'candidate_hash',a.candidate_hash,'snapshot_hash',a.snapshot_hash,'review_hash',review_hash);
 expected:=identity||jsonb_build_object('schema_version','uid.agent-rule-review-plan.v1','targets',targets);
 if p_review->'compiler_plan' is distinct from expected then raise exception 'Compiler plan differs from exact SQL reconstructed delta'; end if;
 if jsonb_typeof(proof->'compiled') is distinct from 'array' or jsonb_array_length(proof->'compiled')<>jsonb_array_length(c->'targets')
 then raise exception 'Complete pinned compiler receipt required'; end if;
 for t in select value from jsonb_array_elements(c->'targets') loop
  select count(*) into n from jsonb_array_elements(proof->'compiled') x where x->>'node_id'=t->>'id';
  select value into entry from jsonb_array_elements(proof->'compiled') x where x->>'node_id'=t->>'id' limit 1;
  if n<>1 then raise exception 'Compiler target identity mismatch'; end if;
  if catalog is null then
   if entry is distinct from jsonb_build_object('mode','canonical_append','node_id',t->'id','brand_slug',t->'brand_slug',
    'projection_hash',(select uid_rule_v3_private.hex(x) from jsonb_array_elements(targets) x where x->>'node_id'=t->>'id'))
   then raise exception 'Compiler append projection mismatch'; end if;
  elsif coalesce(entry->>'contract_hash','')!~'^[0-9a-f]{64}$' or entry is distinct from jsonb_build_object(
   'mode','quality_catalog','node_id',t->'id','brand_slug',t->'brand_slug','source_hashes',catalog#>array['contracts',t->>'brand_slug','source_hashes'],
   'contract_hash',entry->'contract_hash','added_supplement_ids',jsonb_build_array('agent-rule:'||attempt_id))
  then raise exception 'Compiler target identity/hash mismatch'; end if;
 end loop;
 if proof is distinct from identity||jsonb_build_object('schema_version','uid.agent-rule-review-compiler-receipt.v1','status','COMPILED',
  'proof_scope','DETERMINISTIC_COMPILATION_ONLY','compiler_version',cap->'compiler_version','compiler_bundle_hash',cap->'compiler_bundle_hash',
  'plan_hash',uid_rule_v3_private.hex(expected),'compiled',proof->'compiled') then raise exception 'Compiler receipt identity mismatch'; end if;
 return catalog;
end $$;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;
create function uid_rule_v3_private.complete(p_request uuid,p_owner uuid,p_claimant text,p_token uuid,p_version integer,p_candidate text,p_review jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare epoch bigint; q uid_rule_v3_private.requests%rowtype; a uid_rule_v3_private.attempts%rowtype;
 c jsonb; s jsonb; current_intent jsonb; catalog jsonb; before_nodes jsonb; after_nodes jsonb; outside_nodes jsonb;
 v_blockers jsonb:='[]'; next_status text:='blocked'; merge_result jsonb; core jsonb;
 previous text:=current_setting('uid.rule_v3_action',true);
begin
 epoch:=uid_rule_v3_private.lock_authority(p_owner);
 lock table public.knowledge_nodes in share row exclusive mode;
 lock table public.brands in share mode;
 select * into q from uid_rule_v3_private.requests where id=p_request and owner_user_id=p_owner for update;
 if not found then raise exception 'Delegated rule request not found'; end if;
 select * into a from uid_rule_v3_private.attempts where request_id=q.id and lease_version=p_version;
 if not found or a.lease_token is distinct from p_token or a.claimant is distinct from p_claimant or a.candidate_hash is distinct from p_candidate
 then raise exception 'Exact fenced attempt identity required'; end if;
 if exists(select 1 from uid_rule_v3_private.audit where request_id=q.id and lease_version=p_version) then return uid_rule_v3_private.public_request(q); end if;
 if q.status<>'leased' or q.lease_token is distinct from p_token or q.lease_version is distinct from p_version or q.claimant is distinct from p_claimant
 then raise exception 'Matching live fenced lease required'; end if;
 if q.lease_expires_at<=clock_timestamp() then raise exception 'Lease expired; claim and review fresh snapshot'; end if;
 perform 1 from public.knowledge_proposals where id=q.proposal_id for update;
 select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') into before_nodes from public.knowledge_nodes n
 where exists(select 1 from jsonb_array_elements(a.snapshot#>'{rule_context,targets}') t where t->>'id'=n.id::text);
 if q.expires_at<=clock_timestamp() then
  next_status:='expired'; v_blockers:='[{"code":"intent_expired"}]';
 elsif q.authorization_revision<>epoch then
  next_status:='superseded'; v_blockers:='[{"code":"authority_changed"}]';
 else
  c:=uid_rule_v3_private.context(q.proposal_id,p_owner);
  current_intent:=uid_rule_v3_private.intent(c,p_owner,q.operation);
  if c#>>'{proposal,status}' is distinct from 'pending' or c#>>'{proposal,merged_at}' is not null
   or 'sha256:'||uid_rule_v3_private.hex(current_intent) is distinct from q.intent_hash then
   next_status:='superseded'; v_blockers:='[{"code":"intent_changed_or_resolved"}]';
  else
   begin
    s:=uid_rule_v3_private.snapshot(c,p_owner);
    if (s#>>'{compiler_capability,release_revision}')::bigint<>q.release_revision
    then raise exception 'Pinned release changed'; end if;
    if 'sha256:'||uid_rule_v3_private.hex(s) is distinct from a.snapshot_hash or s->>'candidate_hash' is distinct from a.candidate_hash then
     next_status:='queued'; v_blockers:='[{"code":"snapshot_changed","next_action":"Inspect a fresh claim; old receipts cannot be reused."}]';
    elsif p_review->>'decision'='blocked' then
     core:=uid_rule_v3_private.review_core(p_review);
     if jsonb_typeof(core) is distinct from 'object' or core->>'schema_version' is distinct from 'uid.agent-rule-review.v1'
      or core->'visual_qc_performed' is distinct from 'false' or core->>'review_scope' is distinct from 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'
      or jsonb_typeof(core->'source_receipts') is distinct from 'array' or jsonb_typeof(core->'findings') is distinct from 'array'
      or jsonb_typeof(core->'review_note') is distinct from 'string' or length(btrim(core->>'review_note')) not between 40 and 4000
      or p_review ? 'compiler_plan' or p_review ? 'compiler_receipt' then raise exception 'Scoped blocked review and specific explanation required'; end if;
     v_blockers:=jsonb_build_array(jsonb_build_object('code','semantic_review_blocked','message',core->>'review_note'));
    else
     catalog:=uid_rule_v3_private.validate_plan(a,p_review); next_status:='merged';
    end if;
   exception when others then
    next_status:='blocked'; v_blockers:=jsonb_build_array(jsonb_build_object('code','rule_review_validation_blocked','message',sqlerrm));
   end;
  end if;
 end if;
 perform set_config('uid.rule_v3_action','complete',true);
 if next_status='merged' then
  if q.lease_expires_at<=clock_timestamp() or q.expires_at<=clock_timestamp() then raise exception 'Lease or intent expired before canonical write'; end if;
  if exists(select 1 from public.knowledge_nodes child where child.status='active'
   and exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=child.parent_id::text)
   and not exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=child.id::text))
  then raise exception 'Unsupported active dependency outside scope'; end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') into outside_nodes from public.knowledge_nodes n
   where not exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=n.id::text);
  merge_result:=public.admin_accept_merge_creative_dna_proposal(q.proposal_id,p_owner,
   'Agent rule review under explicit owner delegation. Rule semantics and compilation only; no output/media QC or owner-direct review is asserted. '||left(p_review->>'review_note',3000));
  perform uid_rule_private.apply_projected_catalog(c,catalog);
  if outside_nodes is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') from public.knowledge_nodes n
   where not exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=n.id::text))
  then raise exception 'Outside-scope canonical mutation; transaction rolled back'; end if;
  if not exists(select 1 from public.knowledge_proposals where id=q.proposal_id and status='merged' and reviewed_by=p_owner and merged_at is not null)
  then raise exception 'Expected scoped merge outcome missing'; end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') into after_nodes from public.knowledge_nodes n
   where exists(select 1 from jsonb_array_elements(c->'targets') t where t->>'id'=n.id::text);
 end if;
 insert into uid_rule_v3_private.audit(request_id,lease_version,proposal_id,owner_user_id,result,review,compiler_plan,compiler_receipt,before_snapshot,after_snapshot,blockers)
 values(q.id,a.lease_version,q.proposal_id,p_owner,case when next_status='queued' then 'blocked' else next_status end,
  coalesce(p_review,'null'::jsonb),case when next_status='merged' then p_review->'compiler_plan' end,
  case when next_status='merged' then p_review->'compiler_receipt' end,before_nodes,after_nodes,v_blockers);
 update uid_rule_v3_private.requests set status=next_status,updated_at=clock_timestamp(),blockers=v_blockers,
  next_attempt_at=case when next_status='blocked' then clock_timestamp()+interval '1 hour' end,
  outcome=jsonb_build_object('canonical_changed',next_status='merged','visual_qc_performed',false,
   'review_scope','RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC',
   'merged_nodes',case when next_status='merged' then merge_result->'merged_nodes' else '0'::jsonb end)
 where id=q.id returning * into q;
 perform set_config('uid.rule_v3_action',coalesce(previous,''),true);
 return uid_rule_v3_private.public_request(q);
end $$;
revoke all on all functions in schema uid_rule_v3_private from public,anon,authenticated,service_role;
create function public.uid_rule_review_v3_complete(p_request_id uuid,p_owner_user_id uuid,p_claimant text,p_lease_token uuid,p_lease_version integer,p_candidate_hash text,p_review jsonb) returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$
 select uid_rule_v3_private.complete(p_request_id,p_owner_user_id,p_claimant,p_lease_token,p_lease_version,p_candidate_hash,p_review)
$$;
revoke all on function public.uid_rule_review_v3_complete(uuid,uuid,text,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;

-- Private implementation remains inaccessible even if installation defaults change.
REVOKE ALL ON SCHEMA uid_rule_v3_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA uid_rule_v3_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA uid_rule_v3_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA uid_rule_v3_private FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
