# Covered-feedback resolution: database rollout and rollback

## Scope and trust boundary

Migration `20261012045507_uid_governance_covered_resolution.sql` adds a terminal
`resolved` review outcome and immutable JSON audit. It does not update existing
proposals or canonical nodes. Resolution deliberately emits no training events,
canonical snapshots, or merge timestamps. Existing compiler paths continue to use
canonical nodes; a resolution is never an accepted/merged proposal.

The review context and write RPCs are service-role-only. The Edge Function must
validate the signed-in, active admin before forwarding its authenticated user ID.
No browser actor ID is trusted. No credentials, table grants, or anonymous/
authenticated function privileges are added. Private SQL helpers have no service
or client EXECUTE grants. Existing proposal RLS permits team SELECT only, so a
browser cannot fabricate the initial resolution via table INSERT/UPDATE.

The database independently validates active admin membership and locks it for the
transaction. Pending and covered proposal rows are locked in stable order.
Knowledge-node table and row locks prevent target edits and target-set phantoms;
baseline/brand table locks prevent concurrent evidence, approval, and scope-name
changes. These short admin transactions temporarily serialize canonical writes.
A concurrent legacy rollback may cause a detected PostgreSQL deadlock; the entire
transaction is aborted safely and the admin should refresh/retry. Do not retry
blindly after an uncertain response: identical covered-reference retries are
idempotent and return the original audit, without changing the note or timestamp.

Coverage means the entire legacy merge text, using the existing merge's
`btrim(coalesce(proposed_content_md, raw_feedback, ''))` semantics, appears exactly
on every current active target. It is not a semantic equivalence judgment. The
admin's note records why the new feedback is covered. Freeform scope text is
retained; compatibility is established by source branch, structural/local scope,
and identical affected node IDs. Empty proposed content does not silently fall
back to raw feedback when the legacy merge would reject it.

## Order and verification

1. Run the disposable SQL regression suite and normal application tests.
2. Independently review the migration and RPC/Edge/UI contracts.
3. Apply the additive migration through the normal approved release process.
4. Deploy the matching Edge Function and UI. Older evaluations intentionally stop
   working: the new identity starts with `scope-v2:` and the evaluator version is
   `mechanical-v2-scope-freshness`.
5. Read the context of a pending proposal and verify target brands, full canonical
   text, covered history, and baseline availability. This read is not permission
   to resolve a production proposal.
6. If an admin explicitly resolves a covered proposal, verify `status=resolved`,
   `merged_at IS NULL`, retained audit evidence, and unchanged canonical hashes.

The fingerprint covers complete proposal/source/target snapshots plus every
approved applicable baseline's content and approval metadata. UI context also
returns unapproved relevant baselines, but they cannot qualify. Bounded-reference
corpora are reference-only and cannot replace genuine candidate-quality regression
cases for each affected brand. SQL rejects legacy, stale, duplicate, incomplete,
corpus-only, or unattested passed-looking evaluations. Actual candidate output,
run/artifact identity, and explicit administrator attestations are required.

## Safe rollback

Prefer disabling the new UI actions or rolling back application/Edge code while
retaining this additive schema. Leave `resolved` and the audit column/trigger in
place. Resolved rows stay out of the old pending/merged workflow. Never convert a
resolution to `merged`, erase its audit, set `merged_at`, or replay the old merge.
A new review should create a new proposal. Deleting either a resolved proposal or
its linked covered source is intentionally blocked, including bulk deletion.

If an emergency requires disabling the new resolver, revoke its service-role
EXECUTE grant in a separate reviewed migration; retain the read context, audit,
status constraint, and preservation trigger. Do not downgrade the strengthened
merge RPC or hash to the previous content-only version. Do not drop `resolution`
or remove `resolved` from the status constraint. No destructive down migration is
provided because it would discard review evidence or misclassify completed work.

## Local / CI SQL verification

The fixture is for a new disposable PostgreSQL database only. Never load it into
production or an existing project. It creates synthetic roles/tables and the
legacy merge dependency. In PostgreSQL 16 CI:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/governance_fixture.sql
for migration in supabase/migrations/*.sql; do
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/governance_covered_resolution.sql
```

The tests execute SQL functions and permissions, then roll back their test data.
They cover all-target exact presence, branch/local scope, reference-only baselines,
17 proposal/node/baseline freshness mutations, authorization failures, immutable
and retained audit, repeated/different-reference retries, zero canonical writes on
resolution/failure, 23 malformed or stale evaluation cases, and a successful
service-role-admin genuine merge with complete before/after snapshots. A local
PGlite 0.5.8 run additionally verified the migration and all SQL assertions. PGlite
is single-connection; real concurrent lock scheduling is not exercised there.
