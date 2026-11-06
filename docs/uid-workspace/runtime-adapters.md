# Runtime adapters and shared accounting

Offline implementation, 2026-11-06. No production database, permissions, ingress, credentials, provider account or worker has been configured, verified or enabled by this change. The SQL companion is a design draft, not an applied migration.

## Server and worker bootstrap

`createWorkspaceRuntime(config = {})` in `uid-workspace-runtime.ts` composes real implementations instead of treating injected booleans as execution:

- Existing Supabase remote token verification and per-request member self-read using a publishable key and the caller's access token.
- `PostgresWorkspaceStore` for owner-scoped atomic action/event/task commits.
- `PostgresWorkspaceBudget` for project-wide, per-member and per-task accounting, independently from member authentication.
- `PostgresWorkspaceLoginLimiter` plus an explicit reviewed client-identity resolver when password login is enabled.
- Two narrow reviewed worker directory RPCs for paginated owner job discovery and fresh current-member authorization without retaining browser access/refresh tokens.
- Checked private immutable object write/read access, exact owner/task/hash binding and readback. The actual approved object-store backend and canonical preview renderer must be supplied.
- Bounded OpenAI Responses calls with authorization loaded from the current durable task budget grant. The fixed project credential stays on the server. The budget reservation is bound to a named durable child operation before submission intent and network dispatch. Research, authoring, image generation and independent review retain separate child identities under the original stage/run fence; all providers use the same project accounting row. Model output remains untrusted and never turns into a quality receipt automatically. See `child-operations.md` and `production-composition.md`.
- A separately supervised, explicit `runWorkspaceWorker` loop. The factory does not start a timer and HTTP polling never drains jobs.

Server wiring is `createWorkspaceGateway({ workspace: runtime.apiOptions })` in the new `uid-workspace-gateway.ts`; the actual `createWorkspaceWebApplication(config, { staticDirectory })` factory in `scripts/workspace-bootstrap.ts` does this and can mount the built browser application without starting a worker. The wrapper mounts terminating private routes before the unchanged legacy Express application, so the existing server source/default startup and ChatGPT behavior remain unchanged. `npm run build` additionally emits `dist/workspace-bootstrap.cjs` for a reviewed deployment composition; it does not replace the existing server entry. Running the source or compiled bootstrap with `--check` only prints disabled-default prerequisites and performs no network/SQL operations. Worker wiring calls `runWorkspaceWorker(runtime, { signal })` in an independently supervised process with reviewed dependencies. The runtime itself does not listen on a port. Neither environment-variable names nor mere presence of a key enable paid work. The default factory returns disabled readiness with exact prerequisites and performs no SQL/provider calls.

Use separate `database.budgetPool`, `loginPool`, and `workerPool` when those privileges belong to different runtime identities; otherwise the explicitly injected primary pool is used. All pools are already established pg-compatible dependencies. This code does not create/connect/configure credentials or request extra permissions. Pool role capabilities, timeouts, recovery and connection lifecycle remain the deployment operator's responsibility.

`createPipeline(services)` accepts a pipeline result with `adapters`, exact `readiness()` blockers, optional `renderPreview` and `reconcilers`; its real prerequisite failures are included in runtime/API readiness. For individually wired stages, `createAdapters(services)` supplies the actual stage adapters with access to the store, accounting, checked artifacts and `submitText`. The latter requires the exact active run operation ID and durable provider-binding callback, current contributor/admin authorization, a durable task authorization and current model/pricing verification. Adapters must still validate their actual source/pixel/semantic evidence independently. Missing research, image, image reuse, conversion, visual QA, browser rendering, package or recovery adapters are not synthesized. `createReconcilers(services)` optionally exposes the runner's read-only provider reconciliation workflow; absent reconcilers leave recovery unavailable. Reconciliation must never resubmit generation.

## Budget journal

One pre-provisioned project row is the atomic unit. It contains global/member/task grants plus an append-only operation journal. A transaction sets the exact project context, takes a project advisory lock, locks the row, reads the current grants, checks all three ceilings, updates by revision CAS and commits. Concurrent first reservations cannot each consume the same headroom. Unknown COMMIT acknowledgement throws `BUDGET_OUTCOME_UNKNOWN`; another process reads the retained operation fence rather than retrying the paid request.

