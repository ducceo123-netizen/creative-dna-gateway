# Onepage UI template

UI mapping uses one backend-owned snapshot, `templates/onepage-ui-v1.json`, captured from the owner-approved PawfectHouse Onepage on 2026-10-03. The shared structure applies to PawfectHouse, GiftSoul and SoulPrise. Brand art, product evidence and exact user copy remain governed by their existing rules.

`compile_onepage_job` and successful Onepage `resolve_creative_dna` responses include `ui_mapping_template`: the pinned version, public download URLs, SHA-256 hashes, required slots and binding/QA instructions. Other branches and failed upstream responses remain unchanged. Agents do not need Library access or a live storefront scan to obtain layout code.

`get_onepage_ui_template` returns the manifest by default; `format=source` returns HTML/CSS inline when required. Download `template.html` and `styles.css` into the same folder, or download `bundle.json`. Fonts and the three fixed UI checkmarks are embedded. Use a DOM parser to bind `data-asset-slot` and `data-text-slot`, then render the mapping. Only the normal mapping WebP belongs in the final creative asset package.

Stable routes:

- `/api/onepage-ui-template/2026-10-03.v1/manifest.json`
- `/api/onepage-ui-template/2026-10-03.v1/template.html`
- `/api/onepage-ui-template/2026-10-03.v1/styles.css`
- `/api/onepage-ui-template/2026-10-03.v1/bundle.json`

These read-only, nonsensitive template routes use the gateway's existing CORS and rate limits and require no user session. Unknown versions/files return 404. Source responses have hashes/ETags and immutable caching. The gateway module is imported by its Vercel API entry point, so the template JSON is bundled with the API rather than relying on deployment-local filesystem paths.

Never overwrite an existing version. For a future approved layout change, add a new version and retain the old snapshot/URLs. Update the active registry and compiler manifest together. Preserve the captured 798px CSS / 799px picture-media behavior until explicitly revised. Download/source integrity is verified separately from rendered pixel parity; this snapshot's manifest reports pixel parity as not yet verified.

The old Library ZIP and four accepted feedback fragments remain historical evidence. The executable source is this backend registry and its returned URLs. No database migration, new secret or Member permission is required.

Validation: `npm run lint`, `node --import tsx --test tests/onepage-ui-template.test.ts`, and `npm run build`.

## Canvas spacing revision

Active version `2026-10-03.v2` adds 32px gutters on desktop and 16px at widths up to 798px. The module is wrapped in a mapping canvas and its outer theme shell fits the available canvas width without the theme column margins doubling the gutter. Original Onepage DOM, inner layout CSS, fonts, slots and masks are retained. Version `2026-10-03.v1` remains available with its original hashes. This spacing change was explicitly requested by the owner on 2026-10-03.


## FAQ restoration — 2026-10-19

`get_onepage_ui_template()` advertises `variants.gtk` and `variants.faq`. Select
`version=2026-10-19.faq.v1` when approved content chose FAQ; the default remains
GTK for existing clients. `ui_mapping_templates` exposes both manifests in the
Onepage resolver/compiler response. FAQ replaces only the post-story GTK block,
removes GTK asset/copy slots and fixed checkmarks, and retains all other bytes.
No canonical rule, compiler pin, research gate, tool input schema or auth changes.

The store's public product-content.css still has the FAQ accordion styles. The
36 sampled PDPs and four browser-inspected PDPs did not provide live FAQ DOM.
The restored fragment is therefore explicitly **reconstructed from verified
store CSS**, not a claimed live DOM capture or pixel-identical snapshot. Its
manifest preserves the CSS source URL/hash and this limitation.

Use a DOM parser and the `faq_binding` instructions to repeat one row per exact
approved question/answer, bind via textContent, assign unique checkbox/label
IDs, and leave ALL checkboxes checked for review/export. No fixed FAQ count,
product copy, GTK placeholders or auto-selection is introduced. Verify long
copy at desktop, mobile and 798/799px; expand every answer again before capture.
The final mapping filename is `onepage_{product_slug}-overall.png`; production
assets stay WebP. Existing template HTML/CSS versions and hashes are unchanged.

Deploy the gateway containing this template revision before claiming the live
capability. No database or Edge deployment is needed for this additive adapter.
