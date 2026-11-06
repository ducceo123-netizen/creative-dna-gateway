-- DISPOSABLE TEST CLUSTER ONLY. Not a migration or production role proposal.
-- The runner validates loopback/config before connecting. This independent guard
-- also refuses unmarked databases and pre-existing fixture roles/schema.
-- Creates cluster-wide test roles, so use a fresh throwaway cluster, not merely
-- another database on a shared cluster. Never supply any real credentials.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF current_database() <> 'uid_workspace_test'
    OR current_user <> 'uid_workspace_test_admin'
    OR pg_catalog.shobj_description((SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()), 'pg_database')
      IS DISTINCT FROM 'UID_WORKSPACE_DISPOSABLE_TEST_ONLY_v1'
    OR current_setting('uid.workspace_disposable_test', true) IS DISTINCT FROM 'yes'
    OR current_setting('server_version_num')::integer / 10000 NOT IN (16, 17) THEN
    RAISE EXCEPTION 'Explicit marked disposable PostgreSQL 16/17 test cluster required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'uid_workspace_test')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname LIKE 'uw_test_%')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg_%')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public') THEN
    RAISE EXCEPTION 'Fresh empty test database and unused fixture role names required; destroy/recreate the disposable cluster';
  END IF;
END;
$$;
-- These public, deliberately fixed passwords are TEST DATA for an ephemeral,
-- loopback-only cluster. No password is discovered, saved or read from a secret.
CREATE ROLE uw_test_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE uw_test_directory_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE uw_test_store LOGIN PASSWORD 'uid-workspace-disposable-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE uw_test_budget LOGIN PASSWORD 'uid-workspace-disposable-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE uw_test_login LOGIN PASSWORD 'uid-workspace-disposable-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE uw_test_worker LOGIN PASSWORD 'uid-workspace-disposable-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE uw_test_browser LOGIN PASSWORD 'uid-workspace-disposable-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA uid_workspace_test AUTHORIZATION uw_test_schema_owner;
REVOKE ALL ON SCHEMA uid_workspace_test FROM PUBLIC;
GRANT USAGE ON SCHEMA uid_workspace_test TO uw_test_store, uw_test_budget, uw_test_login, uw_test_worker, uw_test_directory_owner;

CREATE TABLE uid_workspace_test.owner_state (
  owner_id text PRIMARY KEY,
  state jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state->>'owner_id' = owner_id),
  CHECK (jsonb_typeof(state->'tasks') = 'array'),
  CHECK (jsonb_typeof(state->'creations') = 'array')
);
ALTER TABLE uid_workspace_test.owner_state OWNER TO uw_test_schema_owner;
ALTER TABLE uid_workspace_test.owner_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE uid_workspace_test.owner_state FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_context ON uid_workspace_test.owner_state TO uw_test_store
  USING (owner_id = current_setting('uid.workspace_owner_id', true))
  WITH CHECK (owner_id = current_setting('uid.workspace_owner_id', true));
CREATE POLICY directory_select ON uid_workspace_test.owner_state FOR SELECT TO uw_test_directory_owner USING (true);
GRANT SELECT, INSERT, UPDATE ON uid_workspace_test.owner_state TO uw_test_store;
GRANT SELECT (owner_id, state) ON uid_workspace_test.owner_state TO uw_test_directory_owner;

CREATE TABLE uid_workspace_test.budget_journal (
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
ALTER TABLE uid_workspace_test.budget_journal OWNER TO uw_test_schema_owner;
ALTER TABLE uid_workspace_test.budget_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE uid_workspace_test.budget_journal FORCE ROW LEVEL SECURITY;
CREATE POLICY project_context ON uid_workspace_test.budget_journal TO uw_test_budget
  USING (project_id = current_setting('uid.workspace_budget_project', true))
  WITH CHECK (project_id = current_setting('uid.workspace_budget_project', true));
GRANT SELECT, UPDATE ON uid_workspace_test.budget_journal TO uw_test_budget;

CREATE TABLE uid_workspace_test.login_journal (
  namespace text PRIMARY KEY,
  state jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state->>'namespace' = namespace),
  CHECK ((state->>'version')::integer = 1),
  CHECK (jsonb_typeof(state->'reservations') = 'array')
);
ALTER TABLE uid_workspace_test.login_journal OWNER TO uw_test_schema_owner;
ALTER TABLE uid_workspace_test.login_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE uid_workspace_test.login_journal FORCE ROW LEVEL SECURITY;
CREATE POLICY namespace_context ON uid_workspace_test.login_journal TO uw_test_login
  USING (namespace = current_setting('uid.workspace_login_namespace', true))
  WITH CHECK (namespace = current_setting('uid.workspace_login_namespace', true));
GRANT SELECT, INSERT, UPDATE ON uid_workspace_test.login_journal TO uw_test_login;

-- Duplicate membership rows are intentional adversarial fixtures, not a proposed
-- membership schema. This table never touches creative_dna_team_members.
CREATE TABLE uid_workspace_test.team_members (user_id text NOT NULL, role text NOT NULL, is_active boolean NOT NULL);
ALTER TABLE uid_workspace_test.team_members OWNER TO uw_test_schema_owner;
ALTER TABLE uid_workspace_test.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE uid_workspace_test.team_members FORCE ROW LEVEL SECURITY;
CREATE POLICY directory_membership ON uid_workspace_test.team_members FOR SELECT TO uw_test_directory_owner USING (true);
GRANT SELECT (user_id, role, is_active) ON uid_workspace_test.team_members TO uw_test_directory_owner;

-- Worker function bodies are installed by the runner from the UNAPPLIED draft,
-- with only schema/table identifiers relocated to this test fixture. Ownership
-- and exact EXECUTE grants are applied by the runner, before COMMIT. This ensures
-- a draft bug cannot silently be hidden by a different function in the fixture.
-- The runner commits all fixture DDL atomically. It never runs a live migration.
