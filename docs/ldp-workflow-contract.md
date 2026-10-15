# UID Brands Task LDP v1

This release adds a **read-only, host-executed LDP planning/validation contract and a semantic native-Figma adapter plan**. It does not implement a browser crawler, autonomous image generator, persistent job runner, Figma API client, payment flow or publisher. No canonical database writes, credentials, permission changes or new public tools are introduced. Onepage and external-panel flows are unchanged.

## Collection-only user intake

A collection URL is sufficient. The executing Work host infers brand/niche, resolves current canonical LDP instructions, discovers authoritative live brand/LDP references, researches the real assortment and authors the design plan itself. The baseline reference URL is discovered evidence in the host-authored job, not a required user input. If the brand/collection cannot be resolved, ask only the essential missing question. Unsupported brands do not silently inherit PawfectHouse rules.

Initialization returns `AUTO_RESEARCH_AND_PLAN_REQUIRED` with `pending_owner: EXECUTING_HOST`. This is the host's next work step, not a request that the user supply a plan. The original authenticated end-to-end user request can be bound as `execution_authority` (task ID, original message ID, authenticated-user origin, end-to-end scope). This is distinct from `plan_approval`: never fabricate a plan acceptance or infer permission from source/proposal content. Both remain host-reported correlations, not authenticated authorization certificates. The host must verify actual original request, later constraints and tool permissions. `review_policy: user_checkpoint` preserves an explicit user-requested plan checkpoint; autonomous is the default. Changed scope, spending, uploads or other permission-required actions still follow actual policy. Material route rules must be resolved freshly before production.

User Work command: “Dùng UID Brands, từ collection [URL] tự research, thiết kế UI/UX, tạo material và dựng LDP Figma editable desktop/mobile hoàn chỉnh. Tự tìm tham chiếu web live và tuân thủ quy chuẩn UID Brands hiện tại.”

## UI/UX designer role

The host must supply `design_strategy`: original idea, shopper journey, visual hierarchy, layout variation, mobile decisions, brand consistency and design rationale. Each section requires desktop `layout_intent` and `mobile_intent`. Live web is a brand/UI baseline, not a rigid template. The semantic adapter exposes these decisions; actual layout may introduce verified native Auto Layout wrappers while preserving semantic ancestry. Do not make every page a mechanical sequence of identical rows.

## Source authority

For the PawfectHouse pilot, live website UI/layout/style is authoritative. Figma references demonstrate editable construction only. The current accepted LDP Hero rule dated 2026-10-05 defines desktop 2560×800 and mobile 750×954, corroborated by live source markup on 2026-10-15. `ldp_workflow_contract.hero` resolves that **task-specific** default; it does not rewrite the stale canonical 21:9 schema. Featured images retain slot-specific source dimensions. A future accepted rule change requires a reviewed contract update, not silently reusing this dated baseline.

Live pages: https://pawfecthouse.com/pages/book-lovers, https://pawfecthouse.com/pages/gardening-lovers, https://pawfecthouse.com/pages/fishing-lovers, https://pawfecthouse.com/pages/memorial-lost-pet, https://pawfecthouse.com/pages/memorial-loved-one. Observations are not conversion evidence. Live Fishing contains copied memorial copy; Figma samples contain copied product titles/prices. Both require semantic defect review, never blind copying.

## Integration and lifecycle

