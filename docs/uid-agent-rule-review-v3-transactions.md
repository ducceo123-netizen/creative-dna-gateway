# V3 delegated rule transactions — implementation contract (inactive)

This contract is for a separate, disabled route. It is not a migration approval.
The v2 request, attempt, evaluation and completion code remains unchanged. No
pending proposal, existing v2 intent or old evidence is automatically promoted.

## One owner action

The authenticated owner delegates the exact proposal patch and target closure by
selecting **Giao dot review**. The rule route accepts normalized creative-rule
proposals in the existing supported creative branches. The two initial Onepage
texts are regression fixtures, not an allowlist. AI reviews substantive meaning,
brand consistency and conflicts; SQL/compilation validates the exact authorized
projection, identity and atomic mutation. Security/account/publication operations
remain outside this route. Missing factual evidence must produce an honest
blocked finding, while pure creative rules do not require output baselines.

The API receives an expected preview hash and stable idempotency key. A replay
returns the original result without renewing authority; a fresh explicit click
may create a new key after cancellation or expiry. A disabled compiler release
returns a specific inactive result. There is no silent v2 conversion or automatic
enqueue of pending proposals.

## Server-owned snapshot

Capture uid_rule_context once under the existing configured-owner assertion.
Derive intent and snapshot from that same context. Keep target records, brand
DNA, dependencies, trigger closure, compiler projection and source hashes. Do not
include baseline/candidate evaluation state in the rule-only freshness digest.
Do not simply delete a hash field from the old context: construct and document
the exact rule context projection, then recompute its candidate hash server-side.
The full emitted context is part of the source receipt set.

Canonical target catalogs and projected catalogs must be byte-equivalent under
stable JSON before adaptation. Never use the master catalog to repair divergent
mirror provenance as part of accepting an unrelated rule. Unknown dependencies,
unknown trigger effects, missing active brands or drift block the route.

## Private storage and RPC boundary

Use separate v3 request, immutable attempt, event and agent-rule audit storage.
No direct authenticated/service-role table writes. Keep mutation guards and
append-only audit behavior independent from mutable session flags. Request
creation is only through the owner-authenticated handoff API. Claim/complete are
only available to the already approved trusted review boundary after separately
reviewed activation. This draft must not add an enabled production release seed
or activate new execute grants as a side effect of deployment.

Claim selects one request with SKIP LOCKED, excludes another live lease, and
fences with a new UUID token and increasing lease version. Intent lifetime is
24 hours; lease is at most 900 seconds and never exceeds intent expiry. The
attempt stores its entire immutable snapshot, capability. Neither a
compiler receipt nor host parameters can enlarge these values.

## Completion transaction

1. Assert and lock the configured active owner; follow the existing canonical
   lock ordering before request/proposal locks to avoid cross-route deadlock.
2. Verify the exact attempt identity, claimant, token, version and candidate.
   A terminal replay reads its committed result only; it never executes merge.
3. Confirm current intent patch/scope/route, cancellation, owner and deadlines.
   Recheck the locked release enabled flag and immutable compiler
   manifest against the attempt. Disabling or replacing the capability during
   a lease blocks completion. Capture and recheck the owner authorization revision
   so revoke/re-enable cannot revive an old delegated attempt.
   Changed patch/scope is superseded. Changed canonical snapshot requeues with
   fresh review required. Expired/cancelled requests never merge.
   Both v2 and v3 finalizers must serialize on the shared proposal lock; a proposal
   already resolved by either route cannot receive a second terminal decision.
4. Validate the source receipt and finding schema independently in SQL. Every
   source record must have matching stable-JSON SHA-256 and read/revalidation
   timestamps in this lease. Every target needs all three semantic criteria.
   The database verifies structure/identity, not whether a model truly read.
5. Independently reconstruct the allowed catalog addition in SQL using the
   exact owner-delegated patch and scope. Validate existing v4 history before stripping it
   for any legacy helper. Compare every plan field and receipt identity/hash;
   reject extra fields, arbitrary metadata changes and compiler substitution.
6. Recheck wall-clock expiry immediately before the canonical write. Execute
   only the existing scoped merger plus the independently reconstructed catalog.
   Capture before/after and unchanged outside-scope rows under table locks;
   roll the entire transaction back on a trigger or scope violation.
