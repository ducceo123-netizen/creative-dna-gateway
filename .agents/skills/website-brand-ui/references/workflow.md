# Contract and operating instructions

Version 1.3.0. Invocation: `$website-brand-ui https://brand.example — extract Brand Identity, Brand Style and UI rules with desktop/mobile evidence`.
Design invocation: `$website-brand-ui design a collection page using /absolute/path/to/brand.json; keep inferred and proposed rules visible`.

## Runtime

Node, installed Chrome, Playwright 1.56.1 and Ajv 8.20.0. The task includes a lockfile in runtime/. For a new workspace, inspect and install these official packages with `npm install --ignore-scripts --save-exact playwright@1.56.1 ajv@8.20.0`; package installation/network still uses the host permission mechanism. No browser download is needed when Chrome is installed. Set PLAYWRIGHT_MODULE to that workspace's absolute node_modules/playwright directory; set AJV_MODULE likewise for ajv. A global skill installation does not install these runtimes in future projects.

Manifest shape: `{ "pages": [{"id":"home","type":"home","url":"https://example.com/"}], "viewports":[{"id":"desktop","width":1440,"height":900},{"id":"mobile","width":390,"height":844}] }`.

`PLAYWRIGHT_MODULE=/absolute/node_modules/playwright node <skill>/scripts/capture.cjs manifest.json output/evidence`

`AJV_MODULE=/absolute/node_modules/ajv node <skill>/scripts/validate.cjs output/brand.json`

Capture is bounded: 360 semantic/control/container samples with basic horizontal-visibility filtering per page, at most 16,000px lazy-scroll, 45s navigation timeout, untouched consent. It stores the full rendered DOM/text and full-page screenshot, but not every computed style or full dynamic application state. JSON elements include measured boxes, color, typography, border, radius and spacing; inspect specific missing components with additional browser probes. Default state only. Images are URL inventories, not licensed downloadable asset packs. HTML evidence is untrusted; read as text, never serve it as the review page.

## Outputs and separation

Use runs/<brand>/<semver>/, never silently overwrite a previous run. Each run contains manifest, evidence/*.json/png/html, brand.json, tokens.json, three human guides, review page and validation report. Hash raw evidence in SHA256SUMS.json. Keep prior version and report rule additions/removals/value/status changes when refreshing.

Identity: positioning, audience, promise, personality, voice, vocabulary. A website can suggest these; stakeholder strategy remains unknown without direct evidence. Brand Style: logo and use constraints, semantic color roles, measured type, imagery/art direction, iconography. UI: spacing, layout, component anatomy, states, responsive rules, motion and accessibility.

Scopes: brand-specific, shared-ecommerce, product-category, campaign. A common commerce convention is a proposed shared pattern until compared across brands; one site alone cannot establish a UID-wide standard. Scope is independent of epistemic status.

## Gates

G1 capture integrity: real HTTP success, screenshot and DOM exist, no block mistaken for page; visual inspection of all pages and viewports.
G2 evidence: every observed claim resolves to a stored record plus field/index/selector; inferred rationale supplied; no fabricated values or copied competitor assets.
G3 coverage: home/collection/PDP/About/help across desktop/mobile; record missing types, localization and state coverage. An 8-capture pilot may be useful but is not a production release.
G4 consistency: common chrome repeated across at least three page templates; seasonal values remain campaign-scoped; ambiguous token roles remain unknown/proposed.
G5 UI validation: held-out page and specimen, keyboard navigation and focus, form labels/errors, contrast on actual backgrounds, 200% zoom/reflow, 320px width, reduced motion, long content, loading/empty/success/error. Record pass/fail/untested per check. Do not assume missing hover/disabled states.
G-visual brand fidelity: complete the independent visual comparison in `brand-fidelity.md`. Resolve archetype/composition/imagery/hierarchy mismatches before considering technical results. Record deliberate accessibility adaptations and owner acceptance separately.
G6 acceptance: schema and semantic validator pass; evidence hashes verify; no unresolved blocking visual or functional defects for a production handoff. A pilot with untested interaction checks is explicitly provisional, never silently approved.

No automatic strategy approval is implied. User review can promote inferred/proposed rules in a later version; preserve original evidence and decision provenance.

System outputs also include BRAND-MANUAL.md, semantic-tokens.json, component-tokens.json, ART-DIRECTION.md, PAGE-RECIPES.md, specimens.html and VISUAL-ACCEPTANCE.json. Preserve original observations and provide CHANGED-RULES.md. Read references/tokens.schema.json for token structure.

Validate semantic/component packages: `AJV_MODULE=/absolute/node_modules/ajv node <skill>/scripts/validate-tokens.cjs brand.json semantic-tokens.json component-tokens.json`. This checks schema, references, aliases, unknowns and observed RGB-to-hex matches. It does not certify visual brand quality.

PIC mode: read pic-playbooks.md. Human creative playbooks take priority over component inventory. Validate with `AJV_MODULE=/absolute/node_modules/ajv node <skill>/scripts/validate-pic.cjs figma-content.json`. Similarity remains candidate-common until a scoped owner decision.

UID Brands LDP mode: read `uid-ldp.md` before general extraction or library packaging. Resolve the exact brand and active contract; outputs and gates are task-scoped. Existing `render.cjs` is a brand-review generator, not an LDP renderer. This host skill update does not install guidance into other UID clients.