The runtime never creates global/member grants or a standing task-admission policy. Those require explicit reviewed authorization and operator provisioning. A configured member `task_policy` permits automatic per-task admission under its fixed bounds, avoiding manual provisioning for every task. Each resulting task grant retains the reviewed user data authorization, project/model capability reference, task budget authorization, member quota and global spending authorization. Grants expire and can be revoked in the separately authorized operator flow. An authorization reference is evidence provenance, not proof that its approval occurred. Operators must verify that evidence before provisioning any grants. Standing policy provisioning/renewal/changes are intentionally not exposed to browsers or the model.

`runtime.admitTask(ownerId, taskId)` first rechecks current contributor/admin membership and reads the actual persisted owner-scoped brief. `budget.admitTask` atomically loads the current approved policy, checks allowed brands/material/source origins, verified capability, maximum task cap, request cap, task-count limit and expiry, then derives a task-scoped grant. The HTTP caller supplies no amount, grant, policy or authorization reference. Concurrent/repeated calls return the same admitted task; lost commit acknowledgments are reconciled by owner/task identity. It does not reserve or spend funds. The API calls this after durable task creation and again on Start; failure leaves the brief saved with `not_admitted`, never a claim that execution is ready. `taskExecutionReadiness` independently checks the current grant. A changed/revoked/expired standing policy blocks future reservations and previously reserved submission intents for its admitted tasks. No implicit consent, unapproved policy creation or automatic grant expansion occurs.

All money is integer micro-USD. The rate card is explicit and current, not hardcoded to an advertised short-context example. The quote uses full request UTF-8 bytes times a reviewed tokenizer upper-bound factor, reviewed protocol input overhead and the complete output-token cap (including reasoning), selecting the highest rate from every reachable input-context tier. BigInt arithmetic rounds upward. Requests outside the verified pricing bounds or below the conservative full-cost bound are denied. The full user-requested cap is reserved across global, member and task ceilings, not just the quote.

`markSubmissionIntent` rechecks active grants, current pricing and all caps after any changes. It is durably single-use before network submission. Once recorded it is not releasable automatically, even if a later local failure appears to precede fetch. Crashes in that gap must not provide a retry path. `releaseBeforeSubmit` releases only a reservation that never reached submission intent and permanently retains its operation fence.

Completed/known-failure responses settle only with actual bounded numeric usage. Missing usage and all unknown outcomes retain the full reservation. A later independent reconciliation may settle the same exact operation, preserving provider identifiers; conflicting settled reports are rejected. Ordinary input rates are applied even to cached input, deliberately over-accounting until a separately reviewed invoice correction. Provider usage exceeding the reservation or verified pricing envelope holds the reservation and freezes the project. Unknown holds never expire just because the grant or pricing expires.

This bounded envelope is intentionally a conservative initial implementation, not an unlimited fleet billing service. Default journal limit is 10,000 operations/16 MiB per project. Full journals deny new reservations; never delete operation fences or zero counters to make room. There is no automatic monthly reset. Introduce reviewed partitioned journals and a permanent deduplication index before scaling or rotating accounting periods. Carry every unresolved charge/hold into any reviewed period migration. Project identifiers are bounded to 117 characters so opaque encoded reservation IDs remain within the transport's 200-character fence limit. All operators must use the same project serialization protocol when changing grants.

## Durable login protection

The login journal atomically counts both account and trusted-client dimensions. It receives only bounded hashed account/client keys and server-generated attempt IDs, never passwords, email addresses, tokens or request headers. Success releases only its own attempt. Rejection and upstream unavailability count as failure. Orphan reservations turn into failures at expiry, then age out after the configured failure window. A late successful auth response cannot issue a session cookie. Unknown COMMIT acknowledgement fails closed, preserving the prior durable reservation.

Defaults: client failure/in-flight cap 30, account cap 10, 10-minute failure window, 60-second in-flight reservation, 100,000 retained records maximum. Legitimate successes do not consume failure buckets but remain as short-lived replay fences. Repeated outages and capacity exhaustion deny admission rather than attempting unbounded provider calls. Review the limits for the actual deployment and monitor capacity.

The ingress resolver has two explicit modes:

1. Direct socket, only for a reviewed truly direct origin.
2. An exact allowlist of ingress socket peers plus exactly one reviewed custom `x-*` address header that that ingress always replaces. Unknown peers, duplicates, comma chains, zone identifiers and malformed IPs are rejected. Standard `X-Forwarded-For`, `Forwarded` and Express `req.ip` have no automatic authority. IPv4-mapped IPv6 and equivalent IPv6 addresses normalize before keyed hashing.

