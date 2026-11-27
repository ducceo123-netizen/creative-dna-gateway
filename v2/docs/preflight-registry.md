# Registry and compiler read-only preflight — 2026-11-27

Baseline main: `87bf39d1f38eb1d0baee159b921efbd7e3aaf923`; Lean source: `8367c7cf45c330bdd044ba0f83b3af2b483228e5`. All nine handoff documents read. No production mutation performed.

## Verified live compiler
Read-only POST `/api/tools/compile_onepage_job` called for all three brands without a source or research. Saved exact response JSON outside Git in `work/private-baseline` (directory mode 0700/files 0600). All return `creative_quality_contract.status=COMPILED`, no compiler errors; 25 active catalog rules, 5 owner supplements, 2 delegated rule supplements per brand. Revision `owner-rule:e03072fe-4281-43bc-9cd6-44d9e53d3e91`. Hashes:

- PawfectHouse contract `89cc2750ddbbd652e4a4d5fa96f701cf2590458754c546c1628d738573b82c3c`; raw response 340063 bytes, SHA-256 `d14d5b4f7083461e349187f357603070d74ffcc333cb8f27ab4a3cac4283592d`.
- GiftSoul contract `8760d678e272f2465f9abd6c26bd111dbb9c53b52b382a8d19bd89e453779e44`; raw response 332646 bytes, SHA-256 `a48bc955200b6ff752f3c21d0670036da31ae4244a61b99dc1554257f45ca974`.
- SoulPrise contract `9e66235fa2772b73ff2b905f86795620707412c65cf18f8b73cc8970ea88f1e4`; raw response 333181 bytes, SHA-256 `619f043b3300cbbe20de70db132f8e1633019575edea70cec7d0fb1bb312d589`.

Live initialization confirms 23 execution steps, 12 hard gates, 19 conditional manifest definitions; research remains AWAITING_RESEARCH, not execution proof. Exact execution:

1. VALIDATE_QUALITY_CONTRACT
2. READ_OWNER_SUPPLEMENTS_WITH_CANONICAL_PRECEDENCE
3. READ_AGENT_REVIEWED_SUPPLEMENTS_WITH_PINNED_EVIDENCE_SCOPE
4. ACQUIRE_SOURCE
5. BUILD_VERIFIED_PRODUCT_POOL
6. CHECK_DIVERSITY_GATE
7. INSPECT_DESCRIPTIONS_AND_REVIEW_COVERAGE
8. RESEARCH_MARKETPLACE_COMPETITOR_SUPPLIER
9. RESEARCH_PINTEREST_PRODUCT_THEME_MARKET_REFERENCES
10. RESEARCH_REDDIT_CUSTOMER_CONTEXT_AND_COUNTEREVIDENCE
11. ANALYZE_BUYER_CONCERNS_AND_SCOPED_CLAIMS
12. VALIDATE_RESEARCH_BEFORE_CONTENT
13. CLIPO_REFERENCE_DISCOVERY
14. HUMAN_REALISM_REFERENCE_DISCOVERY
15. SELECT_INCREMENTAL_CUSTOMER_VALUE
16. VALIDATE_ONEPAGE_CONTENT_PLAN
17. BUILD_CONTENT_MAP
18. BUILD_ASSET_MANIFEST
19. ALLOCATE_PRODUCTS_VARIANTS_CAST_TO_ASSETS
20. GENERATE_SLOT_BY_SLOT
21. INSPECT_PRODUCT_AND_EXPLICITLY_REQUIRED_EVIDENCE_PIXELS
22. QA_EACH_SLOT
23. BUILD_UI_MAPPING_PREVIEW

## Dependencies and side-effect boundary
`server.ts::compileOnepageJob` calls read-only upstream compiler, then pure `attachOnepageUiTemplate` and `attachResearch`; resolves public PDP product type, scans same-brand storefront candidates, reads approved EO library only with optional member auth, discovers Clipo references and Human Realism, normalizes the two discovery steps. Upstream function creates a service-role client internally but its path only calls `resolve_creative_dna_alias` and public reference reads. Final SQL/RPC side-effect verification is in Supabase preflight. V2 must never receive that service-role key.

The generic legacy server module eagerly creates the complete Express application, registering writable feedback, admin, EO approval and other surfaces. Do not import server.ts into the new endpoint or proxy arbitrary tool names. Reuse isolated pure modules or allowlisted public compiler adapter only. No production member bearer forwarding in V2; private reference support must be explicit and separately authorized.

Reusable pure components: shared compatible quality compiler, product research/content/insight/Pinterest/Reddit validators, exact Onepage template binder and all physical/banner/creative/product-scope/EO report validators. These validators inspect reports, not genuine pixels. Template versions GTK `2026-10-11.v3`, FAQ `2026-11-11.faq.v2`; live template policy status COMPATIBLE, PNG mapping, FAQ available.

## Precedence and conflicts
Catalog compiler preserves rules with scoped supersession, rejects cycles, wrong scopes, stale source hashes, conflicts and missing required references. Owner and agent supplemental text is verbatim and subordinate to active catalog, hard gates and verified product truth; conflicts stop only affected direction for clarification. A compiler hash is not semantic or artistic QC.

Current public packet does not reproduce the handoff's potential scene-first/typography-second banner conflict: live portable playbook and production QC say single_pass_integrated_final_banner. Do not manufacture a conflict or alter rules. Runtime conflict detection must retain exact source paths and block if a future packet contains contradictory workflow text. GTK remains evidence-adaptive; no unconditional preference. Content auto-continues after internal validation unless explicit user review-first. Final human outcome review and explicit packaging remain required.

## Prototype reuse
Six alias pairs in Lean compactOnepage use structural equality and restore losslessly; port that mechanism with safe path validation. Do not reuse hand-written HTTP JSON-RPC server or unauthenticated snapshot-ID lookup. Stage-session has no durable authorization, prerequisite graph, coverage receipt, or revision invalidation. Retain unknown fields universally, expose complete pinned fallback, and prove dependency closure. Avoid silently treating similarly named top-level/template playbooks as duplicates.

## Proposed V2 interfaces
`createSnapshot(packet, provenance)` -> immutable full packet + content hash + rule index + alias metadata + readiness/conflicts. `stageContext(snapshot, stage, {templateMode?})` -> complete verbatim global and stage rules, resolved dependencies, coverage IDs, deferred paths. `readContextPath(snapshot, pointer)` and `fullContext(snapshot)` exact retrieval with prototype/path protection. `assertCoverage(snapshot, stage, receipt)` rejects stale/missing rules. `compileCanonical(input, fetcher?)` -> read-only public packet from fixed allowlisted gateway endpoint, bounded timeout/size, never credential forwarding; allow injected fake transport for offline tests. Research recompilation returns a new immutable snapshot; orchestrator atomically installs it after compare-and-swap.

Coverage claims distinguish packet roundtrip from all source knowledge. Public compiler packets expose active compiled rules and provenance, not every private source record. Source exports remain local. Real GPT, visual EO and paid A/B remain unexecuted until host capability and resources are available.
