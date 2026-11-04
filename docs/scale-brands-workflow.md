# Scale Brands

UID Brands now has an independent, chat-first Scale Brands workflow. It preserves five commerce regions while adapting the target brand's appearance. It does not reuse the PawfectHouse-only LDP job schema or write to Shopify/canonical data.

Example user request: “Scale Brands cho GiftSoul tại https://giftsoul.co; giữ Teeinblue PDP, Track Order, Policy, Judge.me và Cart Drawer, chỉ adapt style brand.”

The host calls `compile_scale_brands_job({brand:"GiftSoul",store_url:"https://giftsoul.co"})`, reads the current Brand DNA, inspects target-store baselines, implements an isolated draft, and resubmits a versioned `job`. `get_scale_brands_reference({name:"pic-playbooks.md"})` exposes the original methods to plugin clients without requiring a Mac filesystem. Available reference names are returned in the compiler packet. MCP discovery, HTTP tool aliases, OpenAPI and chat routing all expose the workflow.

## Source and boundaries

`.agents/skills/website-brand-ui` is a byte-identical copy of the installed Mac v1.3.0 skill (28 files), including schemas, capture/render/validation scripts and upstream notices/licenses. `docs/scale-brands-source-manifest.json` records SHA-256 hashes. `uid-scale-brands-references.json` bundles eight original references for runtime access; a regression checks they match the vendored source. `.agents/skills/scale-brands` is the UID-specific adapter. No source screenshots, customer data, private tasks or store assets were copied.

The source workflow is v1.3.0; its attribution file retains its historical v1.1.0 header unchanged. Capturing with the optional original scripts requires its separately documented Chrome/Playwright/Ajv runtime. Those dependencies are not required for the gateway compiler.

## Protected regions

| Region | Preserved |
| --- | --- |
| Teeinblue PDP | Field anatomy and IDs, conditional choices, validation, preview/upload/purchase hooks, SKU configuration and personalization payload |
| Track Order | Lookup/provider integration, inputs, validation, result/error/loading/empty behavior and target-store links |
| Policy | Template anatomy and target-store approved policy wording, entity, contacts, destinations and terms |
| Judge.me | Widget and product/store binding, rating summary, filters, sorting, pagination and genuine review provenance |
| Cart Drawer | Item identity, personalization properties, quantities/removal, totals, checkout destinations, close/focus/scroll and states |

Permitted style fields are font, semantic_color, border, radius, icon_treatment and spacing. Their inclusion does not certify that a visual change is harmless: visual and functional review remain required.

## Contract

The compiler discovers the brand from current material routes, then explicitly resolves its `brand-dna` root (the live route list omits root nodes), without LDP or Onepage overlays. It rejects resolver identity mismatches. The target store origin must match canonical `branch.metadata.source_urls` or `store_url` when available. If these fields are absent, the host must supply `store_identity_evidence` with matching brand/store, a concrete observation, artifact reference and hash. That binding is labeled HOST_REPORTED, never canonical/server verified; without it validation stays blocked. This intentionally does not infer aliases or custom domains from resemblance; maintain verified canonical source URLs through the existing governance process when appropriate.

Initialization returns `AWAITING_BASELINES`, five region IDs, current canonical snapshot, a job JSON Schema, source references and execution instructions. It is a valid planning packet, not completed work. A job contains five unique region records, region-bound evidence, protected fingerprints, optional output, styling adaptations and QA reports. Evidence is timestamped, source/store-bound and typed for anatomy, behavior, app hooks, configuration, content or brand style. Report concrete unknowns; do not manufacture evidence just to fill fields.

For each protected part, the host hashes a deterministic representation before and after the change. Keep the source/draft manifests, normalization method and non-secret artifacts locally. These hashes detect declared changes; the gateway cannot prove the host selected the right DOM, hooks or payload. Raw app config, customer orders, credentials and private review contents are never needed by this planner. Tool arguments accept clean public source URLs, not signed query URLs.

The server rejects missing/duplicate IDs, cross-store or wrong-region references, changed protected fingerprints, stale canonical snapshots, stale QA output bindings, unsupported adaptation properties and extra fields. Missing baselines or untested QA remain per-region `INCOMPLETE`; independent regions retain their own status. Failures become `BLOCKED`.

`HOST_REVIEW_RECORDED` means only that host-reported structural/evidence requirements are met. It is never server-authenticated visual/functional QA, owner approval or production readiness. A clean local mock does not establish live provider compatibility. The host still owes actual desktop/mobile artifacts, same-archetype comparisons, regression results and limits.

## Transport and tests

- MCP: `compile_scale_brands_job`, `get_scale_brands_reference`.
- HTTP: `POST /api/scale-brands/compile`, alias `POST /api/tools/compile_scale_brands_job`; `POST /api/tools/get_scale_brands_reference`.
- Initialization/valid-incomplete reports: HTTP 200. Invalid input: 400. Blocked/unavailable canonical reports: 422. MCP failures set `isError`.
- `tests/scale-brands.test.ts`: source integrity, current-brand routing, protected parts, store/evidence isolation, stale snapshots/QA and partial completion.
- `tests/scale-brands-transport.test.ts`: real local HTTP/MCP discovery and calls, with explicitly mocked canonical upstream for deterministic three-brand tests.
- `node --import tsx scripts/scale-brands-smoke.ts --live`: optional read-only current upstream + local MCP smoke. Outputs only brand/status/region counts; no credentials or canonical body.

No live storefront integration, pixel inspection, installed ChatGPT host interaction or production deployment is implied by these automated tests.
