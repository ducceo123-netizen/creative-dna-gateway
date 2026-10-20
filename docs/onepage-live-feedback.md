# Onepage live element feedback

The real Onepage compiler and template manifests now carry `onepage_preview_contract` / `live_html_feedback`. This is a delivery step on the actual bound canonical output, not a replacement template or demo-only feature.

1. Complete the existing quality, research, asset and approved GTK/FAQ decisions. Download and bind the selected canonical Onepage template as before.
2. Keep the original bound HTML/CSS and required overall PNG plus production WebP assets. Never replace these with the review UI.
3. Download the contract's three runtime/packager files together. Prepare a manifest with current task ID, content version, brand, selected template version and the actual slot-to-asset mapping/checksums. Do not infer absent assets or add GTK to FAQ output.
4. Run `node onepage-review-pack.mjs bound.html manifest.json review.html`. The output must be a distinct new file beside the source HTML, preserving relative dependencies. The packager adds controls before the closing body without rewriting existing HTML or CSS.
5. Open the review and verify desktop/mobile, selection, multiple independent feedback groups and copied prompt. Deliver it with its actual assets and CSS, or publish only to a user-authorized destination. Packaging does not certify pixel parity or image checksum correctness.

The reviewer selects text, an actual responsive image, or a section, records feedback, and copies a prompt manually. Nothing is submitted to chat, Train, the admin queue, or a publishing endpoint automatically. The toolbar is isolated from brand styling.

The receiving host must compare task ID, content version, render hash and selected element/asset mappings with the current task before applying feedback. Downloaded HTML cannot discover later task revisions. Runtime inventory mutation checks catch changes within the current page, but do not replace this host-side freshness check.

`/onepage-feedback-demo.html` is intentionally labeled DEMO and uses demo-only images/copy in the canonical layout. It must never be delivered as a real task output.
