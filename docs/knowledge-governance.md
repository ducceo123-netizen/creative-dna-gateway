# UID Brands Knowledge Governance — Phase 1 (advisory)

The Admin Feedback queue displays read-only evidence prioritization and potential near-duplicates, grouped by brand and branch. This **does not** approve, reject, consolidate, delete, or mutate canonical knowledge.

## Evidence assessment
Five signals are scored: evidence metadata/attachments (30), product-truth references in feedback (25), declared scope (20), possible duplicate consistency (15), and impact/detail (10). Scores are heuristics used to prioritize human review, **not verified factual correctness**. In particular, mentioning "PDP" does not prove a claim. All candidates require manual product verification.

## Review sequence
1. Inspect source URL, SKU truth, original output and reference images; request missing evidence.
2. Distinguish task-specific preferences from reusable rules and constrain Brand / Material / Element / Niche.
3. Compare suspected duplicates and contradictions with canonical rules.
4. Before merging an accepted proposal, evaluate before/after on fixed representative briefs; block severe fidelity or content regressions.
5. Merge only through the existing explicit admin process; version and roll back using existing controls.

## Not implemented
Automatic contradiction detection against all canonical knowledge, automated image-based evidence verification, regression test harness or database version rollback are **not part of Phase 1**. Those require access to canonical datastore and a curated baseline. Do not interpret the score as a permission to merge.
