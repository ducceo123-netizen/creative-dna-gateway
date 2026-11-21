-- EO quality reference library, shared by authenticated UID Brands members.
-- Discovered public Onepages are NOT approved; approval is explicit and attributable.
create table if not exists public.uid_eo_onepage_references (
  id uuid primary key default gen_random_uuid(),
  brand_slug text not null check (brand_slug in ('pawfecthouse','giftsoul','soulprise')),
  page_url text not null check (page_url ~ '^https://[^[:space:]]+$'),
  product_type text not null default '',
  match_terms jsonb not null default '{}'::jsonb check (jsonb_typeof(match_terms) = 'object'),
  image_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(image_urls) = 'array'),
  quality_notes jsonb not null default '{}'::jsonb check (jsonb_typeof(quality_notes) = 'object'),
  inspection jsonb not null default '{}'::jsonb check (jsonb_typeof(inspection) = 'object'),
  status text not null default 'discovered' check (status in ('discovered','pending','approved','rejected')),
  submitted_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  version integer not null default 1 check (version >= 1),
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uid_eo_approved_evidence check (
    status <> 'approved' or
    (approved_by is not null and approved_at is not null
       and coalesce(length(trim(quality_notes->>'approval_basis')),0) >= 12
       and inspection->>'desktop' = 'true' and inspection->>'mobile' = 'true')
  ),
  unique (brand_slug,page_url)
);
create index if not exists uid_eo_refs_brand_status_type on public.uid_eo_onepage_references(brand_slug,status,product_type);
create table if not exists public.uid_eo_reference_approvals (
  id bigint generated always as identity primary key,
  reference_id uuid not null references public.uid_eo_onepage_references(id) on delete restrict,
  actor_user_id uuid not null,
  action text not null check (action in ('approved','rejected','revoked')),
  reviewed_version integer not null,
  justification text not null check (length(trim(justification)) >= 12),
  created_at timestamptz not null default now()
);
create index if not exists uid_eo_approval_reference_idx on public.uid_eo_reference_approvals(reference_id,created_at desc);
alter table public.uid_eo_onepage_references enable row level security;
alter table public.uid_eo_reference_approvals enable row level security;
revoke all on public.uid_eo_onepage_references from anon, authenticated;
revoke all on public.uid_eo_reference_approvals from anon, authenticated;
grant select,insert,update on public.uid_eo_onepage_references to authenticated;
grant select,insert on public.uid_eo_reference_approvals to authenticated;
grant usage,select on sequence public.uid_eo_reference_approvals_id_seq to authenticated;
create policy "active_uid_member_reference_read" on public.uid_eo_onepage_references
  for select to authenticated using (
  exists (select 1 from public.creative_dna_team_members m
    where m.user_id = (select auth.uid()) and m.is_active)
  );
create policy "active_uid_member_submit_discovered" on public.uid_eo_onepage_references
  for insert to authenticated with check (
  status in ('discovered','pending') and approved_by is null and approved_at is null
  and submitted_by = (select auth.uid())
  and exists (select 1 from public.creative_dna_team_members m
    where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','contributor'))
  );
create policy "uid_admin_reference_update" on public.uid_eo_onepage_references
  for update to authenticated using (
    exists (select 1 from public.creative_dna_team_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin')
  ) with check (
    exists (select 1 from public.creative_dna_team_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin')
    and (status <> 'approved' or approved_by = (select auth.uid()))
  );
create policy "uid_member_reference_approvals_read" on public.uid_eo_reference_approvals
  for select to authenticated using (
    exists (select 1 from public.creative_dna_team_members m where m.user_id=(select auth.uid()) and m.is_active)
  );
create policy "uid_admin_reference_approval_audit" on public.uid_eo_reference_approvals
  for insert to authenticated with check (
    actor_user_id=(select auth.uid()) and exists (select 1 from public.creative_dna_team_members m
    where m.user_id=(select auth.uid()) and m.is_active and m.role='admin')
  );
comment on table public.uid_eo_onepage_references is 'Private same-brand EO Onepage quality references; public live pages are unapproved until a verified admin signs off.';
comment on table public.uid_eo_reference_approvals is 'Append-only admin EO reference approval history, separate from task-level feedback and Studio.';
