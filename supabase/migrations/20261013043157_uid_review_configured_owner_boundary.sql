-- Queue approvals use the SAME deny-by-default verified owner configuration as
-- direct rule decisions. No owner identity, extra config, or client grant added.
-- This migration follows both queue foundations and owner-direct foundations.
create function uid_rule_private.assert_review_owner(p_actor_user_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Match direct acceptance's lock order. Revocation is serialized before any
 -- queue row, canonical row or lease can be used for this transaction.
 perform 1 from public.creative_dna_team_members
 where user_id=p_actor_user_id and role='admin' and is_active=true for share;
 if not found then raise exception 'Active admin required'; end if;
 perform 1 from uid_rule_private.owner_config
 where singleton and enabled and owner_user_id=p_actor_user_id for share;
 if not found then raise exception using errcode='42501',message='Enabled verified configured owner required'; end if;
end $$;
revoke all on function uid_rule_private.assert_review_owner(uuid) from public,anon,authenticated,service_role;

-- All existing mutating/status RPCs already enter through this private helper:
-- enqueue, get, cancel, claim and complete (including idempotent completion).
create or replace function public.uid_review_assert_admin(p_actor uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform uid_rule_private.assert_review_owner(p_actor);
end $$;
revoke all on function public.uid_review_assert_admin(uuid) from public,anon,authenticated,service_role;

-- A lock-taking public wrapper cannot be STABLE. Keep context+intent+request
-- construction in a single private STABLE reader after owner locks are held.
-- That preserves the displayed approval identity's single-snapshot guarantee.
create function uid_rule_private.review_preflight_snapshot(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare context jsonb; request_view jsonb; intent_hash text;
begin
 context:=public.uid_rule_context(p_proposal_id);
 if context is not null then context:=jsonb_set(context,'{compiler_context,owner_user_id}',to_jsonb(p_actor_user_id)); end if;
 if context is null then return null; end if;
 intent_hash:=public.uid_review_digest(public.uid_review_intent(p_proposal_id,p_actor_user_id));
 select public.uid_review_public(q)||case when q.status in ('queued','leased','blocked') and q.expires_at<=statement_timestamp()
   then jsonb_build_object('status','expired') else '{}'::jsonb end into request_view
 from public.uid_review_requests q where q.owner_user_id=p_actor_user_id and q.proposal_id=p_proposal_id
 order by q.created_at desc,q.id desc limit 1;
 return context||jsonb_build_object('direct_rule',public.uid_rule_eligibility(context,p_actor_user_id),
  'direct_rule_receipt',(select d.result from uid_rule_private.decisions d join uid_rule_private.owner_config cfg
   on cfg.singleton and cfg.enabled and cfg.owner_user_id=p_actor_user_id where d.proposal_id=p_proposal_id and d.owner_user_id=p_actor_user_id),
  'review_intent_hash',intent_hash,'review_request',request_view);
end $$;
revoke all on function uid_rule_private.review_preflight_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.uid_review_intent_hash(p_proposal_id uuid,p_actor_user_id uuid) returns text
language plpgsql volatile security definer set search_path=public,pg_temp as $$
begin
 perform uid_rule_private.assert_review_owner(p_actor_user_id);
 return public.uid_review_digest(public.uid_review_intent(p_proposal_id,p_actor_user_id));
end $$;
create or replace function public.uid_review_preflight(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
begin
 perform uid_rule_private.assert_review_owner(p_actor_user_id);
 return uid_rule_private.review_preflight_snapshot(p_proposal_id,p_actor_user_id);
end $$;
revoke all on function public.uid_review_intent_hash(uuid,uuid),public.uid_review_preflight(uuid,uuid) from public,anon,authenticated;
grant execute on function public.uid_review_intent_hash(uuid,uuid),public.uid_review_preflight(uuid,uuid) to service_role;

-- Approve the exact same trigger closure displayed by combined preflight,
-- including inactive mirrors. Canonical/media contents remain QC state, not a
-- new user intent; adding/removing an affected node or changing its brand/slug
-- invalidates the existing approval and requires a fresh owner decision.
create or replace function public.uid_review_intent(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('schema_version','uid.review-intent.v2','owner_user_id',p_actor_user_id,
  'proposal_id',p.id,'source_node_id',p.knowledge_node_id,'proposed_content_md',p.proposed_content_md,
  'raw_feedback',p.raw_feedback,'proposed_version',p.proposed_version,'change_summary',p.change_summary,
  'proposed_scope',p.proposed_scope,'brand_id',p.brand_id,'scope',c.context->'scope',
  'targets',coalesce((select jsonb_agg(jsonb_build_object('id',t->'id','brand_id',t->'brand_id','slug',t->'slug') order by t->>'id')
    from jsonb_array_elements(c.context->'targets') t),'[]'))
 from public.knowledge_proposals p cross join lateral (select public.uid_rule_context(p.id) context)c
 where p.id=p_proposal_id
$$;
revoke all on function public.uid_review_intent(uuid,uuid) from public,anon,authenticated,service_role;
