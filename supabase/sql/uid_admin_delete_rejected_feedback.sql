-- Already applied on Supabase as uid_admin_rejected_feedback_atomic_cleanup_20261112.
-- Safe to re-run: CREATE OR REPLACE plus restricted grants only.
-- An authenticated, active UID Admin is checked by creative-dna-admin-feedback
-- BEFORE invoking this restricted service-role RPC. The SQL procedure is atomic.
create or replace function public.uid_admin_delete_rejected_feedback(p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare ids uuid[]; deleted_count integer := 0;
begin
  select coalesce(array_agg(id),array[]::uuid[]) into ids
  from (select id from public.knowledge_proposals where status = 'rejected' for update) locked;
  if not p_confirm then
    return jsonb_build_object('status','rejected','eligible_count',cardinality(ids),'dry_run',true);
  end if;
  if cardinality(ids) = 0 then
    return jsonb_build_object('status','rejected','deleted_count',0);
  end if;
  delete from public.uid_agent_review_evaluations
    where proposal_id = any(ids) or request_id in (select id from public.uid_review_requests where proposal_id=any(ids));
  delete from public.uid_review_attempts where request_id in (select id from public.uid_review_requests where proposal_id=any(ids));
  delete from public.uid_review_events where request_id in (select id from public.uid_review_requests where proposal_id=any(ids));
  delete from uid_rule_v3_private.audit where proposal_id=any(ids);
  delete from uid_rule_v3_private.events where request_id in (select id from uid_rule_v3_private.requests where proposal_id=any(ids));
  delete from uid_rule_v3_private.attempts where request_id in (select id from uid_rule_v3_private.requests where proposal_id=any(ids));
  delete from public.uid_review_requests where proposal_id=any(ids);
  delete from uid_rule_v3_private.requests where proposal_id=any(ids);
  delete from uid_rule_private.recovery_requests where proposal_id=any(ids);
  delete from uid_rule_private.recovery_fences where proposal_id=any(ids);
  delete from uid_rule_private.decisions where proposal_id=any(ids);
  delete from public.uid_governance_evaluations where proposal_id=any(ids);
  delete from public.uid_governance_snapshots where proposal_id=any(ids);
  delete from public.knowledge_proposals where id=any(ids) and status='rejected';
  get diagnostics deleted_count = row_count;
  if deleted_count <> cardinality(ids) then
    raise exception 'Rejected feedback set changed during atomic cleanup';
  end if;
  return jsonb_build_object('status','rejected','deleted_count',deleted_count);
end;
$$;
revoke all on function public.uid_admin_delete_rejected_feedback(boolean) from public, anon, authenticated;
grant execute on function public.uid_admin_delete_rejected_feedback(boolean) to service_role;
