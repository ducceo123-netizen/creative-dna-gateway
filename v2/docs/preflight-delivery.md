# Delivery/source preflight — read only

Observed 2026-11-27. Repository main `87bf39d1f38eb1d0baee159b921efbd7e3aaf923`; Studio branch `d596ed89756586cb5d6073c5578bcfdfb3a016b1`. All nine handoff documents read in required order. No production data/service writes or repository source changes performed for this audit.

## CI and isolation

Four workflows on main: `gateway-ui.yml`, `governance.yml`, `agent-rule-v3-prototype.yml`, `uid-member-oauth.yml`. Push triggers are scoped to main; prototype has only pull_request; OAuth additionally workflow_dispatch. Jobs install dependencies, lint/build/test, use disposable PostgreSQL, and upload test evidence. No deployment action, webhook, production credential use, or external service mutation found. A push to the new experiment branch does not match these push triggers. This source inspection is distinct from Render auto-deploy verification.

Root scripts: `npm test` uses Node+tsx tests/*.test.ts; lint is tsc; build is Vite and esbuild server bundle. `bun.lock` exists, no npm lock in baseline. Quality tool subpackage locks Sharp 0.35.5 separately. Browser checks use Python Playwright. SQL regression harnesses require disposable DB/PGlite; do not run against production.

## Reuse matrix

| Existing component | Decision | Reason / constraints |
|---|---|---|
| `onepage-ui-template.ts` get/bind | Import unchanged behind V2 adapter | Exact GTK/FAQ HTML/CSS, immutable hashes, strict text/asset slot maps; escapes user text; rejects arbitrary HTML/CSS. No network/write behavior. |
| `onepage-faq-template.ts` | Keep dependency | FAQ v2 `2026-11-11.faq.v2` uses native details/summary expanded for review; GTK current `2026-10-11.v3`. |
| `supabase/functions/_shared/onepage-packaging.ts` | Import path generator and validator | Canonical 18 production WebP slots GTK / 15 FAQ, plus one desktop overall PNG. Exact root and filenames, no extras. Validator itself checks names only. |
| `uid-asset-preflight.ts` + `tools/creative-quality/asset-preflight.ts` | Reuse actual decoder | SHA-256 and full pixel decode via Sharp, 32MiB/32M pixel limits, rejects animation/unsupported images; result explicitly not visual QC. V2 adds canonical format/dimension and revision checks. |
| `scripts/quality/bounded-file.ts` | Reuse local path reads where needed | Rejects traversal, symlinks, nonregular files, mutation during read; no URL fetch. |
| banner/physical/creative QC evaluators | Import unchanged via gates | Deterministic review-report validators, not vision. Bind results to uploaded bytes, current revision and reviewer attestation; never infer inspection from a passed flag. |
| `scripts/quality/fixed_ui.py` | Reference/reuse test helper | Full DOM/computed style capture against approved source at matched viewport/state, including actual image load checks. Not aesthetic proof. |
| Studio `orchestrator.mjs` | Do not port execution | Only 7 coarse stages; max 8 selected images; 11 noncanonical slot labels; truncated research/DNA, default paid model configuration. Does not preserve full canonical workflow. |
| Studio pipeline CAS/snapshot logic | Reuse design / port contract with stronger transaction | Existing PATCH filters task_id+run_id+revision and verifies owner. Snapshot write is separate and can fail after state commit; in-memory stageLocks do not survive restart. V2 needs atomic snapshot/CAS and durable leases in separate store. |
| Studio `zip.mjs` | Selective reviewed algorithm | Bounded store-only ZIP writer/CRC useful, but current filename regex rejects spaces needed by canonical root; no duplicate or reopened-archive validation. V2 must adapt safely and independently reopen/verify CRC, names, image decode and approved hashes. |
| `uid-hosted-review*.ts` / public review pack | Defer production hosting route | Existing artifact publication writes public/reviews. V2 requires private owner-bound artifact delivery; no use of production publisher or URLs. |
| Existing non-Onepage routes | Keep untouched | V2 standalone entry point imports pure modules only. |

## Delivery facts and gaps

The packet defines 19 manifest entries, including three GTK-only slots and ui_mapping_preview. Banner 2560x960 / 720x700; WYL 732x480; detail_main 950x950; details 240x240; occasions 1280x720; GTK 300x300. Icons specify `3x_UI_DISPLAY_SIZE`, so dimensions must be measured from actual canonical rendered CSS, not guessed fixed pixels. Overall specifies full_page.

Template alias mapping is mandatory: occasion_story_01 -> occasion_01; occasion_story_02 -> occasion_02; occasion_story_01_mobile -> detail_main (not a separate output asset). No GTK assets in FAQ mode. Current FAQ native details rows expand for review. Canonical packaging permits exact image entries only, so delivery manifest should be a separate sidecar rather than an unexpected entry inside the production ZIP.

No existing backend fully performs image retrieval, responsive browser render, actual reopened ZIP decode and approval-bound release as one durable operation. Existing scripts correctly disclose what was not inspected. V2 needs this orchestration and explicit receipt linkage; it must not turn metadata into a visual pass.

No creative A/B, generated assets or real visual QC was performed in this read-only audit. Test outcomes will be recorded by root after baseline execution.

Source hashes at baseline (SHA-256):

- onepage-ui-template.ts: c0d39021e1df27e38f323ddd5f466777b6ed17e8f2fad7495c78130fc4365c8e
- onepage-faq-template.ts: 85937add661a8ff797c22b185184b84b53ea7228f55027defedb663c6613c425
- templates/onepage-ui-v1.json: d007eb72e54e75aa99504521464337d83a0a4266926d94b2fcea21e74b79b6fd
- templates/onepage-faq-section-v1.json: 4c1557dcc26851b17b9b4853843bb3ead171055943731161d4894ef930c1d081
- tools/creative-quality/asset-preflight.ts: 23603fb76fb8faaf32feb704ce4c01819cce3cc3973bf58f131d3559a611ddef
- scripts/quality/bounded-file.ts: 7a00c7467d156c6450416b15fe2dc9dd4ede6205f8c965b7d35d2e404e51f25b
- supabase/functions/_shared/onepage-packaging.ts: 3e7027b6d6548a32dcd6f13978ff050551caad9e9728fcbf493d98fec4c8c1d7
