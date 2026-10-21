# Delivery update

The default LDP delivery is now the complete desktop/mobile design draft described in [ldp-design-draft.md](ldp-design-draft.md). No hosted HTML URL is required. The HTML-specific procedure below is legacy optional rendering guidance, not the default completion gate.

# LDP host execution: verified plan to HTML/CSS preview

The active delivery flow is HTML/CSS with direct selection and grouped Copy prompt feedback. Figma assembly is no longer a production step. Preserve existing user files; old operational documentation is available through git history.

## Start and research

From the user's collection URL, resolve current canonical brand/LDP instructions, discover live same-brand design references and research the actual product pool. Verify selected SKU variants, full galleries, details and product pixels. Record limitations, pagination completeness and excluded products. Live references supply brand layout/style evidence, not conversion guarantees. Do not copy source semantic defects or unsupported claims.

Author the plan as the executing UI/UX designer: idea, hierarchy, shopper journey, section variation, mobile decisions, precise source tokens and asset mapping. Use the existing research.ldp_job schema. Bind task, research_snapshot, canonical_snapshot and content_version. Resolve validation errors; honor any user-requested checkpoint. Verify original execution authority from actual user context, not merely the submitted packet.

## Asset handling

Use verified source media or generate only within the actual requested/authorized scope and current material rules. Inspect each actual output, preserve product geometry/artwork and mobile continuity, verify bytes/dimensions/checksum and record a genuine review note. Do not manufacture evidence or approval. Missing assets block the affected preview instead of becoming placeholders. No public-storage workaround for private assets.

## Build the preview

Supply revision-bound research.ldp_asset_outputs and research.ldp_preview_layout using the schema returned in ldp_preview_contract. Every actual section requires sourced desktop/mobile layout, columns, fit, focal alignment and observed same-brand reference. Typography requires source evidence; baseline tokens supply brand colors, font, spacing and radii. Do not invent a generic baseline for another brand.

The resolver returns ldp_html_preview.html only when current plan/evidence/asset inventory match. Save the returned HTML through authorized file handling. This is a review draft: verify desktop/mobile rendering, font availability, content, crops, links, long text and any complex geometry against source. The stack/split/grid renderer is not a captured brand DOM or pixel-parity guarantee. If the actual page needs unsupported hero/header/footer geometry, report and implement that authorized HTML work before claiming a finished layout.

## Direct review and handoff

Deliver the standalone HTML and original assets/mapping; use Render only if a hosted preview is needed and authorized. The user opens the file, enables Select elements, selects text/images/cards or Whole section, adds a note for each group, and copies the generated prompt into ChatGPT. Copy fallback exposes selectable text if clipboard access is unavailable. No login, automatic transmission, feedback server persistence or screenshot-upload step is required.

Validate pasted feedback against exact task, content_version, render_hash and actual selected IDs. Apply each group's note only to its scope/viewport. Return the revised HTML and asset mapping. Feedback alone does not authorize canonical changes, Train, spending, publication or permission expansion.

## Completion

Report what was actually produced and inspected, along with any source/layout gaps. Generated HTML remains HTML_DRAFT_REQUIRES_VISUAL_QA and visual_qc_performed:false until real host inspection is separately evidenced. Test fixtures must remain explicitly synthetic and never masquerade as the user's task or a verified brand outcome.

See [workflow contract](ldp-workflow-contract.md) and [preview schema and controls](ldp-html-preview.md). No Figma receipt or node ID is required by this active flow.
