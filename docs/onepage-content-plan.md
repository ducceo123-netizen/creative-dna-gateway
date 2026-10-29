# Onepage content-plan validation

New Onepage resolver/compiler calls now accept `research.analysis.content_plan` (`uid-onepage-content-plan/1`) through the existing research object. Initialization stays available without research. After valid research, missing/invalid plans report `REQUIRES_VALID_CONTENT_PLAN` instead of permitting content authoring. Other branches and stored approved outcomes are unchanged.

The returned `content_plan_contract.input_shape` documents the fields. `VALIDATE_ONEPAGE_CONTENT_PLAN` runs before `BUILD_CONTENT_MAP`. Both the Edge compiler and the Node gateway use `attachResearch`; the gateway also applies the guard when upstream packets predate it. This is a structural preflight, not a source-inspection receipt, semantic truth classifier, content approval, or image QC.

- Banner titles must equal the host's verified product keyword on desktop and mobile. The keyword must reference inspected exact PDP sources. Desktop support remains a separate string; subtitle and mobile support must be empty. Host review must still verify that the claimed keyword is actually a concise product descriptor, rather than a tagline disguised as a keyword, and check the rendered asset text.
- GTK/FAQ selection requires an explicit mode, a product-specific comparison explaining both selection and rejected alternative, source IDs and supported insight indexes. No automatic choice is made. GTK keeps three slots; FAQ keeps a variable number of supported answers. Unsupported, duplicate or already-covered answers are rejected where structurally detectable. Meaning, relevance and nonredundancy still require host review.
- Collections require enumeration count/method, shared fact references and explicit exceptions. One sampled demo cannot stand in for a known multi-product collection; known canonical minimum pool sizes remain enforced. Complete inventory declarations must match the count. Partial coverage can use qualified shared-subset claims, not universal claims. Existing research schema limits are unchanged.
- Product Details require the existing three slots, supported facts for one anchor product and distinct visible-proof briefs. The Key Holder screenshot motivates this general rule; hooks, board edges and print surfaces are not universal features.

## Evidence and scope

The supplied screenshot was materialized and viewed: PawfectHouse's pending Key Holder feedback reports missing descriptions/specs, 158 reviewed pages, collection-level copy and three requested closeups. Its pending proposal and previously blocked v3 review are untouched. No new feedback, queue item, handoff, canonical SQL mutation or approval receipt is created.

Live PawfectHouse Onepage resolution on 2026-10-29 confirmed `content.post_story_section = PRODUCT_ADAPTIVE_GTK_OR_FAQ`, `content.gtk_insights = NONREDUNDANT_BUYER_VALUE`, desktop support permitted and mobile support prohibited. The existing typography rule and historical prose permit an emotional phrase within the main title; the narrower keyword-only preflight implements this explicit owner request without changing canonical bytes or pretending the blocked feedback was approved. Canonical rules, source hashes and any canonical blocked state remain intact. Any genuinely conflicting future canonical rule must be reconciled through the existing review process, not silently overridden.

The immutable UI templates contain banner image slots, not separate banner headline DOM nodes. Changing template markup would not fix raster banner copy. These checks therefore act before content/asset production. Legacy template defaults and hashes remain unchanged; a successful plan still needs explicit content approval and actual desktop/mobile pixel QA.

## Verification

`npm test`, `npm run lint`, `npm run build`. On macOS, run tests with `TMPDIR` pointing to a real directory inside the checkout because hosted-review tests reject symlink ancestors (`/var` and `/tmp`). This avoids altering their security checks. No browser layout changed in this patch.
