# LDP HTML preview and direct feedback

The default PawfectHouse LDP workflow now produces a responsive HTML/CSS review draft instead of requiring Figma assembly. Historical Figma modules and readback validators remain available for explicit legacy consumers; the resolver no longer attaches or requests Figma plans. No existing Figma file is deleted or altered. Other materials and brands are untouched; this adapter currently validates PawfectHouse only.

## Input and fidelity

Use the existing current `research.ldp_job` and source/media evidence. Add exact revision-bound `ldp_asset_outputs` and `ldp_preview_layout` (schema returned by `ldp_preview_contract`). Each actual section requires its desktop/mobile layout, image fit/focal alignment, same-brand observed source URL and concrete evidence note. Typography is also sourced. Existing baseline supplies brand colors, font, spacing and radii. No brand-neutral default or copied competitor tokens may fill a missing brand baseline. A semantic layout draft is not a pixel-parity certificate. The host must inspect actual desktop/mobile rendering and fonts against source evidence, adapt layout if needed, and disclose gaps.

Resolver returns `ldp_html_preview.html` only for validated current content with matching host authority and exact asset inventory. Deliver this standalone file or place it on the already authorized Render preview destination; no deploy occurs in the renderer. Do not use a Vercel destination. Original assets and manifest accompany handoff. A synthetic fixture is for testing only and must never be described as the user's completed LDP.

## Review interaction

Enable Select elements and click actual text, image or card. Switch to Whole section for a section-level request. Click multiple targets, enter a shared note and Add feedback group. Repeat with independent groups. Switch Desktop/Mobile to inspect the matching assets; switching clears unfinished selection. Copy prompt captures task ID, content version, render hash, brand, viewport and width, exact semantic IDs and source asset IDs. It includes only added groups and warns on unfinished input. Clipboard-denied browsers show selectable prompt text. The user pastes it into the existing ChatGPT task.

No auto-send, iframe bridge, queue write, analytics, API feedback persistence, login, screenshot upload or Figma call is involved. Feedback does not grant Train/canonical/publication/spending permissions. Before applying pasted feedback, the executing host must compare task, revision, render hash and every selected ID to current inventory. Changed version requires reconciliation, never silent retargeting.

## Security and completion

Content is escaped, layouts are schema constrained, and scripts are nonce protected. CSP disables connections/forms/base overrides; external media is HTTPS only. Generated HTML is `HTML_DRAFT_REQUIRES_VISUAL_QA`, with `visual_qc_performed:false`. The renderer never manufactures inspection receipts. No automatic publication or production claims are made.
