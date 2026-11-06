# Onepage stage routing and offline benchmark policy

Implemented in `uid-workspace-routing.ts`; executable offline coverage is in
`tests/uid-workspace-routing.test.ts`. This is an isolated policy/evidence evaluator,
not a runtime adapter. It is not imported by the server, runner, browser app,
transport or budget module. No calls, credentials, pricing configuration, model
switch, deployment or paid benchmark were made.

## Routing recommendation

| Work | Conservative implementation plan | Candidate to measure |
| --- | --- | --- |
| Canonical byte/version binding, fixed slot mapping, template validation, packaging | Deterministic code | Same code |
| Source image extraction and product-photo matching | Sol with actual images required; **blocked** by current text-only transport | Terra medium with the same actual image bytes |
| Creative synthesis and copy | Sol medium, text transport implemented but not authorized/enabled by this policy | Retain Sol medium |
| Image generation/editing | Separate image provider; **blocked** pending transport and image-aware accounting | Keep the identical verified provider/model/configuration across arms |
| First independent visual/semantic QC | **Blocked** pending actual-image transport, independent provider and child paid-operation journal | Terra medium, independently bound to source/output bytes |
| Hard source/rule ambiguity and reviewer disagreement | Sol high; actual images mandatory for visual ambiguity | Sol high, without widening a scoped edit |

These are hypotheses, not measured superiority. The API capabilities of both Sol
and Terra include image input and text output. The **implemented** Responses
transport accepts only a string and hardcodes `gpt-6.1-sol`; its budget ledger is
Sol-text-only. Renaming a model does not add image input. Both models' text output
is separate from image generation. The source acquisition provider fully decodes
images but explicitly has not performed visual or semantic inspection.

`planWorkspaceStageRouting` accepts only stage, plan mode and a flag that can
require additional visual evidence. It rejects model/capability/budget overrides.
Visual stages cannot be downgraded by setting that flag false. It returns exact
missing-code blockers, no automatic fallback, and `authorization_granted: false`.
“TEXT_TRANSPORT_IMPLEMENTED_NOT_AUTHORIZED” means code compatibility only. All
existing project capability, data permission, budget, reconciliation and startup
gates remain necessary. The benchmark mode is not a way to execute another model.

## Benchmark intake and comparison contract

`WorkspaceRoutingBenchmarkSchema` is a strict Zod schema. Parse private evidence
with it, use `workspaceBenchmarkInputHash(shared, inputCase)` for the input pin,
then call `evaluateWorkspaceRoutingBenchmark(manifest)`. Unknown fields and invalid
version identifiers fail closed. No function fetches evidence or submits work.

Required arms:

1. **Current workflow baseline:** provenance for the user's actual Onepage workflow,
   not a model-name label and not an assumed equivalent of the new text adapter.
2. **Sol vision control:** Sol plus actual image inputs.
3. **Terra stage candidate:** the proposed stage split with the same actual images.
4. An optional **Sol text diagnostic** remains separate. It cannot replace either
   the current workflow baseline or the Sol vision control.

Before running anything, register the case inventory, replicates, fixed rubric,
blind-review protocol, quality dimension and required positive gain, cost ratio
and p95 latency limits. These thresholds are deliberate experiment decisions, not
measurements or vendor claims. The schema's 0–5 quality scale defines a common
rubric; example/test scores do not describe actual UID output.

Every arm must have every registered case/replicate, including failures. The
shared input pin covers exact source text and actual image hashes, dimensions,
byte sizes, pixel-inspection evidence, current canonical/title-only rule, template,
prompts, research protocol, rubric, image provider/model/configuration and seed
scope. Record a fixed seed only when the provider supports it. Otherwise record
the provider's lack of seed support and plan adequate repeated trials; identical
inputs do not prove deterministic image generation. A source URL or image filename
is not sufficient evidence.

