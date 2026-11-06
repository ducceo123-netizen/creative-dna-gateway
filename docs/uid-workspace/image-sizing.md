# Canonical image sizing proposals

`uid-workspace-image-sizing.ts` is a pure, offline planner. It does not generate or resize images, call a provider, alter the existing image stage, register an independent review, or grant spending/data authorization. Nothing is wired into production by this module.

## Inputs and byte identity

Call `planWorkspaceCanonicalImageSizing` with the retained canonical packet, explicit `gtk` or `faq` selection and previously retained pins:

- `packet_sha256`: SHA-256 of the packet serialized by the existing canonical `stableJson` function. This is canonical JSON identity, not the whitespace of an arbitrary JSON file.
- `canonical_contract_sha256`: the compiler's hash of `creative_quality_contract` excluding its `contract_hash` field. The planner recalculates this from the actual contract body; a copied hash label does not suffice.
- `template_version`, `template_html_sha256`, `template_css_sha256`: the selected current canonical GTK/FAQ version and exact source-byte hashes. The planner loads `getOnepageUiTemplate(version, 'source')` locally and checks actual HTML/CSS against both the pins and manifest.

The result also retains the full contract-document hash, asset-inventory hash, and, when supplied, capability-document hash and explicit evaluation time. Pin equality establishes identity only. The caller still has to obtain these pins from the existing trusted canonical pipeline, rather than compute replacement pins for unreviewed input.

An existing `WorkspaceImageCapability` is optional for offline inspection. Without it, geometric proposals are returned with `IMAGE_CAPABILITY_REQUIRED` and the whole plan is blocked. With it, provide an explicit `evaluated_at` timestamp. The planner checks the current validity window, correct Image 2.5 Flare model, edit/WebP support, medium/high support and the attested size allowlist. It does not discover or verify live capabilities. It cannot extend a capability or assume a geometrically valid size is available in a project.

## Exact integer algorithm

`deriveWorkspaceImageCanvas` reduces target dimensions `W:H` by their greatest common divisor to integer ratio `a:b`. All exact-ratio integer canvases are `(a*k, b*k)`. Both axes must be divisible by 16, so `k` must be a multiple of `lcm(16/gcd(a,16), 16/gcd(b,16))`.

The smallest `k` must also meet the target dimensions and 256-pixel minimum side. The resulting canvas is checked against the existing image transport's conservative limits: maximum side 2560, maximum area 3,686,400 pixels, and aspect ratio between 1:3 and 3:1. All comparisons use bounded integer arithmetic. Rounding each axis independently, approximate aspect ratios, crop, pad, stretch and upscale are forbidden.

If a verified capability is supplied, the planner chooses the smallest-area *listed* valid exact-ratio canvas. It may be larger than the mathematical minimum. If the list has no fit, it returns `EXACT_CANVAS_NOT_ATTESTED`; it never silently selects an unlisted size or a nearby aspect ratio. Unsupported targets report `ASPECT_RATIO_UNSUPPORTED` or `EXACT_CANVAS_EXCEEDS_PROVIDER_LIMITS`.

Current mathematical minima, before capability and independent review:

| Canonical slots | Required raster | Minimum provider canvas | Operation |
| --- | --- | --- | --- |
| `banner_desktop` | 2560×960 | 2560×960 | Exact |
| `banner_mobile` | 720×700 | 1152×1120 | Same-ratio downscale |
| `wyl_01..03` | 732×480 | 976×640 | Same-ratio downscale |
| `detail_main` | 950×950 | 960×960 | Same-ratio downscale |
| `detail_01..03` | 240×240 | 256×256 | Same-ratio downscale |
| `occasion_01..02` | 1280×720 | 1280×720 | Exact |
| `gtk_01..03` | 300×300 | 304×304 | Same-ratio downscale; GTK only |
| `occasion_icon_01..04` | `3x_UI_DISPLAY_SIZE` | Blocked | Responsive geometry not fixed |

The inventory contains 18 production slots for GTK and 15 for FAQ. FAQ produces no GTK image proposals. The template's `occasion_story_01_mobile` alias maps to the existing `detail_main` asset, not another image call. `ui_mapping_preview` is deterministic browser assembly, never an image-provider slot.

## Why icons are blocked

In the currently pinned templates, `.uid-product-occasions .uid-occasions__content-image` has `width: 25%` on desktop and `width: 40%` under `@media only screen and (max-width: 798px)`. The enclosing cards also have responsive widths/padding. The image tags have empty `width` and `height` attributes. Image width/height at 100% do not establish a fixed intrinsic aspect ratio or independent integer pixel geometry.

Therefore neither “80×80” nor any other convenient square can honestly be inferred from these bytes. Even selecting one viewport would not by itself establish the canonical maximum-display policy or intrinsic ratio across responsive states. All four icon proposals return `ICON_DISPLAY_GEOMETRY_UNPROVEN`, with exact HTML/CSS quotations, UTF-8 byte offsets, lengths and excerpt hashes. The mobile media context is retained rather than silently ignoring the override. There is no generic CSS-computed-layout engine here and no assumption that browser `sizes` hints establish rendered geometry.

Resolving the blocker requires a reviewed, pinned definition of the relevant viewport/display envelope and aspect geometry, or a canonical fixed geometry specification. This planner does not make that creative/layout decision or modify canonical templates. An implementation supporting a future proven geometry must retain the existing `ui_display_size` evidence requirements.

Current source identities inspected by this implementation:

- GTK HTML: `fdab769e0b48f1b49abf1b558b4230eb36cc12b0e2b2e4264bf5a03478bbb4ad`
- FAQ HTML: `4c6ad6fe7864fe7807bbcc1eb8da281a97bcbadb1c4675b9a0a3d5afc514bf6b`
- Shared CSS: `4671a41229fe5b3704d2825661f5ef1f7087500e513ddd2eb21eea3877291154`

These are source identities, not independent review references or authorization receipts.

## Review boundary and integration

Every proposed strategy is deliberately typed as `Omit<WorkspaceAssetSizingStrategy, 'evidence_ref' | 'ui_display_size'>`. The planner never supplies an executable independent `evidence_ref` or fabricates `template_evidence_ref`. Global flags always state `authorization_granted: false`, `quality_verified: false`, `independent_review_required: true`, and `provider_calls_performed: 0`.

The operator/review layer may use these proposals and exact evidence to avoid recomputing dimensions manually. It must independently review the *full pinned plan*, address all blocked slots, retain a real review record, and only then configure the existing image stage through its normal authorized composition. Do not cast a proposal into an approved strategy or use the planner's source hashes as a review identity. Missing review must remain a preflight blocker before the first paid call.

Even exact geometry does not certify product fidelity, mobile title-only composition, preserved typography, image quality after downsampling, or EO. Actual decoded output dimensions, exact aspect preservation, source custody, independent visual/source QC, approvals, project capability, budget, and operation journal checks remain mandatory. This change modifies neither canonical GTK/FAQ content nor existing ChatGPT/MCP behavior.

## Verification

Focused test command:

`node --import tsx --test tests/uid-workspace-image-sizing.test.ts`

Tests use real canonical template bytes and the real packet compiler with synthetic rules/capability. They cover GTK/FAQ inventory, all current numeric size classes, integer-minimum equivalence against exhaustive enumeration, transposed ratios, minimum side/area/aspect boundaries, malformed inputs, no exact allowlist fit, stale/invalid capabilities, responsive icon evidence, byte-pin drift, and absence of generated review/authorization fields. They perform no network, installation, image generation or paid calls and do not assert live EO quality.
