-- Performance only: reuse one snapshot; no validation, owner lock, ACL,
-- compiler, source hash, trigger closure or acceptance-path changes.
create or replace function uid_rule_private.review_preflight_snapshot(p_proposal_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare context jsonb; request_view jsonb; intent_hash text;
begin
 context:=public.uid_rule_context(p_proposal_id);
 if context is not null then context:=jsonb_set(context,'{compiler_context,owner_user_id}',to_jsonb(p_actor_user_id)); end if;
 if context is null then return null; end if;
 -- Reuse the exact STABLE snapshot above rather than rebuilding the entire
 -- governance/compiler context twice inside uid_review_intent. Keep every v2
 -- intent field, JSON null and target ordering unchanged.
 intent_hash:=public.uid_review_digest(jsonb_build_object(
  'schema_version','uid.review-intent.v2','owner_user_id',p_actor_user_id,
  'proposal_id',context#>'{proposal,id}','source_node_id',context#>'{proposal,knowledge_node_id}',
  'proposed_content_md',context#>'{proposal,proposed_content_md}',
  'raw_feedback',context#>'{proposal,raw_feedback}','proposed_version',context#>'{proposal,proposed_version}',
  'change_summary',context#>'{proposal,change_summary}','proposed_scope',context#>'{proposal,proposed_scope}',
  'brand_id',context#>'{proposal,brand_id}','scope',context->'scope',
  'targets',coalesce((select jsonb_agg(jsonb_build_object('id',t->'id','brand_id',t->'brand_id','slug',t->'slug') order by t->>'id')
   from jsonb_array_elements(context->'targets') t),'[]')));
 select public.uid_review_public(q)||case when q.status in ('queued','leased','blocked') and q.expires_at<=statement_timestamp()
   then jsonb_build_object('status','expired') else '{}'::jsonb end into request_view
 from public.uid_review_requests q where q.owner_user_id=p_actor_user_id and q.proposal_id=p_proposal_id
 order by q.created_at desc,q.id desc limit 1;
 return context||jsonb_build_object('direct_rule',public.uid_rule_eligibility(context,p_actor_user_id),
  'direct_rule_receipt',(select d.result from uid_rule_private.decisions d join uid_rule_private.owner_config cfg
   on cfg.singleton and cfg.enabled and cfg.owner_user_id=p_actor_user_id where d.proposal_id=p_proposal_id and d.owner_user_id=p_actor_user_id),
  'review_intent_hash',intent_hash,'review_request',request_view);
end $$;
