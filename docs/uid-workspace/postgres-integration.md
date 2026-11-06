# Disposable PostgreSQL workspace contract

Status (2026-11-06): **harness implemented; real PostgreSQL execution NOT RUN in this workspace**. PostgreSQL binaries/server are not available here. Offline checks passed, but do not establish RLS enforcement, SQL validity, cross-connection safety or restart durability.

The harness is separate from application startup and from `npm test`. Nothing here applies a production migration, changes the existing disabled checkpoint foundation, creates a live role, enables execution, contacts Supabase/OpenAI, or changes ChatGPT. Only the three test/documentation files belong to this change. The SQL draft remains unapplied.

## Files and boundaries

- `tests/sql/workspace_fixture.sql`: deliberately test-only owner, shared budget, login and membership tables with forced RLS, separate minimum-privilege login roles, and a separate non-login worker-function owner. The public, fixed password in the fixture is synthetic test data, not a credential to use on any real service.
- `tests/sql/uid_workspace_runtime.mjs`: invokes the actual TypeScript adapters through the repository's `tsx` loader, injecting an already-installed `pg` module as existing SQL suites do. No driver installation or connection happens automatically. The `--self-test` mode never imports `pg` or connects.
- Worker function bodies are read from `docs/uid-workspace/runtime-schema.draft.sql` and relocated only to test schema/table names. The test does **not** maintain a more permissive or silently fixed duplicate implementation. Ownership and EXECUTE grants are fixture-only. SQL discovery must reject `NULL`, zero and over-limit page sizes, even though the TypeScript wrapper already rejects them.

A real test run creates **cluster-wide roles** and commits synthetic rows so independent connections and a new process can read them. Use a fresh disposable **cluster**, not an extra database on a shared cluster. The harness refuses existing fixture roles/schema and any application schema/public relation. It does not reset, truncate, drop, repair or overwrite existing objects. Destroy the entire test cluster after inspection; rerunning requires a fresh one.

## Refusal conditions

All of these are required before importing the driver or opening a connection:

- `UID_WORKSPACE_PG_TEST_DISPOSABLE=yes`.
- `PGDATABASE=uid_workspace_test` and `PGUSER=uid_workspace_test_admin`, exactly.
- Explicit numeric loopback `PGHOST=127.0.0.1` or `::1`; hostnames (including `localhost`), remote addresses and socket paths are rejected.
- Explicit numeric port from 1024 through 65535.
- No `DATABASE_URL`, `PGDATABASE_URL`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS`, `PGHOSTADDR` or `PGPASSFILE` overrides.
- Optional `UID_TEST_PG_MODULE` is an already-installed absolute local `.js`, `.mjs` or `.cjs` path, or omitted to resolve the installed `pg` package. Remote/relative module specifiers are rejected.

After connecting, before DDL, both the runner and SQL fixture verify PostgreSQL major 16/17, exact database/admin identity and this database comment:

`UID_WORKSPACE_DISPOSABLE_TEST_ONLY_v1`

The runner supplies the fixed test password explicitly and does not discover or use environment passwords, secret files, connection URLs, service credentials or provider credentials. Connections use SSL disabled on numeric loopback only. Do not expose that test server on a public interface or use port forwarding/tunnels to a non-disposable server. A loopback address plus an operator-set marker is an intentional test boundary, **not** proof that an operator cannot mislabel a real server. Never mark a real/shared cluster disposable.

The fixture's guard additionally requires a session test flag and a fresh empty test namespace. Fixture DDL plus relocated functions/grants commit atomically. A failed setup rolls back. Later assertion failures retain committed synthetic data for inspection; they never trigger destructive cleanup.

## Run offline now

From the repository root, with the existing dependencies:

```sh
node --check tests/sql/uid_workspace_runtime.mjs
node --import tsx tests/sql/uid_workspace_runtime.mjs --self-test
```

Self-test checks 26 unsafe/missing configurations, SQL fixture guards/structure, relocation of the exact draft function bodies, and the default-disabled runtime. It prints an explicit `NOT RUN` for PostgreSQL stages. Invoking the runner with no opt-in exits nonzero before importing `pg`.

Relevant existing suites, still using their explicitly labeled fake SQL protocol:

```sh
node --import tsx --test \
  tests/uid-workspace-store.test.ts \
  tests/uid-workspace-budget.test.ts \
  tests/uid-workspace-provider-budget.test.ts \
  tests/uid-workspace-runtime.test.ts
```

Recorded offline result: 62/62 focused existing tests passed. These are not real PostgreSQL results.

## Run later on an explicitly authorized disposable cluster

No commands in this section were executed as part of this implementation. They require an operator-provided disposable environment and an already-installed official PostgreSQL 16/17 image/server plus `pg` module. The harness does not download tools or images. Existing CI has PostgreSQL 16/17 service patterns; no workflow has been changed or scheduled here.

Example isolation layout, only when the official image and container tooling are already available:

```sh
# Fresh cluster, fixed synthetic credentials, loopback bind and ephemeral storage.
# Do not mount an existing data directory or use a shared cluster.
docker run --rm --name uid-workspace-pg-test \
  -p 127.0.0.1:55432:5432 \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_DB=uid_workspace_test \
  -e POSTGRES_USER=uid_workspace_test_admin \
  -e POSTGRES_PASSWORD=uid-workspace-disposable-test \
  postgres:16
