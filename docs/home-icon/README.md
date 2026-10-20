# PawfectHouse Home Icon

## Verified reference (2026-10-20)
Homepage: https://pawfecthouse.com/, section `#section-KqMttV`, “What’s your loved one into?”. Downloaded and parsed all nine actual CDN SVG assets, then rendered all nine with Inkscape and visually inspected the contact sheet. `source-assets.json` records source URLs, SHA-256, byte sizes, intrinsic dimensions and rendered alpha bounds. The uploaded reference screenshot was visually inspected too.

All nine are native SVG, width=75 height=75 viewBox="0 0 75 75", no background rectangle. Primarily black contours/white fills, occasional #202024. Rounded friendly hand-drawn pictograms; source outlines are filled paths, so a nominal 1.5–2px authoring stroke is a heuristic, not a measured universal source stroke. Transparent outer canvas, white enclosed surfaces.

The actual downloaded homepage CSS applies `.interest-icon { padding:15px; background:#fff1dc; border-radius:100%; }`. The beige circle and labels must not be baked into the delivered SVG. The page declares nine desktop columns and three mobile columns; img width/height attributes are 75. Actual computed viewport sizes were NOT measured: Chromium launch failed due to the execution sandbox and the approved escalation failed before browser startup. Do not describe a hypothetical 105px wrapper as a measured live display size.

## Implementation
- Fixed canonical content/input/output/QC contract: `supabase/functions/_shared/home-icon.ts`.
- Existing authenticated active-admin Edge gate, then only `home_icon_preview` and `home_icon_install` actions; gateway `/api/admin/home-icon/preview` / `install`.
- Admin UI presents the full exact contract before its activation button. No credentials, grants or user role changes. Public reads cannot install. Request payload cannot replace fixed brand/content/schema.
- New node starts `draft`; only a matching guide and exact pinned content/schema/metadata permit `active`. Existing different records fail closed. Identical active state is read-only/idempotent. Unknown writes are not replayed automatically.
- Existing DB constraint verified read-only: UNIQUE (brand_id,node_type,slug,version). Install is fixed to material/home-icon/1.0. No schema migration or new grants.
- Dashboard discovers actual DB routes. No phantom Home Icon added to fallback list. Public resolver + gateway expose keyword-or-collection pictogram contract, not irrelevant mandatory PDP/product-pixel gates. Any actual product claims still need verified facts.
- Main dashboard labels/brief help are ready when the route activates. The separate offline PromptMaster catalog is intentionally unchanged (its no-network contract remains intact); use the main dashboard or direct chat until its static snapshot is refreshed after live route verification.

## Validation example
`templates/home-icon/music-test.svg` is an original native-vector Music test, not an owner-approved output. Rendered at 75px and visually inspected on peach, white and gray backgrounds: coherent headphone silhouette + musical-note cue, clean contours, white enclosed fills, no clipping, no baked badge/label. These limited observations validate the pipeline, not all future topics or owner acceptance.

Strict small SVG grammar checks exact root attributes, balanced tags, duplicate attributes, supported elements/attributes and reference palette. It is not a full SVG renderer or proof of visual semantics/alpha. Actual rendered pixel inspection and output receipt remain mandatory.

## Deployment / activation
1. Review exact code and tests; publish gateway and matching `creative-dna-admin-feedback` and `creative-dna-public` functions with existing JWT settings unchanged.
2. Existing admin opens `/admin/feedback`, expands Home Icon, reads the contract, activates that exact revision. Successful branch installation is NOT generated-output approval.
3. Read `/api/routes` and resolve PawfectHouse / Home Icon to verify canonical bytes, input schema, reference contract and guide; confirm main dashboard shows the route.
4. Recheck a topic and collection flow, inspect real output, and publish an honest receipt. Do not call the route live or EO owner-approved before these steps actually pass.

No direct database write or live activation was performed while preparing this patch. No paid provider was used. No website modifications were made to pawfecthouse.com.
