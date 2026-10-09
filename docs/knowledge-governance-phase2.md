# UID Brands Knowledge Governance — Phase 2

## Enforced at Gateway

The Admin `Accept` and `Merge` endpoints now fail with HTTP 422 unless the submitted review contains evidence identifiers, regression baseline identifiers, a meaningful review note, and explicit confirmation of product truth, scope, canonical-conflict inspection, and before/after comparison with zero severe regressions.

**The gate does not independently verify those claims.** It is a mandatory human-attested checklist, not an automated regression runner. The upstream canonical datastore and any independent merge paths must also enforce this requirement before it can be considered a global merge lock.

## Required next integrations for automated regression

- Curated, immutable approved outcome baseline dataset with stable IDs
- Controlled candidate/baseline generation runner and artifact snapshots
- Comparison of product fidelity, factual claims, section correctness, image quality and cross-brand effects
- Authoritative canonical knowledge snapshot, semantic conflict detection and rule versioning
- A transactional upstream pre-merge check, audit log and rollback mechanism

Until those integrations exist, all checks require documented human validation. Never interpret a scored proposal or checkbox as proof of output quality.
