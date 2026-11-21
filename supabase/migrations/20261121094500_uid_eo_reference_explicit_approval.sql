-- Explicit admin action only. Invoker security keeps existing RLS active.
create or replace function public.uid_eo_approve_reference(
  p_reference_id uuid,
  p_expected_version integer,
  p_quality_notes jsonb,
  p_inspection jsonb,
  p_justification text
) returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.creative_dna_team_members m
    where m.user_id=auth.uid() and m.is_active and m.role='admin'
  ) then raise exception 'UID_ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_expected_version < 1 or p_justification is null or length(trim(p_justification)) < 12
    or coalesce(p_inspection->>'desktop','') <> 'true'
    or coalesce(p_inspection->>'mobile','') <> 'true'
    or jsonb_typeof(p_quality_notes) <> 'object'
  then raise exception 'INCOMPLETE_EO_INSPECTION_EVIDENCE' using errcode='22023'; end if;
  update public.uid_eo_onepage_references
  set status='approved',
      quality_notes=p_quality_notes || jsonb_build_object('approval_basis',p_justification),
      inspection=p_inspection,
      approved_by=auth.uid(),approved_at=now(),
      version=version+1,updated_at=now()
  where id=p_reference_id and version=p_expected_version and status in ('discovered','pending','rejected')
  returning id into v_id;
  if v_id is null then raise exception 'REFERENCE_NOT_FOUND_OR_VERSION_CONFLICT' using errcode='P0002'; end if;
  insert into public.uid_eo_reference_approvals(reference_id,actor_user_id,action,reviewed_version,justification)
  values(v_id,auth.uid(),'approved',p_expected_version+1,p_justification);
  return v_id;
end;
$$;
revoke all on function public.uid_eo_approve_reference(uuid,integer,jsonb,jsonb,text) from public, anon;
grant execute on function public.uid_eo_approve_reference(uuid,integer,jsonb,jsonb,text) to authenticated;
comment on function public.uid_eo_approve_reference(uuid,integer,jsonb,jsonb,text) is
  'Atomic verified admin EO reference approval + versioned audit; never invoked automatically by store scan.';
