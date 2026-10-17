# Owner-direct rule additions on schema /4

The owner-direct Edge endpoint uses `buildCompatibleOwnerRulePlan`. Existing
/1–/3 inputs retain the exact prior planner output. Existing /4 catalogs are
validated in full, checked for original master/mirror and projected metadata
identity, projected through the unchanged structural planner, restored with all
prior delegated-rule provenance, then compiled in full again. Full original and
proposed bundles must fit the existing 100,000-character cap.

The SQL catalog planner independently reconstructs the same addition. It
validates all three existing provenance layers, combined capacity/collisions,
canonical text bindings and current source hashes. It retains /4 and appends only
an `owner_direct_rule` supplement. Existing owner authorization, locks, candidate
hash checks, immutable audit, idempotency and rollback remain authoritative.

No v2/v3 pinned source file, compiler release, queue intent or permission changes.
The existing `visual_qc_performed: false` and supplemental precedence remain.

Deploy the migration and the scoped `creative-dna-admin-feedback` Edge graph.
Keep its existing authentication settings. Obtain a fresh owner preflight and
compile/accept against its current hash after deployment; never reuse an old
candidate or force a failed plan. Verify canonical metadata and the public
runtime output after acceptance. This does not update previously rendered media
or certify output QC.

Tests: `node --import tsx --test tests/owner-rule-compatible-plan.test.ts
 tests/uid-owner-rule-edge.test.ts`; `tests/sql/uid_owner_rule_v4.mjs` runs against
a disposable PostgreSQL database or an explicitly supplied temporary PGlite
module. Fixtures are synthetic; no production packets are committed. Existing
SQL governance suites continue running on PostgreSQL 16 in CI.