Suggested case inventory: single PDP, collection, GTK, FAQ, conflicting sources,
small product details, mobile title-only and scoped revision. The experiment owner
must choose representative cases and sufficient repetitions; passing the small
unit-test fixture is not a sample-size or statistical-confidence argument.

Historical approved GTK references can appear only as `art_direction_only`.
Their mobile supporting/tagline text conflicts with the current title-only rule;
they are not unconditional release goldens. Current canonical/template pins win.

## Review and accounting requirements

For each completed output, automated and human review must bind both the exact
payload hash and artifact-manifest hash. Independent review additionally binds
the source input and actual desktop/mobile/breakpoint captures. The reviewer must
not be one of the generating actors; a separate invocation alone is insufficient.
The independent QC invocation must link to its own recorded completed paid
quality-review operation. The human is separate from both generator and automated
reviewer. Blind labels are unique and cannot expose an arm identifier, with a
verified protocol covering randomized presentation and hidden provider identity.

The caller must reconcile the complete durable paid-operation journal, including
failed submissions, retries, image generation and QC. Each operation has exact
request identity, provider/model, attempt chain, current pricing/usage evidence,
reservation and settlement receipt. Unknown/held outcomes make total cost and
cost per accepted output **null**, never zero. Retrying an unknown or successful
operation is rejected; a retry must follow a settled known failure in the same
request/provider/model chain. No operation or review invocation can be reused
across runs. The manifest's journal completeness statement must be checked
against the actual journal, not inferred from the presence of a hash or boolean.

Reported metrics include:

- Total settled micro-USD, known spend, held reservations, category breakdown,
  and total spend divided by accepted outputs. Failed/retried work is charged.
- End-to-end time from task submission through completion, including queue,
  generation, QC and rework. Raw run durations plus p50/p95 use nearest rank.
- Blinded human acceptance, failed/critical-run rate, rework rate/rounds, retries,
  and research usefulness, product presentation, composition and typography.

This schema does not itself verify provider bills, image bytes, journal completeness,
timestamps, current baseline provenance, reviewer independence or a claim of
blinding. Trusted offline evidence review must open and verify all referenced
records. Forged metadata cannot be made trustworthy by the evaluator.

## Admission logic

Any candidate product-truth, claims, current-canonical, template, mobile-title or
scoped-revision hard failure vetoes the result. Higher scores, speed or savings
cannot average it away. Missing evidence blocks evaluation. Failures stay in the
denominator; they cannot be dropped as inconvenient samples.

The candidate must not regress against **either** the current workflow baseline
or Sol vision control on paired human acceptance, any paired quality dimension,
failure rate or rework. It must also achieve the preregistered positive mean gain
in a quality dimension over the current workflow baseline. Cost savings or parity
alone do not satisfy the user's requirement that Onepage become better. Only after
those checks do the preregistered total-cost and p95-latency guardrails apply.

The strongest result is `BENCHMARK_CRITERIA_MET_REQUIRES_REVIEW`, never “EO passed”,
“objectively better”, or automatic promotion. `promotion_authorized` is always
false. A measured candidate still needs independent verification, user acceptance
of exact artifacts and separately reviewed executable provider/budget code.

## Verified model documentation

Official sources checked on 2026-11-06:

- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6.1-terra
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/image-generation

API reasoning efforts: Sol low/medium/high/xhigh/max; Terra additionally none.
Medium is the documented default. Do not infer an API `ultra` effort from a
different product's configuration. The vision guide does not establish model-
specific Terra/Sol image-sizing/token multipliers, so this module contains no
invented per-image rates, token ceilings, quality rankings or latency estimates.
Documentation does not prove this project's model access. Runtime pricing must
remain verified, expiring server configuration, not permanent benchmark constants.

## Offline verification

`node --import tsx --test tests/uid-workspace-routing.test.ts`

`npm run lint`

All fixtures are explicitly synthetic. They test failure gates, identity, pairing,
accounting and arithmetic only. No paid experiment or real EO comparison has run.
