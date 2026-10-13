# Owner-approved creative rules

## User flow and authority

`Xem & duyệt` shows the proposed canonical text, current canonical text and the complete SQL-derived affected scope. The owner sees the effective supplemental guidance and clicks `Duyệt rule & merge ngay` once. No baseline image, checklist, note, run ID, artifact URL or taxonomy form is required for this deliberate rule decision.

This path records `decision_kind: owner_direct_rule`, with `visual_qc_performed: false`. It does not create a passed evaluation. Owner acceptance decides that the proposed creative guidance should be adopted. Deterministic validation covers supported structure, exact changes, scope, freshness, protected existing fields and narrowly detectable conflicts; it does not prove every semantic conflict has been resolved or any image meets a quality standard.

The outcome-processing action remains separate. On noncompiled, nondependent branches it may reuse a genuinely complete current stored review and merge immediately through its original gate. Onepage, compiled targets and dependency-changing routes are blocked in both the guided outcome path and the legacy SQL outcome merger until an atomic compiler-plan wrapper is available. A genuine stored human review remains valid evidence; the blocker is missing safe compiler integration. Missing real outcome evidence remains blocked. The separate hourly agent-review queue is not part of this release and no background review is dispatched by this button.

## Effective supplemental guidance

There is no prose-to-policy compiler. The original structured catalog rules and references are preserved, rather than mapping free-form prose to invented taxonomy keys. A versioned `owner_supplemental_rules` array within each `creative_quality_contract` brand bundle carries the exact canonical proposal text, declared and resolved scope, proposal/decision provenance, source hashes and explicit precedence.

The owner identity remains only in private configuration and audit, never in public supplemental metadata or runtime output. A supplemented stored bundle uses schema `uid-creative-quality/2`; prior compilers reject that schema instead of silently omitting guidance. Unsupplemented `/1` bundles remain supported. The shared compiler validates the supplemental representation and emits it in the effective contract. The Onepage packet emits its corresponding supplemental guidance as well. Existing catalog constraints, product truth and Brand DNA take precedence. Supplemental text cannot waive those constraints, change credentials or permissions, approve assets, publish a campaign, or turn into a visual QC pass. Unsupported/malformed or source-drifted supplements fail closed.

Supplemental metadata is inside the already excluded catalog envelope, avoiding a self-referential branch source hash. It still participates in the emitted contract hash. Unrelated metadata is not excluded. The source-hash refresh is permitted only together with the exact approved canonical appendix and validated supplemental addition; a hash-only refresh is rejected.

## Supported scope

- Structural shared Onepage rules: the actual PawfectHouse master and all GiftSoul/SoulPrise mirror rows, including inactive rows, are included in the read/guarded scope. Final compiler reconciliation writes only the master; the existing merge primitive may visit mirrors internally, after which the exact single-append master plan is restored and the known trigger computes mirrors. All effects are within one locked transaction and verified against the full projected scope. A projection that would alter unrelated fields, reactivate an inactive row, or overwrite divergent mirror data blocks rather than hiding the effect.
- Supported leaf creative-rule targets: require an existing valid brand-keyed quality catalog, explicit projected compiler plan and complete current source context. Uncompiled branches and single-bundle metadata are not currently accepted by this direct path. Read the returned eligibility and blockers; there is no universal arbitrary-node merge permission.
- Local Onepage mirror changes: blocked when current master/mirror synchronization would expand the displayed local scope.
- Brand-DNA and unsupported dependency-changing proposals: blocked until a complete affected-dependency plan exists.
- Product-truth, publishing, asset approval, account/security or other unsupported proposals: excluded from direct rule acceptance.

Missing image baselines are irrelevant to this owner-rule decision, but remain mandatory where the separate outcome-review contract requires them.

## Server and database contract

1. The authenticated admin Edge uses `getUser`, verifies active admin membership and passes only its verified user ID. An additional private owner configuration is required; being another admin does not confer owner authority.
2. `uid_rule_preflight(proposal, actor)` returns proposal, complete target state, rule hash and compiler context from one SQL snapshot. There is no separate hash read that could authorize unseen text.
3. `buildOwnerRulePlan` derives the exact mutation and effective supplemental preview server-side using the real compiler. The UI submits only explicit approval and candidate/rule/plan hashes.
4. On acceptance the Edge reads a fresh atomic preflight, re-derives the plan and compares all displayed hashes. Client-supplied actors, mutation plans and metadata are ignored.
5. `uid_rule_accept` rechecks current owner configuration and active admin membership, locks the proposal and complete scope, validates the exact plan and applies the bounded mutation atomically. Immutable owner decision and before/after snapshots are stored. It does not weaken the outcome QC RPC.
6. An exact same-owner replay returns the original receipt after validating all approval hashes; a conflicting replay is rejected. A malformed or uncertain HTTP receipt requires refreshing state before another mutation. The exact appendix uses the existing UTC merge-date convention; an approval crossing midnight may require an explicit refresh before acceptance.

The private owner configuration, decisions and snapshots are not browser-writable. New privileged functions explicitly revoke PUBLIC/anon/authenticated execution and grant only bounded service-role operations. Existing JWT-disabled Edge gateway configuration is preserved because the handler performs its existing custom authentication; no anonymous write path is added.

## Release procedure

This document describes prepared code, not proof of deployment. A reviewed release must:

1. Run the complete Node test suite, typecheck, production builds and disposable PostgreSQL migration/trigger/concurrency tests. Review exact SQL grants and changed file hashes.
2. Apply the additive migration with the owner configuration empty. An independently reviewed operational seed may enable only the already verified intended owner; never enable every admin or accept a browser-supplied owner ID. Production seeding requires release authorization and is not part of local testing.
3. Deploy every shared compiler consumer with the same supplemental schema support, including `creative-dna-public`, `creative-dna-compile-onepage` and `creative-dna-admin-feedback`, plus gateway/UI. Preserve each function's current auth settings. Do not enable the owner feature while an old compiler consumer could silently discard supplemental guidance.
4. Verify harmless authenticated preflight and owner/non-owner denial behavior. A production accept/process call is a real canonical write and must never be used merely as a smoke test.
5. Confirm the displayed exact proposal, effective text and expanded scope before the owner's real click. Report the saved owner decision, not a QC success.

## Rollback

Before release retain exact deployed source bundles and auth settings. Before any accepted owner rule, application rollback may restore those sources while leaving additive audit tables intact. After an owner rule is accepted, restoring an old compiler blocks `/2` supplemented bundles and therefore stops affected output creation: disable further owner decisions, then use the audited full-scope rule rollback with current-version guards before restoring consumers, or retain the supplemental-aware compiler. Never drop owner decisions, erase snapshot history or silently refresh hashes to make an old contract appear current.

The guarded rollback must restore every field affected by master/mirror propagation, with snapshots for all affected rows. It must refuse conflicting intervening canonical changes. Deployment rollback and canonical rollback are separate operations requiring their respective authorization.
