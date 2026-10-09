-- Governance foundation. Additive only; no current canonical nodes are mutated.
create table if not exists public.uid_governance_baselines (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid references public.brands(id),
 branch_slug text not null,
 case_key text not null,
 source_brief jsonb not null,
 expected_assertions jsonb not null default '{}'::jsonb,
 approved_output jsonb not null,
 approved_by uuid,
 approved_at timestamptz,
 created_at timestamptz not null default now(),
 unique(brand_id,branch_slug,case_key)
);
create table if not exists public.uid_governance_evaluations (
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid not null references public.knowledge_proposals(id),
 candidate_hash text not null,
 baseline_ids uuid[] not null default '{}',
 test_results jsonb not null default '[]',
 conflict_results jsonb not null default '[]',
 evaluation_status text not null default 'blocked'
   check(evaluation_status in ('blocked','failed','passed')),
 critical_failures integer not null default 0 check(critical_failures>=0),
 evaluator_version text not null,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(proposal_id,candidate_hash)
);
create table if not exists public.uid_governance_snapshots (
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid references public.knowledge_proposals(id),
 node_id uuid not null references public.knowledge_nodes(id),
 checkpoint text not null check(checkpoint in ('before','after','rollback')),
 content_md text not null,
 metadata jsonb not null,
 node_version text not null,
 actor_id uuid,
 created_at timestamptz not null default now()
);
create index if not exists idx_governance_eval_proposal on public.uid_governance_evaluations(proposal_id,created_at desc);
create index if not exists idx_governance_snapshots_node on public.uid_governance_snapshots(node_id,created_at desc);
alter table public.uid_governance_baselines enable row level security;
alter table public.uid_governance_evaluations enable row level security;
alter table public.uid_governance_snapshots enable row level security;
revoke all on public.uid_governance_baselines from public,anon,authenticated;
revoke all on public.uid_governance_evaluations from public,anon,authenticated;
revoke all on public.uid_governance_snapshots from public,anon,authenticated;
comment on table public.uid_governance_evaluations is 'Automated evidence outcomes. Only status passed after actual controlled regression execution; gateway scores or manual checkboxes cannot mark passed.';

-- Edge Function uses service_role only after validating authenticated admin JWT.
grant select,insert,update on public.uid_governance_baselines to service_role;
grant select,insert,update on public.uid_governance_evaluations to service_role;
grant select,insert on public.uid_governance_snapshots to service_role;
