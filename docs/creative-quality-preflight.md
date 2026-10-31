# Creative quality gates: actual bytes and fixed UI

This is a local, no-network host pipeline, not a new provider API or an output-QC approval.
The existing `get_onepage_ui_template` manifest now points hosts to this gate. Its API
still only binds strings and explicitly does not fetch/decode assets.

## Run before mapping / provider handoff

1. Download the exact approved assets through the existing authorized provider path.
   Preserve revision and asset identities in the calling job; never infer them from filenames.
2. Run `npm run quality:preflight -- /absolute/path/manifest.json`.
3. Supply `onepage` to make this the **actual binding pipeline**: it decodes every asset,
   re-reads bytes and hashes them, checks slot-to-path equality, then invokes the existing
   deterministic binder. A blocked print check returns `onepage:null`, not a usable output.
4. Save returned bound HTML beside unchanged CSS and the verified relative asset files.
   Render desktop/mobile, inspect actual images, and test provider personalization separately.
   Native artwork/version changes invalidate this evidence. This command does not submit QC.

```json
{
  "schema_version": "uid.creative-package-input.v1",
  "assets": [{"id":"hero_desktop","path":"assets/hero.webp","sha256":"<actual 64-hex hash>"}],
  "onepage": {"template_version":"<existing approved version>","bindings":{"text":{"<every actual text slot>":"approved copy"},"assets":{"<every actual asset slot>":"assets/file.webp"}}}
}
```

Example above abbreviates inventory; real manifests must list **every** selected template
slot, including repeated FAQ copy when applicable. Unknown text slots, including an
invented Occasion heading, are rejected by the binder. Missing/mismatched/duplicate
asset slots, traversal, symlinks, corrupt/truncated/animated or unsupported media fail.
Local references use canonical ASCII filename segments only; URL query/fragment/percent escapes, backslashes and dot segments are rejected so decoded files match browser references. Every manifest/image/revalidation read uses a bounded regular-file descriptor, rejects symlinks and checks identity/mtime before returning. No URLs are fetched. Limit: 100 assets, 1 MiB manifest, 32 MiB encoded asset, 32 million
pixels per full decode; processing is sequential to bound peak memory.

### Print placement, never header DPI

Each asset can carry `placement: {width_inches,height_inches,crop?:{left,top,width,height}}`
and `supplier_spec: {product_id,source_url,evidence_sha256,minimum_ppi,verification}`.
Crop coordinates use **orientation-corrected original decoded pixels**. Effective PPI is
retained crop pixels divided by actual physical placement, per axis. Missing supplier
specs or `verification:"unverified"` block print checks. There is **no default PPI target**.
The caller must independently read the source, verify the hash/product association and
record its approval; this library cannot prove a supplied verification flag. It always
returns `supplier_evidence_independently_verified:false` and `print_ready:false`.
Embedded density, upscaled dimensions, decoded pixels and metadata do not prove detail,
visual quality, color/profile compliance, provider print area or product truth.

### Color-only Teeinblue form scaling

Optional `brand_colors` accepts only six semantic tokens: `preview_background`,
`preview_text`, `cart_background`, `cart_text`, `upload_background`, `upload_text`.
Values are opaque six-digit `#RRGGBB`. Output is deterministic color-only CSS for
`.tee-btn--preview`, `#teeAtcButton`, `.tee-btn--upload`. No arbitrary selectors, JS,
CSS/config transforms, opacity, fonts, dimensions, text, fields or markup are accepted.
Apply only to the **captured existing form**, not a reconstructed form. Verify these
selectors exist in that source; unsupported forms block until an explicit reviewed
adapter exists. The compiler does not silently recolor brand imagery or alter Onepage
source CSS. No Style Dictionary dependency is needed for six fixed mappings.

### Browser state/structure comparison

`source = fixed_ui.capture(sourcePage, selector, tokens)` and the same call for the
candidate, followed by `fixed_ui.compare`, compare exact DOM attributes/text/control
state, non-color computed styles, ::before/::after generated content/styles and geometry. Use identical viewport/font/runtime and
repeat each meaningful real source state: default, custom choice, text length, upload,
preview open/close, validation, disabled and reset. Tokens only exclude corresponding
computed color properties and currentColor derivatives; exact CSS generation remains
owned by the strict compiler. Browser comparison does not auto-accept baselines.

`npm run quality:fixed-ui` runs Chromium at 390 and 1280px against the real checked-in
Onepage template plus a **clearly synthetic form fixture**, with 5 native fixture states
and deliberate structural/font/spacing/control/content faults. It is wired into existing
Gateway UI CI, reusing Playwright rather than another automation framework. The fixture
is not evidence that any particular live Teeinblue customizer has passed interaction QC.
No screenshot or semantic visual-QC receipt is fabricated.

## Dependencies / trust

Sharp is pinned to `0.35.5` from the official npm package, Apache-2.0; lockfile includes
registry integrity. `metadata()` alone is insufficient: `rotate().raw().toBuffer()`
forces complete decode with input limits. Source: https://sharp.pixelplumbing.com/api-input/
and https://sharp.pixelplumbing.com/api-constructor/ . No package install scripts needed.
Existing CI uses Python Playwright 1.55.0; no new browser service/subscription required.
No production DB, queue, credential, provider artwork, publish or paid worker is changed.