7. Persist a separate agent_rule_review audit with visual_qc_performed=false.
   No owner_direct_rule, human QC, approved baseline or media evaluation record
   is manufactured. Mark request merged in the same transaction.

The public result exposes sanitized status, scope and actionable blockers, not
lease tokens, request packets or private source bytes. A network-uncertain
completion is reconciled by read; it is not blindly retried as another decision.

## Required executable tests before readiness

- Two concurrent claims: one winner; live foreign lease untouched.
- Expired lease reclaimed: old token/version cannot complete.
- Simultaneous repeated completion: one audit and one canonical addition.
- Same handoff idempotency key: exact replay succeeds; altered payload conflicts.
- Owner revocation, cancellation, intent/lease expiry while waiting for locks.
- Patch/scope/target/dependency/trigger drift and wrong compiler manifest.
- Missing source/finding, prior-attempt receipt, future timestamp, fake visual QC.
- Full SQL/Node parity for general creative rules and both regression fixtures and a second v4 addition.
- Mirror provenance drift, removed/additional history and malformed old layers.
- Trigger changes outside scope roll back proposal, catalog and audit together.
- Disabled capability and missing release never fall through to a privileged path.
- Release disable/replace, owner revoke/re-enable and compiler change during lease.
- Competing v2/v3 completion for the same proposal: exactly one canonical decision.
- Old v2 tests remain unchanged and pass; no pending/v2 request auto-enqueue.

## Rollout gate

Compiler/readers PR91 is a prerequisite, not activation. Server transactions,
UI/API, CI parity/race tests, immutable source manifest and scheduler protocol
require independent review. Approve actual production migration/permissions and
release activation separately. Verify compatible readers first, then enable the
reviewed immutable compiler release. Retain v4 readers during rollback unless
an explicit audited data rollback removes all v4 catalogs.

## Current prototype boundary

The SQL files under tests/sql/prototypes implement inactive storage, snapshot,
handoff, claim, completion, status and cancellation. Public facades have all
EXECUTE privileges revoked. They are outside production migrations. Compiler
regressions run locally; SQL parity and concurrent transaction tests require a
disposable PostgreSQL execution and independent review. No production grant,
release activation or scheduler change has occurred.

## Runner and explicit coordinated rollout

The existing scheduled automation remains pinned to its v2 commit and RPCs; it
cannot process this new queue. Deploying the UI alone is therefore insufficient.
A reviewed v3 host must use uid_rule_review_v3_claim(owner,'dot'), read the entire
immutable rule context and source records, perform genuine AI semantic review,
re-fetch/re-hash those records inside the lease through the exact-token
uid_rule_review_v3_revalidate read RPC, and run the released Node24 CLI.
Before importing its bundle, independently verify the CLI SHA-256 and all nine
source_manifest files against the exact reviewed release commit. Attach the
unaltered COMPILED plan/receipt only after that real execution. Complete through
uid_rule_review_v3_complete with the exact returned attempt identity. Missing
facts or conflicts receive a truthful blocked review. No baseline or media QC
receipt is invented. An uncertain write is reconciled with status before retry.

Rollout requires a single reviewed release containing compatible readers,
transactions, authenticated API/UI and executable parity/race tests, followed by
explicit approval of any new persistent execute privileges and compiler release.
Then update the scheduled task's exact source commit/hash/RPC instructions to
consume v3 intents separately from v2 outcome-QC intents. Existing intents keep
their original route and semantics. Verify one newly delegated test intent end
to end before describing automation as operational. Until then this is inactive
implementation, not a completed automatic review service.

### Database compatibility validation

The inactive CI workflow runs independent PostgreSQL 16 and 17 service jobs
with fail-fast disabled. Both execute foundation assertions, real compiler/SQL
parity and multi-client race tests. The harness verifies the actual server major
against the matrix and logs the full server version; a green PG16 job cannot
stand in for PG17. These are disposable upstream PostgreSQL services, not a
claim of full Supabase platform parity or exact PostgreSQL 17.6 patch parity.
No database test result is established until those jobs actually execute.