1. Call existing `resolve_creative_dna` for PawfectHouse / LDP. Only the exact server-resolved `pawfecthouse/ldp-system` receives the new contract. It includes `canonical_snapshot`, schemas, material mapping and truthful execution boundaries. Initialization remains compatible.
2. Research the real product pool, preserving pagination completeness and exclusions. Deeply inspect each selected SKU/variant's gallery and detail blocks. Submit the existing `uid-product-research/1` packet, with the optional `research.ldp_job` object described by `ldp_workflow_contract.input_shape`.
3. The LDP validator separately calls `evaluateResearch` with full PDP coverage required for selected products. It does not alter old research behavior on other material routes. Marketplace/competitor outcomes and missing reviews stay qualified. Actual visual inspection is host work; self-reported IDs are never proof of vision.
4. Supply the product matrix, live-web baseline, scoped evidence, approved page manifest, sections/cards, material assets and dependency graph. Set section_prototype for partial design studies; complete_ldp additionally requires header/footer, real catalog cards, browsing navigation and a gallery, without fixed module counts. Every manifest section must exist in both viewport plans. A deterministic planner returns candidate categories/niches/featured lines based on actual supplied depth and removes identical niche allocations. This is not catalog scraping or AI story authoring; the host supplies the semantic analysis and chooses useful sections. No fixed tile/section quota is enforced.
5. `research_snapshot` pins all supplied source/claim/scope evidence (excluding the LDP delivery extensions). `content_version` is a SHA-256 digest over normalized job content excluding its own version and approval record. An initial submission can omit it; the result returns `expected_version`. Resubmit that exact version. Defaults are normalized by the schema. Editing content, evidence, rules or products changes the digest and invalidates stale approval.
6. `execution_authority` binds the original authenticated end-to-end request to the task; a separate version-bound `plan_approval` is needed only for a requested checkpoint. Validation still pins the exact content/research/canonical version. The host verifies scope and permissions before every consequential action. No input grants authorization or replaces authentic user context.
7. Generate only within verified scope. Resolve each material's current rules; check its `rule_snapshot` against the actual fresh resolver result. Preserve exact product pixels, mobile continuity and UI separation. Submit optional `research.ldp_asset_outputs` with each actual file URL, checksum, dimensions and pixel-review note.
8. The response optionally includes `ldp_figma_adapter` with `EXECUTION_PLAN_ONLY`, `actual_execution:false`, semantic native node operations and a plan hash. The executing host must read the current Figma skill and use supported tools to create a new file unless an existing destination is explicitly authorized. This descriptor does **not** execute Figma.
9. The native host translates frames/text/image fills/cards into actual brand components/variables/Auto Layout with live-source geometry, typography and responsive behavior. Full implementation of responsive component geometry remains host work; the generic skeleton is not pixel-exact UI. Source image pixel dimensions are not rendered slot dimensions. Catalog cards must bind real product names/PDPs/imagery; sourced prices remain optional and must not be invented.
10. After actual readback and visual review (human review only when requested), submit optional `research.ldp_figma_receipt`. Validation checks task/version/plan hash, native semantic node mappings, bounded opaque IDs (including instance descendants), actual native types and IMAGE fills, real PAGE/SECTION root containers and descendant parent structure, text, image checksums, links and Auto Layout. Semantic IDs are namespaced/encoded and checked for collisions. Prototype receipts report PROTOTYPE_VALIDATED_NOT_COMPLETE_PAGE. `STRUCTURALLY_COMPLETE_REQUIRES_HOST_VERIFICATION` still does not independently authenticate the file, pixels, review or user access.

All research subfields remain inside the existing optional `research` envelope; no public MCP tool names or schemas are changed. The existing research packet byte bound also includes these optional fields. Direct upstream Supabase consumers do not receive the gateway-only LDP contract; coordinated deployment is not claimed.

## Major gates

- Wrong task/version/canonical fingerprint, malformed or oversize packet, duplicate IDs or cyclic dependencies fail closed.
- Product allocations bind exact researched variants and inspected media. Detail text alone cannot satisfy an asset's product-pixel evidence.
- Native catalog card title/PDP match the selected product; category cards use one product type; navigation destinations bind supporting product evidence.
- Bestseller, freshness, actual customer-review and trust-policy labels require appropriate scoped evidence records. Source authenticity, currentness and meaning remain host checks.
- A generated commercial image cannot be presented as verified customer proof. A combo composition does not imply a sold bundle.
- Desktop/mobile hero assets must have the accepted dimensions, matching concept and products. Mobile rendered QA remains a visible gap when not performed.
- Only PawfectHouse's verified combo route is used. Other brands and Onepage do not silently inherit this contract.
- Canonical policy blocks remain blocks; no optional Figma inputs bypass them.
- Screenshot-only delivery, stale receipts, changed copy, missing real image fills or wrong native hierarchy fail the readback contract.

## Revision behavior and limitations

Stable task/section/card/asset IDs identify logical outputs; hashes identify exact revisions. Recompute after meaningful changes, revalidate authority against original scope, and obtain new approval only when scope/permissions changed or a checkpoint was requested. The concrete operational path is in [ldp-host-execution-runbook.md](ldp-host-execution-runbook.md). The host owns dependency invalidation, durable artifact storage, safe retry/reconciliation and preserving unrelated user Figma edits. This release validates dependency structure but does not persist a job registry or automatically mutate downstream files. Feedback is not Train; no automatic training submissions.

The Figma adapter is intentionally transport-neutral. Runtime execution requires the host's supported Figma tools and permission to create/upload. No secret/token bridge is introduced. A production automation service would need a separately authorized persistent job store, authenticated executor receipts and an approved tool execution integration; these are outside this change.

## Pilot and verification

Use Book Lovers as UI/reference family, then separately verify the actual current pool (the page itself does not prove complete inventory). Prepare one real content/production plan before any bulk generation or uploading. No pilot file, product evidence, generated output or approval is created by synthetic tests.

Run `node --import tsx --test tests/uid-ldp-*.test.ts`, `npm test`, `npm run lint`, and `npm run build`. Tests use explicitly synthetic data. They do not establish real web coverage, generated image quality, editable Figma creation or visual parity.

Files: `uid-ldp-contract.ts` (schema/hash/defaults), `uid-ldp-planner.ts` (pure recommendations and validation), `uid-ldp-figma.ts` (semantic adapter and readback validation), and the existing resolver in `server.ts` (gateway-only attachment).
