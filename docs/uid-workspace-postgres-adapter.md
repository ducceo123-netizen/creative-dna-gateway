# Workspace Postgres adapter: unapplied design

This document and `PostgresWorkspaceStore` are offline code only. No database connection, schema, grant, policy, row, storage bucket, activation flag, or credential has been changed. The existing Supabase checkpoints remain disabled and untouched.

## Multi-member authentication and shared provider account

Every active UID member can sign in using their own existing account. `createSupabaseWorkspaceVerifier` verifies the actual Supabase access token; `createSupabaseWorkspaceMembershipVerifier` then reads that verified user's current `creative_dna_team_members` row through the existing self-read RLS policy using their bearer token and a publishable key. Inactive, missing, ambiguous or unexpected roles are denied on every request. A static user-ID allowlist is optional additional restriction only and never substitutes for current membership. Viewers may read their own workspace and sign in, but task creation, uploads, edits and reconciliation require a current contributor or admin role. The unattended worker repeats this role check before execution.

The optional password sign-in provider is disabled unless explicitly configured. It calls only the configured Supabase Auth endpoint, then repeats token and member checks before setting an HttpOnly, Secure (production), SameSite=Strict cookie. Mutations and login require the configured same origin; a separate login protection boundary does not trust forwarded IP headers by default. Responses never expose tokens or retain passwords/refresh tokens. There is no signup or admin-account reuse. Sessions expire normally; no automatic refresh/persistent grant has been configured. Logout clears the workspace cookie; subsequent API access still requires current verification.

### Password-login deployment prerequisite

Production password login is unavailable until the deployment explicitly injects `loginProtection` with `reviewedIngress: true`, an approved `resolveClientKey(request)`, and a genuinely durable limiter with `durable: true`. Setting the login environment flag or configuring Supabase alone is insufficient: `login_supported` remains false and the login endpoint returns `LOGIN_RATE_LIMIT_NOT_CONFIGURED` when this protection is absent. There is no automatic Render/proxy inference, no blanket Express `trust proxy`, and no built-in acceptance of `X-Forwarded-For` or `Forwarded` as client authority.

Review the exact hosting ingress peers, which hop sanitizes/removes caller-supplied headers, the chain-selection algorithm, and direct-origin access restrictions before supplying the resolver. A shared ingress socket address is not a usable production client identity. An unknown or unverifiable client must fail closed. The resolver should return a bounded stable client pseudonym, preferably keyed, rather than exposing addresses in logs.

The injected durable limiter must atomically reserve independent normalized-account and trusted-client quotas across all web instances and restarts. It receives only hashed bounded account/client keys and an attempt ID, never passwords, raw email, tokens or request headers. `begin` returns a durable reservation or denial; `finish` records success, rejection or upstream unavailability. Successful logins release their reservations without consuming a shared failed-attempt bucket or resetting unrelated accounts' failures. Review concurrency caps, reservation expiry, crash recovery, failure windows, outage policy and retention. Resolver/limiter failures prevent provider submission or cookie issuance, as applicable. Actual distributed limiter and hosting trust configuration remain unapplied release prerequisites.

Only development/test uses the bounded process-local fallback: direct socket identity, independent normalized-account/client failed-attempt caps, in-flight reservations and expiry. It never reads forwarded headers and is never accepted as durable production protection. Offline tests distinguish multiple injected trusted client keys on one ingress, normalize account case, prevent forwarded-header spoofing from changing keys, allow repeated successful logins without a global lockout, and verify fail-closed production defaults. They do not validate a real hosting ingress or distributed limiter.

A shared model-provider API key is server/worker-only and is completely separate from member login. This code neither obtains nor configures it. Tasks, artifacts, action audit and usage attribution remain isolated by the authenticated member's user ID. Shared credentials do not authorize cross-member task sharing, broad data transmission, unlimited spend or bypassing approval/quality gates. Per-member quotas and the overall shared-account cap must be selected and enforced in the trusted execution adapter before enabling paid execution.

## Review required before deployment

The application can inject a pg-compatible pool into `PostgresWorkspaceStore` only after a database owner reviews the schema, access rules, backup/recovery behavior, scale limits, and relationship to the existing checkpoint tables. Its explicit `schemaReviewed: true` and schema-version constructor arguments are deployment assertions, not a migration runner or proof of an independent review. There is deliberately no production database environment loader or automatic activation.

The supplied implementation uses one atomic owner-state row. It persists tasks, immutable snapshot references, action intents, idempotency keys, and replay events in a single database transaction. Task-level CAS is checked inside a serialized owner transaction. PostgreSQL advisory transaction locking handles concurrent first inserts; row locking plus revision CAS protects updates. Owner context is set transaction-locally, and every SQL read/write has an owner predicate. A lost COMMIT acknowledgment returns `STORE_OUTCOME_UNKNOWN`; clients must read the task/action idempotency key before retrying. A browser session must never receive pool credentials.

This first adapter is intentionally bounded to 16 MiB per owner and is not an object store or an efficient fleet-wide work-queue index. Large preview HTML and artifact bytes belong in separately reviewed private storage. The legacy optional buffered artifact reader remains capped at 32 MiB. The new private-custody service verifies and streams actual artifact bytes up to 256 MiB with bounded disk spooling, owner/task checks, checksum verification before headers and cleanup on disconnect. This code is tested locally; the production private bucket, worker identity and policies remain unconfigured. The development file store has the same owner-state bound, works only on explicit direct loopback requests, and must not be used for public or ephemeral hosting.

## Proposed table contract (DO NOT run without review)

The exact schema/table name is an injected configuration value. Review whether to map this contract to the existing disabled checkpoint foundation or add an additive owner-state envelope; do not blindly create parallel production task tables.

```sql
-- Illustrative contract only. Role names, ownership, grants, and policies must be
-- reviewed under the real Supabase project. This file applies nothing.
CREATE TABLE private.uid_workspace_owner_state (
  owner_id text PRIMARY KEY,
  state jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state->>'owner_id' = owner_id),
  CHECK (jsonb_typeof(state->'tasks') = 'array'),
  CHECK (jsonb_typeof(state->'creations') = 'array')
);
ALTER TABLE private.uid_workspace_owner_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uid_workspace_owner_state FORCE ROW LEVEL SECURITY;
-- A reviewed dedicated non-owner, non-BYPASSRLS server role may receive only
-- SELECT, INSERT, UPDATE on this one table. No anon/authenticated/browser grants.
-- The server role is trusted to set context after remotely verified authentication.
CREATE POLICY workspace_owner_context ON private.uid_workspace_owner_state
  USING (owner_id = current_setting('uid.workspace_owner_id', true))
  WITH CHECK (owner_id = current_setting('uid.workspace_owner_id', true));
```

The database pool role must not own the table, have BYPASSRLS, be a service-role credential, or be accessible to browser clients or public PostgREST. A trusted server or worker may set the owner context only after authentication/authorization. Row-level context does not independently authenticate a caller: the HTTP verifier and current server-side membership resolver remain mandatory.

## Verification status

Offline tests cover SQL parameterization, owner context, lock/CAS query order, rollback, and unknown-commit classification using an injected fake pool. Filesystem tests exercise actual concurrent instances and restart persistence. Real PostgreSQL migration, RLS enforcement, cross-connection concurrency, deployment backups, revoked-role access, and crash/reconnect recovery have not been exercised and remain production release gates. No runtime provider, paid execution, live task or public artifact has been enabled.