The HMAC pseudonym key is an already-authorized injected server secret; this code does not generate, fetch or store it. Review actual ingress sanitization and direct-origin restrictions independently. Constructor `reviewedIngress` fields record that contract; they cannot prove the hosting configuration.

## Worker discovery and private bytes

The worker uses exactly two SQL functions, not general cross-owner table reads. Discovery returns only sorted owner IDs with current active contributor/admin membership and actionable queued/running actions. Authorization is rechecked before every stage and text call. Discovery pagination restarts after the last page; leases serialize concurrent workers. A stale/failed owner does not starve the rest of a page. Public API reads, reconnects and status polling have no dispatch side effects.

The runtime uses `WorkspacePrivateObjectStore` and `WorkspaceArtifactService` from the shared custody module for both uploads and downloads. Inject `objectStore` for HTTP custody and optionally `workerObjectStore` for a separate already-authorized worker identity on the same backend. The checked worker helper uses that same private immutable `put`/`open` protocol and key namespace. Keys are server-derived hashes of owner, task and bytes. Write success requires readback with an exact checksum. Download reads validate owner/task key, retained artifact identity, byte length and hash. This wrapper is not a fake storage backend and supplies no production object-store credential or public bucket. The worker buffer helper remains capped at 32 MiB; `putArtifactStream` writes and independently verifies artifacts up to 256 MiB through the shared custody helper. The shared custody API spools and fully verifies streams before serving packages up to 256 MiB, without buffering them whole in RAM. Existing disabled Supabase checkpoint storage does not support every workspace media type; do not pretend it already does.

## Validation status

Focused Node suites exercise actual journal state transitions and concurrent adapter instances over an explicitly labeled SQL-protocol fake. The fake serializes transactions and emulates revision CAS/commit loss, but is not PostgreSQL and does not prove RLS, PostgreSQL query plans, distinct real connections, function privileges or crash durability. Tests also cover default-disabled composition, bound pricing, all three cap scopes, replay fences, single submission, revocation, missing usage, overrun freeze, late login expiry, unrelated success/failure isolation, spoofed ingress headers, private-byte integrity and worker shutdown.

Real deployment release checks remain: apply only an approved reconciled schema; test PostgreSQL RLS/role separation and cross-connection contention; verify exact ingress behavior; verify provider entitlement/current pricing under the intended project; configure approved quotas; connect private storage; run actual stage adapters and browser renders; independently review semantic/pixel/human evidence and EO golden cases; verify worker restart, cancellation and unknown-outcome recovery. No local mock pass substitutes for those checks.

## Generated artifact intent journal

Production stage adapters use `services.writeRunArtifact(context, identity, stream)`, not a raw object-store write. The writer owner-transacts the exact immutable owner/task/hash key, length and media type under the current run before any private storage side effect. It verifies live run ID, action, fence, lease owner/expiry, task state version, snapshot/content revision, queued cancellation and fresh contributor/admin authorization. Each run is bounded to 256 intents/512 MiB of predicted bytes, with a 256 MiB individual object limit.

The final guard wraps the actual object-store `put` boundary **after** full source staging, so cancellation, abort, lease expiry or changed task scope during a slow input stream prevents the later PUT. The same checks run again before publishing a verified artifact receipt. Interrupted writes retain `reserved`/`unknown` identity in the durable run. A repeated intent only opens and hashes that exact object; it never blindly retries PUT or generation. Missing bytes remain unknown. A new process can recover the retained identity for a separately verified reconciliation.

The text transport likewise performs a final persisted run/action/binding/scope/member check immediately before the actual injected provider fetch, after any delay in accounting submission-intent commit. A cancellation in that gap produces no provider call, but conservatively retains the already-marked reservation for reconciliation rather than claiming it is safe to retry.

## Exact deployment composition contract

The application provides no environment-driven production activation. `scripts/workspace-bootstrap.ts --check` is an offline disabled-default check, not a deploy command. An authorized deployment module must construct `WorkspaceRuntimeConfig` with already-reviewed dependencies. Never commit real keys or tokens in that module.

Required fields for the full application:

- `publicOrigin`: the exact production HTTPS origin, without a path, credentials, query or fragment.
- `auth`: the existing Supabase project HTTPS URL, **publishable/anon** key, optional additional user-ID restriction, and `passwordLogin: true` only when the login prerequisites below exist. Remote token/member checks are always used. The model key is unrelated to this key.
- `database.pool` plus `database.ownerStore`: an already-configured pg-compatible pool and the reviewed owner-state table descriptor (`schemaReviewed: true`, `schemaVersion: 'uid-workspace-owner-state-v1'`, `qualifiedTable`). These values do not create tables or grants.
- `database.budget` and optional `budgetPool`: `schemaVersion: 'uid-workspace-budget-v1'`, exact journal table, complete current verified pricing envelope, and a pre-provisioned project row containing approved global/member grants and member task-admission policies. No task grant or scope is accepted from browser requests. No standing policy is created automatically.
- `database.workerDirectory` and optional `workerPool`: `schemaVersion: 'uid-workspace-worker-directory-v1'`, exact `discoverFunction` and `authorizeFunction` names. Each function must pass the documented role/RLS review, restrict to exactly one active contributor/admin member row and expose only its narrow result. No service-role database key is needed.
- For password login, `database.login`/optional `loginPool`: `schemaVersion: 'uid-workspace-login-v1'`, exact journal table, deployment namespace and reviewed limits. `ingress` must supply one of the explicit reviewed topologies plus the already-authorized pseudonym HMAC key. Do not infer Render proxy trust or create a key in code.
- `openai`: already-authorized server project credential, current verified exact-model capability, native server `fetch`, reviewed limits and optional clock. No browser, session or subscription token is reused. The text transport is fixed to Responses and `gpt-6.1-sol`; image/other provider expenses need their own actual bounded adapter and corresponding approved shared accounting before their stage is enabled.
- `objectStore`: reviewed private `WorkspacePrivateObjectStore`, such as the real `SupabaseWorkspaceObjectStore` with the approved bucket and exact policies. Optionally supply `workerObjectStore` for a separate authorized server identity on the same backend. A user-token-only object store cannot be used by an unattended worker without an approved worker identity. `artifactSpool` optionally selects the bounded private disk spool.
- `createPipeline(services)`: return the actual Onepage adapter factory result, including its exact missing-port readiness and renderer. All real source acquisition, independent claim/pixel/human evidence, generation, conversion, browser mapping and package paths must be configured. Merely providing functions that return `passed` does not satisfy deployment review. The pipeline's readiness blockers are merged into the API.
- `executionEnabled: true` only after the real release gates pass. `worker: { enabled: true, ownerPageSize, stepsPerOwner, workerId }` identifies the reviewed independently supervised worker configuration. It never starts a loop inside the web server.

Once the reviewed dependency module has assembled that config:

```ts
// No credentials are constructed or discovered by these factories.
const { app, runtime } = await createWorkspaceWebApplication(config, {
  staticDirectory: '/srv/app/dist',
});
// Caller owns the existing listener/TLS/proxy configuration and graceful shutdown.
// app.listen(...) belongs in that separately reviewed hosting entry.

// Separate worker entry/process, never browser polling or an HTTP action handler:
await startWorkspaceWorker(config, shutdownController.signal, {
  pollMs: 1000,
  onError: code => approvedLogger.warn(code), // Static codes, never raw exceptions.
});
```

The configured pipeline can be composed directly:

```ts
createPipeline: services => createWorkspaceOnepageProductionPipeline(services, reviewedProductionOptions)
```

These are wiring examples, not runnable credentials or certified provider ports. If `executionEnabled` is omitted/false, provider execution and admission stay disabled. If a prerequisite is missing, the web app can still preserve authorized brief/task reads where configured, but the worker bootstrap refuses to run a purported complete pipeline. Per-task readiness additionally checks that specific task's current data/budget grant. Recovery readiness exposes only known configured stages; mutation still requires the API's current contributor/admin role check and the runner's fresh owner authorization before reconciliation.

## Focused check record

At this change's handoff, `tests/uid-workspace-budget.test.ts` and `tests/uid-workspace-runtime.test.ts` pass **36 tests** with no skips. `tsc --noEmit`, the bootstrap's offline `--check` and `git diff --check` pass. The tests use injected SQL and HTTP fixtures. The composed transport test verifies reservation, durable-run-binding callback, submission fence, mocked response accounting and restart deduplication without any provider traffic. This is not a real PostgreSQL or paid OpenAI test, and is not an EO acceptance result.
