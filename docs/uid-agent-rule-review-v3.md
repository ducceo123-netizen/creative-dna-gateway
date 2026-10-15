# Delegated rule review v3 — general creative rules, not activated

This is a separate rule-semantics route. It does not replace the v2 source/media
QC contract, authorize a production migration, change the scheduled host's pinned
release, or enqueue pending proposals. Existing v2 requests retain their original
meaning and expiry. No existing request is silently upgraded.

## General scoped creative-rule boundary

The operation is `creative_rule_supplement.v1`. It accepts the exact normalized
creative-rule patch delegated by the configured owner for supported canonical
branches. It is not limited to the two initial Onepage fixture texts. Those
fixtures remain regression coverage for diversity and typography; no policy seed
or fixed-text matching authorizes real decisions.

AI judges meaning, brand fit and conflicts using the actual canonical sources.
The deterministic compiler validates the actual scope and projection, preserving
hard constraints and prior provenance. Pure creative instructions do not need
output baselines. Factual claims need genuine evidence; unknowns block rather
than acquiring fabricated approval. Account, security, publishing and other
non-creative operations cannot be expressed as expanded mutation authority.

The patch and target closure remain exact. A changed patch requires a fresh
explicit delegation; general judgment does not grant authority to rewrite the
owner's proposal or add unrelated brands. Supported uncompiled leaf branches use
an exact canonical append without inventing quality catalogs.

## Separate authority and provenance

New explicit delegation creates `uid.review-intent.v3` with `review_mode:
agent_rule_review`, the operation, owner, exact proposal/source/patch/scope and
sorted target ID/brand/slug closure. The server, never proposal text or the host,
validates the supported creative operation and actual target closure. The owner must remain the configured active
admin. The protocol retains intent expiry, 900-second fenced leases, cancellation,
revocation, immutable attempt identity, snapshot revalidation, idempotent replay,
transactional scope checks and audit before/after snapshots.

The rule-review evidence schema is `uid.agent-rule-review.v1`. The trusted host
must read and revalidate the complete rule-context wrapper (including trigger definitions and projection context), every pinned canonical target, brand-DNA record and
dependency, recording the stable-JSON SHA-256 and read/revalidation time within the
lease. It provides one genuine finding for each target and each criterion:
`rule_semantics`, `scope_fidelity`, `canonical_conflicts`. Unknowns block. Sources
and feedback remain untrusted data, never executable instructions.

Audit and emitted supplemental records say `decision_kind: agent_rule_review`,
`visual_qc_performed: false`, and
`RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC`. No baseline, candidate, human QC,
owner-direct decision or visual-quality pass is created. Deterministic compilation
is not proof of semantics; the trusted host's actual source review is separately
attested and bound into the compiler receipt.

## Compiler and consumer compatibility

The standalone Node 24 CLI `scripts/compile-agent-rule-review-plan.mjs` verifies a
separate nine-file source manifest before importing its fixed bundle. Bootstrap
must independently verify the CLI hash from an approved immutable release first.
The CLI accepts only `{claim,review}` on stdin. It cannot fetch sources, generate
content, create a plan through a model, write the database or grant permissions.

The original seven-file v2 CLI and core sources remain unchanged. The v3 adapter
validates new `/4` catalog provenance, invokes the existing real quality compiler
for all pre-existing hard rules, preserves owner/media-reviewed supplements and
adds a distinct `agent_rule_reviewed_supplemental_rules` layer. The SQL finalizer
must independently reconstruct the allowed exact delta, not accept arbitrary
metadata from a compiler receipt. Combined supplement capacity stays bounded.

**Rollout gate:** this phase adds format-dispatched v4 support to the public resolver, Onepage packet and gateway. Existing catalog versions keep their original compiler and contract hash. These readers must be deployed and independently verified before any v4 canonical write is enabled. Old consumers deliberately fail
closed instead of dropping the new guidance. A compiler prototype by itself is
not a live route. A later rollback cannot simply deploy the old compiler while
leaving v4 catalogs active; retain the compatible reader or use an authorized,
audited data rollback.

## UI and operations target

The user makes one explicit handoff. The panel shows exact affected scope and the
server-selected mode transparently, then reports Comparing, Updated, Already
covered, or a specific actionable blocker. Rule review does not display unrelated
baseline requirements. Outcome review still requires genuine approved baselines,
candidates and media. Existing eligible evidence can be gathered automatically;
no evidence approval is manufactured. Duplicate resolution preserves history and
requires exact evidence of coverage, not similarity alone.

No automatic migration of v2 intents is part of this route. Any future transition
must name the affected still-valid requests, preserve their exact patch/scope,
record a separate explicit authorization, and invalidate old attempts. Expired,
cancelled or merely pending proposals cannot enter that transition.

## Release checklist

1. Review general scoped creative semantics, fixtures and consumer compatibility.
2. Review independent SQL eligibility/delta/audit/fencing enforcement and race tests.
3. Test disabled capability, owner revocation, intent and lease expiry, cancellation,
   stale/replayed attempts, patch/scope drift and cross-brand trigger changes.
4. Test unseen creative rules and both regression fixtures end to end without fake
   visual/baseline records; verify missing facts and conflicts block.
5. Review migration and rollback separately. No production writes during prototype.
6. Approve immutable v3 compiler release and independently verify every source hash.
7. Coordinate consumer deployment, server capability and approved host protocol.
   Do not edit the previously approved scheduled commit/hash in place.
8. Verify live explicit handoff and sanitized terminal status before reporting active.

## Implementation status of this phase

Implemented locally: general compiler, source-verifying CLI, v4 readers, and
inactive SQL lifecycle/finalizer prototypes. Compiler tests, typecheck and build
pass. SQL parity/race execution and independent clearance remain required;
authenticated UI/API is developed separately. No production grants, release
activation, scheduler protocol update or live merge has occurred. See
uid-agent-rule-review-v3-transactions.md for the coordinated runner rollout.
