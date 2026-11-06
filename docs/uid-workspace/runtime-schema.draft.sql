-- DRAFT ONLY. Never loaded or executed by application code.
-- Reconcile with the existing disabled UID checkpoint schema before approval.
-- Role names, schemas, ownership and membership source are placeholders to review.
-- This draft creates NO role, grants NO membership, and contains NO credential.

CREATE TABLE private.uid_workspace_budget_journal (
  project_id text PRIMARY KEY,
  state jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state->>'project_id' = project_id),
  CHECK ((state->>'version')::integer = 1),
  CHECK (jsonb_typeof(state->'operations') = 'array'),
  CHECK (jsonb_typeof(state->'owners') = 'array'),
  CHECK (jsonb_typeof(state->'tasks') = 'array')
);
ALTER TABLE private.uid_workspace_budget_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uid_workspace_budget_journal FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_budget_project_context ON private.uid_workspace_budget_journal
  USING (project_id = current_setting('uid.workspace_budget_project', true))
  WITH CHECK (project_id = current_setting('uid.workspace_budget_project', true));
-- Runtime's dedicated budget role: SELECT, UPDATE only. Provisioning standing global/member policies is
-- separate; runtime derives per-task grants only within an existing approved policy. Runtime never inserts a project. No browser/anon/authenticated grant.
-- That runtime role must not own the table or have BYPASSRLS/superuser/service-role.

CREATE TABLE private.uid_workspace_login_journal (
  namespace text PRIMARY KEY,
  state jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state->>'namespace' = namespace),
  CHECK ((state->>'version')::integer = 1),
  CHECK (jsonb_typeof(state->'reservations') = 'array')
);
ALTER TABLE private.uid_workspace_login_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uid_workspace_login_journal FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_login_namespace_context ON private.uid_workspace_login_journal
  USING (namespace = current_setting('uid.workspace_login_namespace', true))
  WITH CHECK (namespace = current_setting('uid.workspace_login_namespace', true));
-- Login role receives only SELECT, INSERT, UPDATE for this table. No table
-- ownership, BYPASSRLS, service-role or browser grant. No raw PII in state.

-- These two bounded SECURITY DEFINER functions require a dedicated non-login,
-- non-superuser owner with SELECT on ONLY the reviewed owner-state + membership
-- columns. A specific RLS SELECT policy may be required for that function owner.
-- Do not grant web/browser/runtime roles membership in the function-owner role.
-- Worker receives EXECUTE on exactly these functions, not general table reads.
-- SQL is fully qualified and the search_path is pg_catalog only.
-- Names below correspond to the separate reviewed owner-state draft. Resolve the
-- actual column names and membership semantics against the existing project.
CREATE FUNCTION private.uid_workspace_discover_owners(after_owner text, page_limit integer)
RETURNS TABLE(owner_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_WORKER_CURSOR';
  END IF;
  RETURN QUERY
    SELECT s.owner_id
    FROM private.uid_workspace_owner_state AS s
    WHERE (SELECT count(*) = 1 AND coalesce(bool_and(m.is_active = true AND m.role IN ('contributor', 'admin')), false)
      FROM public.creative_dna_team_members AS m WHERE m.user_id::text = s.owner_id)
      AND (after_owner IS NULL OR s.owner_id COLLATE "C" > after_owner COLLATE "C")
      AND EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(s.state->'tasks') AS t(task)
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(t.task->'actions') AS a(action)
        WHERE a.action->>'status' IN ('queued', 'running')
      )
    ORDER BY s.owner_id COLLATE "C" LIMIT page_limit;
END;
$$;
REVOKE ALL ON FUNCTION private.uid_workspace_discover_owners(text, integer) FROM PUBLIC;

CREATE FUNCTION private.uid_workspace_authorize_owner(requested_owner text)
RETURNS TABLE(allowed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) = 1 AND coalesce(bool_and(m.is_active = true AND m.role IN ('contributor', 'admin')), false) AS allowed
  FROM public.creative_dna_team_members AS m WHERE m.user_id::text = requested_owner;
$$;
REVOKE ALL ON FUNCTION private.uid_workspace_authorize_owner(text) FROM PUBLIC;

-- Required independent review before enabling:
-- 1. Resolve actual tables/roles and additive checkpoint mapping.
-- 2. Pin function ownership + minimum grants + RLS policies explicitly.
-- 3. Deny PUBLIC, anon and authenticated API exposure, including PostgREST schema.
-- 4. Verify empty/missing/inactive/duplicate member behavior and role revocation.
-- 5. Test concurrent commits, lost commit acknowledgments and real restarts.
-- 6. Provision grants with actual approvals/pricing evidence; keep journal fences.