```

In a separate shell, once that specific throwaway server is ready:

```sh
docker exec uid-workspace-pg-test \
  psql -U uid_workspace_test_admin -d uid_workspace_test -v ON_ERROR_STOP=1 \
  -c "COMMENT ON DATABASE uid_workspace_test IS 'UID_WORKSPACE_DISPOSABLE_TEST_ONLY_v1'"

# Start with a clean environment to avoid inheriting unrelated connection settings.
# Replace only the local installed pg module path. Do not supply real credentials.
env -i PATH="$PATH" \
  UID_WORKSPACE_PG_TEST_DISPOSABLE=yes \
  PGHOST=127.0.0.1 PGPORT=55432 \
  PGUSER=uid_workspace_test_admin PGDATABASE=uid_workspace_test \
  UID_TEST_PG_MAJOR=16 \
  UID_TEST_PG_MODULE=/absolute/path/to/already-installed/pg/lib/index.js \
  node --import tsx tests/sql/uid_workspace_runtime.mjs

# After reviewing the log, stop this exact named disposable cluster.
# --rm removes the container and tmpfs data, not any production object.
docker stop uid-workspace-pg-test
```

Repeat on a new PostgreSQL 17 cluster with `postgres:17` and `UID_TEST_PG_MAJOR=17`. Never run the fixture separately against a remotely supplied URL. The runner is the supported entrypoint and supplies the session guard. No production environment variables or real login/model keys are needed.

## Assertions when the real run is enabled

- Actual separate PostgreSQL backend PIDs and actual least-privilege logins. Runtime connections have no superuser/BYPASSRLS/role-creation/database-creation powers or role memberships, and do not own tables. There is no superuser `SET ROLE` façade in the adapter tests.
- Owner SELECT/INSERT/UPDATE isolation, cross-owner `WITH CHECK` rejection, no-context denial, context removal on both COMMIT and ROLLBACK, and reuse of a single pooled session. Browser, worker and unrelated runtime roles cannot read owner state.
- Twenty-four concurrent first-insert/update operations across two adapter pools preserve all entries and revision increments. Throwing or asynchronous mutation callbacks roll back. Competing task version CAS preserves one task/action/event result. SQL revision CAS rejects a stale revision. A separately held advisory lock is observed blocking the other backend and released on rollback.
- Controlled lost-COMMIT acknowledgment after a successful **real PostgreSQL COMMIT** becomes `STORE_OUTCOME_UNKNOWN`, `BUDGET_OUTCOME_UNKNOWN` or `LOGIN_LIMITER_OUTCOME_UNKNOWN`, with the committed identity/fence retained. This deliberately tests ambiguous-ack handling, not network packet loss.
- Real concurrent text and image adapters contend on the same project journal and obey global caps across owners, member caps across tasks, and task caps. Project RLS excludes other rows. The budget role cannot INSERT/provision a project. Unprovisioned work remains denied.
- Provider duplicate/conflict fences, single-use submission intent, unknown usage holds and cross-modality operation collisions persist. Automatic task admission derives one grant within its fixture standing policy under concurrency, admits no extra task beyond policy, and spends nothing.
- Login first-insert races enforce both account and client limits, namespace isolation and duplicate attempt fences. Expired success is rejected after its unavailable outcome is durably saved.
- Worker SQL functions expose only sorted/paged owner identifiers and membership booleans. Inactive/viewer/missing/duplicate members are denied; current revocation is visible immediately. No browser/store/budget/login role can invoke them. The worker cannot read membership tables or become the function owner. Function owner and fixed `pg_catalog` search path are checked.
- Parent adapter pools close, then a **new Node process** with fresh PostgreSQL sessions reads the committed owner state, unknown provider hold, login replay fence and membership. No in-memory fake state crosses that process boundary.

## What a pass still would not prove

This fixture is a candidate contract in an isolated namespace, not a migration mapped to the live checkpoint schema or real membership schema. Trusted server roles can deliberately set a different owner/project context; RLS context is not remote user authentication. Production role credentials, exact pool privileges, Supabase token verification, ingress policy, real member revocation path, private storage, pricing, provider entitlement, paid work, generated quality and end-to-end browser output remain separate release gates.

The harness does not kill/restart PostgreSQL, simulate disk loss, verify backups, crash an active production worker, exercise host replacement, test query plans at scale or provide throughput certification. Process reopen and controlled acknowledgment loss must not be reported as database crash recovery. A full release still needs reviewed schema reconciliation, actual PostgreSQL 16/17 passes and independent deployment/auth/storage/provider/QC checks.
