# Onepage content-plan validation

New Onepage resolver/compiler calls now accept `research.analysis.content_plan` (`uid-onepage-content-plan/1`) through the existing research object. Initialization stays available without research. After valid research, missing/invalid plans report `REQUIRES_VALID_CONTENT_PLAN` instead of permitting content authoring. Other branches and stored approved outcomes are unchanged.

The returned `content_plan_contract.input_shape` documents the fields. `VALIDATE_ONEPAGE_CONTENT_PLAN` runs before `BUILD_CONTENT_MAP`. Both the Edge compiler and the Node gateway use `attachResearch`; the gateway also applies the guard when upstream packets predate it. This is a structural preflight, not a source-inspection receipt, semantic truth classifier, content approval, or image QC.

- Banner titles must equal the host's verified product keyword on desktop and mobile. The keyword must reference inspected exact PDP sources. Multiline copy and unknown banner copy aliases are rejected. Desktop support remains a separate string; subtitle and mobile support must be empty. Host review must still verify that the claimed keyword is actually a concise product descriptor, rather than a tagline disguised as a keyword, and check the rendered asset text.
- GTK/FAQ selection requires an explicit mode, a product-specific comparison explaining both selection and rejected alternative, source IDs and supported insight indexes. No automatic choice is made. GTK keeps three slots; FAQ keeps a variable number of supported answers. Unsupported, duplicate or already-covered answers are rejected where structurally detectable. Meaning, relevance and nonredundancy still require host review.
- Collections require enumeration count/method, shared fact references and explicit exceptions. One sampled demo cannot stand in for a known multi-product collection; known canonical minimum pool sizes remain enforced. Complete inventory declarations must match the count. Partial coverage can use qualified shared-subset claims, not universal claims. Existing research schema limits are unchanged.
- Product Details require the existing three slots, supported facts for one anchor product and distinct visible-proof briefs. The Key Holder screenshot motivates this general rule; hooks, board edges and print surfaces are not universal features.

## Evidence and scope

The supplied screenshot was materialized and viewed: PawfectHouse's pending Key Holder feedback reports missing descriptions/specs, 158 reviewed pages, collection-level copy and three requested closeups. Its pending proposal and previously blocked v3 review are untouched. No new feedback, queue item, handoff, canonical SQL mutation or approval receipt is created.

Live PawfectHouse Onepage resolution on 2026-10-29 confirmed `content.post_story_section = PRODUCT_ADAPTIVE_GTK_OR_FAQ`, `content.gtk_insights = NONREDUNDANT_BUYER_VALUE`, desktop support permitted and mobile support prohibited. The existing typography rule and historical prose permit an emotional phrase within the main title; the narrower keyword-only preflight implements this explicit owner request without changing canonical bytes or pretending the blocked feedback was approved. Canonical rules, source hashes and any canonical blocked state remain intact. Any genuinely conflicting future canonical rule must be reconciled through the existing review process, not silently overridden.

The immutable UI templates contain banner image slots, not separate banner headline DOM nodes. Changing template markup would not fix raster banner copy. These checks therefore act before content/asset production. Legacy template defaults and hashes remain unchanged; a successful plan still needs explicit content approval and actual desktop/mobile pixel QA.

## Verification

`npm test`, `npm run lint`, `npm run build`. On macOS, run tests with `TMPDIR` pointing to a real directory inside the checkout because hosted-review tests reject symlink ancestors (`/var` and `/tmp`). This avoids altering their security checks. No browser layout changed in this patch.

## Fixed UI content slots (2026-10-31)

The selected backend template owns UI headings, section order and slot counts. Content approval does **not** grant permission to add layout blocks. Brand style applies within permitted assets; product copy remains variable within the declared text slots. Existing template HTML/CSS and hashes are unchanged.

The captured structure is Product Details → two Occasion images without text → four icon cards. There is no Occasion heading/support slot. `title_07`–`title_10` and matching descriptions belong to the four icon cards, not the image pair. Fixed template headings remain unchanged. Only the approved FAQ variant permits row repetition via its existing binding contract.

Both research preflight and the template manifest now carry `uid-onepage-ui-content/1`. Unknown content-plan fields (including invented section/header blocks) are rejected. An optional `content_plan.ui_copy` submits a **complete** draft keyed by actual `data-text-slot` IDs. If present it must contain exactly the selected template's slots; FAQ row count matches selected insights. Unknown/missing slots and non-text values fail preflight. Banner raster copy remains in the separate banner plan, not extra HTML slots.

Research-only preflight still works without `ui_copy`; READY_FOR_HOST_REVIEW is not proof that unsubmitted copy or downstream HTML is valid. The gateway supplies the contract and templates, not the external host's HTML renderer. The host must submit the draft for validation, bind only those approved slots using `textContent`, preserve all other DOM/CSS, and inspect actual desktop/mobile renders before delivery. If an already-approved draft contains unmappable copy, correct the draft instead of creating new nodes or silently hiding it. No semantic or pixel-QC receipt is fabricated by these checks.

### Deterministic mapping path

`get_onepage_ui_template` (both existing MCP and REST entrypoints) now accepts optional `bindings: {text, assets, faq_count?}`. Legacy calls without bindings still return the same manifest/source shape plus additive guidance. Binding accepts exact complete text/asset slot maps only, rejects caller HTML/CSS and fixed UI/unknown slots, escapes values, and substitutes into the versioned source. HTTPS or relative asset references are accepted without fetching them; fixed embedded checkmarks are not caller-overridable. FAQ mode requires its approved row count and repeats only the existing row prototype with unique IDs and expanded answers. GTK rejects FAQ count/slots. No source template or CSS bytes are modified.

The template manifest and compiled packet direct the host to use this bound HTML/CSS before rendering rather than hand-assembling blocks. A successful binding returns `BOUND_REQUIRES_VISUAL_QA`, source/output hashes and `visual_qc_performed:false`; it neither stores/publishes content nor certifies copy approval, fetched asset bytes or product truth. The earlier limitation applies to hosts that ignore this app path or edit the result afterwards; the app cannot certify arbitrary external HTML. The bound output itself cannot gain a caller-supplied Occasion heading/support or a new layout block.
