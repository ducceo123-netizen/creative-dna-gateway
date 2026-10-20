/** Delivery contract for instrumenting the actual bound Onepage, never a replacement layout. */
export const ONEPAGE_REVIEW_RUNTIME_VERSION = '2026-10-20.v1';
export const ONEPAGE_REVIEW_ORIGIN = 'https://uid-brands-gateway-preview.onrender.com';
export function getOnepageReviewContract() {
  return {
    schema_version: 'uid-onepage-preview/1', runtime_version: ONEPAGE_REVIEW_RUNTIME_VERSION,
    delivery_mode: 'ACTUAL_BOUND_ONEPAGE_HTML_WITH_GROUPED_ELEMENT_FEEDBACK', auto_send: false,
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
    instruction: 'After binding approved copy/assets into the selected canonical Onepage HTML/CSS, package THAT actual bound HTML for live feedback. Download onepage-review.js, onepage-review.css and onepage-review-pack.mjs together. Write the exact current manifest JSON, then run node onepage-review-pack.mjs bound.html manifest.json review.html with review.html beside bound.html. Deliver the review HTML and its actual relative CSS/assets (or an authorized hosted URL) in addition to, not instead of, the required overall PNG and production WebP package. Never use the demo as task output. Do not redraw/import LDP layout, add placeholder assets, synthesize a missing GTK section or drop existing review routes. Inspect actual desktop/mobile output and grouped copy before delivery. The toolbar reads rendered inventory only; it does not submit feedback, publish, approve or train. Before applying copied feedback, compare task ID, content version, render hash and each selected element/asset against the current task; stop on stale or missing mappings. Preserve group boundaries and unrelated approved content.',
    limitations: ['Packaging is not pixel QA, asset verification or task freshness verification.','Already-downloaded previews cannot know that a newer task revision exists. The receiving host must verify the packet against current task state before editing.','Relative CSS and image files must remain alongside the HTML. Private task output is not automatically uploaded or publicly hosted.'],
  };
}
