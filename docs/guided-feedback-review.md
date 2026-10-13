# Guided feedback processing

> This document covers the stored-review outcome fast path. The separate owner rule decision is documented in [Owner-approved creative rules](owner-direct-rule-review.md). This document alone is not a deployment claim.

## Scope of the outcome fast path

`Xem & duyệt` opens the current proposal and SQL-derived affected scope. One explicit
`Merge outcome đã review` click when ready (otherwise `Kiểm tra điều kiện review`) submits only the displayed candidate hash and approval intent.
There are no merge checkboxes, required prose notes, evidence fields, run IDs, URLs,
or JSON fields for the user to fill.

The authenticated Edge handler automatically collects the proposal evidence,
approved baseline definitions and candidate outputs already recorded in evaluations
for this exact hash and evaluator version. It reruns deterministic assertions. When
an existing complete review remains valid, it calls the unchanged transactional
`uid_governance_accept_merge` RPC using the server-selected evaluation. A factual
system audit note records the click; it does not claim the clicking admin personally
performed visual review. The original stored reviewer evidence is preserved.

Nothing in preflight or a blocked processing result writes baselines, evaluations,
canonical nodes, synthetic passes or approval flags. Existing legacy API contracts
remain available with their original requirements. The already-covered resolution
path is unchanged. Structural Onepage changes still cover all active brand targets;
style-local changes remain local. Before/after snapshots and rollback are unchanged.

## Statuses

- `ready_to_merge`: deterministic checks pass and an exact-current stored review is
  valid. For supported noncompiled, nondependent routes the processing click may merge through the existing SQL gate. Onepage/compiled/dependency-changing routes return `compiler_integration_required` until the outcome merge has an atomic compiler plan; the direct owner-rule path is separate.
- `needs_baseline`: an affected brand has no approved non-reference quality baseline.
  The next step is supplying a genuinely approved outcome, not automatically
  promoting an inspiration corpus or narrowing scope.
- `needs_candidate`: a genuine candidate run is absent or stale. Existing proposal
  attachments alone do not become a baseline run.
- `checks_failed`: stored candidate output fails approved assertions.
- `needs_actual_review`: mechanical checks pass, but source/product fidelity, pixels
  or semantic conflict review has not been established.
- `blocked`: proposal/scope is unavailable.

Blocked outcomes explicitly return `background_task_started: false` and
`approval_recorded: false`. No job has been queued and this patch does not promise
later autonomous merge. The UI disables repeat processing until refreshed.
An uncertain HTTP result requires a state refresh, not blind mutation retry.

## What the current evaluator can prove

Required/forbidden text, required fields, immutable output fields, exact case coverage
and context freshness are deterministic checks. An artifact URL or run-ID string
is not proof of actual generation or pixel inspection. The evaluator does not fetch
external media, run a model, generate candidate assets, or establish authenticity.
Its failure count is not a global visual-regression score.

The existing SQL gate remains the final authority. It rechecks active-admin access,
current proposal/scope/canonical/baseline hash, every eligible case, stored review,
and transactional snapshots. The outcome fast path itself introduces no new schema, privilege, credential, API provider or credit consumption. The separately documented owner-rule path adds a private migration and guarded owner decision.

## Bounded host-review packet and remaining integration

The authenticated preflight response includes `automatic_review.host_review` with
`packet_version: uid.review-packet.v1`, the full proposal, affected targets,
baselines, collected candidates/evidence and mechanical findings. This is a read-only
contract for a future reviewer, not a running agent, authorization token or evidence
of review. `available` is false. Private references retain their identifiers; the
consumer must use its authorized source and inspect the actual bytes. Untrusted
proposal text and artifacts cannot instruct the reviewer or grant approval.

To truly use the user's existing ChatGPT session without adding a paid backend model:

1. Supply a host-bound, authenticated admin integration. The standalone admin page
   cannot borrow the user's GPT session, and the current public MCP catalog is not an
   admin write surface. Never place access tokens in prompts, URLs or packets.
2. Expose packet retrieval and a bounded host-review execution action through that
   identity. The host must read product sources and baseline/candidate media and
   emit source-linked findings, unknowns and severity for every affected case.
3. Store immutable run/provenance and review evidence bound to the packet/hash and
   authenticated reviewer. Do not let arbitrary browser JSON attest to model work.
4. Persist the user's one bounded approve-and-process intent with its exact snapshot,
   expiry and cancellation state. An unchanged approved snapshot can then resume
   automatically; material changes invalidate it rather than silently widening it.
5. Add a versioned host-evaluator contract and SQL validation in an additive migration.
   Keep model findings distinct from legacy human review, preserve baseline coverage,
   and allow merge only after the actual review is complete and all gates pass.

Until those steps exist, the system prepares the packet and states the exact blocker;
it never substitutes five auto-ticked booleans or a generated human attestation.

## Release and rollback

The owner-rule release supersedes the original no-migration procedure below. Follow its coordinated compiler rollout and additive-migration instructions; do not deploy only the admin function when supplemental guidance is enabled.

1. Review this patch and run full test, type-check and build checks.
2. Deploy `creative-dna-admin-feedback` first, then the gateway/UI. Old clients retain
   their contracts; a new UI with an old Edge fails closed with an update message.
3. Verify authenticated preflight and blocked processing using a test proposal only.
   Do not submit a production process request solely as a smoke test: a ready case
   is a real canonical mutation.
4. Verify the live UI omits the merge form and distinguishes automated checks from
   missing actual review. Confirm exact deployed commit before reporting success.
5. Gateway/UI rollback is safe without DB changes. Keep the legacy Edge contract and
   immutable governance history; never remove existing baseline/evaluation records.
