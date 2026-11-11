# Workspace EO validation

## What was actually checked

The offline evidence auditor is `scripts/quality/uid_eo_audit.py`. Its 15 adversarial tests check hashes, decoded raster dimensions/formats, CRC, unsafe archive paths, stale approval/history, missing visual evidence, and preservation of unselected bytes. It never returns EO parity true, never assigns an artistic score, and does not trust a model's claim as independent visual evidence.

Three historical user-approved GTK collection packages were privately retrieved and inspected. Each contains 19 CRC-valid files: 18 fully decoded WebP images plus a PNG mapping. All 18 actual assets in each were viewed in contact sheets. Approval was checked against the latest visible source conversation branch, not inferred from a filename. Private files and provenance manifests remain outside the repository.

These are historical artistic references, **not current-canonical release goldens**. All three mobile banners contain supporting/tagline text that conflicts with the current title-only rule. Historical model, canonical, template and source-image byte pins are unavailable. Original pre-revision asset bytes have not been compared, so claimed unchanged-asset preservation is not certified. The three reference intake reports correctly return `INCOMPLETE` with 37 missing evidence categories and no fabricated candidate output.

A recent multi-product package request was not admitted as a golden because later feedback rejected quality. A final-package instruction alone is insufficient when later corrections exist.

## Release evidence still required

- One actual API-generated candidate per current canonical branch, including single PDP and FAQ, under authorized project/model/cost settings.
- Byte-pinned product/source captures and actual source-product pixel inspection, not scraped prose alone.
- Exact policy, template, model, provider, prompt/research and approved-content pins for each candidate.
- Desktop, mobile, and 798/799 breakpoint captures of actual rendered candidate assets.
- Independent product truth, supported claims, canonical layout, typography, continuity, composition, anatomy, scene diversity and revision-preservation review.
- User acceptance tied to the exact candidate bytes; follow-up corrections checked within a stated evidence scope.
- For scoped revision tests, byte-identical unchanged slots and independently reviewed changed slots.

Technical package validation and deterministic DOM/template checks are necessary but do not prove semantic or visual quality. An inventory generated from an archive is an inventory, not a normative slot manifest. Production admission must compare it against the pinned canonical expected slots and dimensions.

## Run the offline tests

`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=scripts/quality python3 -m unittest discover -s tests -p uid_eo_audit_test.py`

The auditor reads a private case manifest and returns FAIL, INCOMPLETE, or EVIDENCE_COMPLETE_REQUIRES_REVIEW. Even the latter requires independently checking reviewer statements and provenance. No credentials or provider calls are involved.
