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
   order by created_at,id limit 1 for update skip locked;
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
