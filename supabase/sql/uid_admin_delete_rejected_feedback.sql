-- Applied to Supabase on 2026-11-12 as uid_admin_rejected_soft_archive_preserve_immutable_audit.
-- Audit/event/queue tables contain immutable review history and must NOT be deleted.
-- "Delete all" hides rejected proposals from the active admin inbox (soft archive).
-- Only the authenticated active Admin Edge Function can call this service-role RPC.
alter table public.knowledge_proposals add column if not exists rejected_archived_at timestamptz;
create index if not exists knowledge_proposals_rejected_active_idx
  on public.knowledge_proposals(status,created_at desc) where rejected_archived_at is null;
create or replace function public.uid_admin_delete_rejected_feedback(p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare eligible integer:=0; affected integer:=0;
begin
 select count(*) into eligible from public.knowledge_proposals
 where status='rejected' and rejected_archived_at is null;
 if not p_confirm then
  return jsonb_build_object('status','rejected','eligible_count',eligible,'dry_run',true);
 end if;
 update public.knowledge_proposals set rejected_archived_at=now(),updated_at=now()
 where status='rejected' and rejected_archived_at is null;
 get diagnostics affected=row_count;
 return jsonb_build_object('status','rejected','deleted_count',affected,
   'archive_only',true,'audit_preserved',true);
end $$;
revoke all on function public.uid_admin_delete_rejected_feedback(boolean) from public,anon,authenticated;
grant execute on function public.uid_admin_delete_rejected_feedback(boolean) to service_role;
