# Onepage live element feedback

The real Onepage compiler and template manifests now carry `onepage_preview_contract` / `live_html_feedback`. This is a delivery step on the actual bound canonical output, not a replacement template or demo-only feature.

1. Complete the existing quality, research, asset and approved GTK/FAQ decisions. Download and bind the selected canonical Onepage template as before.
2. Keep the original bound HTML/CSS and required overall PNG plus production WebP assets. Never replace these with the review UI.
3. Download the contract's three runtime/packager files together. Prepare a manifest with current task ID, content version, brand, selected template version and the actual slot-to-asset mapping/checksums. Do not infer absent assets or add GTK to FAQ output.
4. Run `node onepage-review-pack.mjs bound.html manifest.json review.html`. The output must be a distinct new file beside the source HTML, preserving relative dependencies. The packager adds controls before the closing body without rewriting existing HTML or CSS.
5. Stage the actual review through scripts/publish-hosted-review.ts, then use the reviewed Git → Render deployment flow. Run scripts/verify-hosted-review.ts against the deployed immutable URL and expected identity/version/hash. Open it in a browser and verify desktop/mobile, actual images, selection, multiple independent feedback groups and copied prompt. Return the verified direct browser URL; offline HTML is not completed delivery. Packaging does not certify pixel parity.

The reviewer selects text, an actual responsive image, or a section, records feedback, and copies a prompt manually. Nothing is submitted to chat, Train, the admin queue, or a publishing endpoint automatically. The toolbar is isolated from brand styling.

The receiving host must compare task ID, content version, render hash and selected element/asset mappings with the current task before applying feedback. Downloaded HTML cannot discover later task revisions. Runtime inventory mutation checks catch changes within the current page, but do not replace this host-side freshness check.

The optional local demo generator uses clearly labeled demo-only images/copy. It must never be delivered as a real task output or substitute for a hosted actual outcome.
