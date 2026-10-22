/** Feedback-first delivery. Legacy preview assets remain available without a hosting gate. */
export const ONEPAGE_REVIEW_RUNTIME_VERSION = '2026-10-20.v1';
export const ONEPAGE_REVIEW_ORIGIN = 'https://uid-brands-gateway-preview.onrender.com';
export function getOnepageReviewContract() {
  return {
    schema_version: 'uid-onepage-preview/1', runtime_version: ONEPAGE_REVIEW_RUNTIME_VERSION,
    delivery_mode: 'CHAT_OUTCOME_WITH_GROUPED_FEEDBACK', auto_send: false,
    hosted_url_required: false,
    feedback: { mode: 'copy_prompt_only', panel_url: `${ONEPAGE_REVIEW_ORIGIN}/onepage-panel.html`, opens_automatically: false, private_context_transferred: false, direct_chat_supported: true },
    runtime: {script: `${ONEPAGE_REVIEW_ORIGIN}/onepage-review.js`, css: `${ONEPAGE_REVIEW_ORIGIN}/onepage-review.css`, packager: `${ONEPAGE_REVIEW_ORIGIN}/onepage-review-pack.mjs`},
    manifest: {
      required: ['schema_version','identity_type','content_version','brand','template_version','asset_manifest'],
      schema_version: 'uid-onepage-preview/1',
      identity_type: 'task when a registered task_id exists; otherwise outcome with exact outcome_id. Never promote a Library file ID to task_id.',
      task_id: 'Exact current Onepage task ID when identity_type=task, never the demo ID.',
      outcome_id: 'Exact delivered outcome identity when identity_type=outcome; omit task_id when none exists.',
      content_version: 'Exact current output revision. Change whenever copy, assets, HTML or CSS change.',
      template_version: 'Selected canonical GTK/FAQ template version actually used.',
      asset_manifest: 'One entry per actual bound data-asset-slot: {slot, asset_id, file_url, checksum:"sha256:<64 lowercase hex>"}. Use the exact delivered asset ID, URL/path and checksum. Never invent mappings; include GTK only if actually present.',
      render_hash: 'Packager computes SHA-256 of the original bound HTML. A supplied mismatched hash is rejected.',
    },
    instruction: 'Return the actual Onepage content and original assets in chat with the current numbered inventory, then offer the existing Feedback Onepage panel: select targets, keep each instruction in its own group, copy and paste into the SAME conversation. Direct chat feedback is equally supported. At content approval, review prose only; never offer nonexistent image targets. Do not deliver or require a hosted web preview, publish task materials, or block delivery on hosting. Preserve the required overall PNG mapping rendered from the actual bound HTML and the production WebP package when packaging is explicitly requested. Bind approved copy/assets to the canonical GTK/FAQ template for internal desktop/mobile visual QA; preserve layout and do not substitute a demo. The panel knows generic slots only, not task data, versions or actual assets. Before applying feedback, verify the current task or explicit outcome identity, content version and actual inventory; for registered tasks resolve each group against the current review index, and stop on stale, missing or ambiguous mappings. Unregistered outcomes use host-verified direct chat against their explicit outcome identity, version and actual inventory; do not pass them through the task-only review-index tool. If a legacy element-feedback packet is supplied, also verify its render hash and each selected element/asset. Never fabricate a task ID for an unregistered outcome. Preserve unrelated approved content, research, real image inspection, QC and packaging gates. Feedback does not authorize Train, publication, approval or automatic execution.',
    limitations: ['Packaging is not pixel QA, asset verification or task freshness verification.','Already-downloaded previews cannot know that a newer task revision exists. The receiving host must verify the packet against current task state before editing.','Relative CSS and image files must remain alongside the HTML. Private task output is not automatically uploaded or publicly hosted.'],
  };
}
