# UID Brands Onepage — cross-account quality audit

**Audit date:** 2026-11-12  
**Owner goal:** Any connected ChatGPT/Work account or UID Studio Web App should use the same brand-accurate content, image, banner, EO icon and QA intelligence without depending on a particular chat history.

## Verified runtime findings

1. The live PawfectHouse `compile_onepage_job` packet returns **25 current Creative DNA rules** with an upstream quality revision/hash. It defines desktop banner 2560×960, mobile 720×700, product truth, photo/scene roles, content approval, responsive campaign identity, physical proof, icon visuals and packaging.
2. Despite those rules, the packet reports `creative_quality_contract.canonical_visual_reference_catalog=[]`, `references=[]`, `reference_library_policy.usage=OPTIONAL_SUPPLEMENTARY_INSPIRATION`, and `reference_gate.status=NO_REQUIRED_STYLE_REFERENCES`.
3. The private Supabase Storage bucket `creative-dna-references` exists in the code path and the authenticated Admin upload/Member read proxy is implemented, but **the live bucket aggregate count was 0** (including `library/v1/` prefix) at audit time. No reusable approved image bytes were available to feed model visual conditioning.
4. Earlier QC contracts for banners, product physics, diversity and first-pass icons evaluate **host-supplied reports**, not pixels. A clean self-report is not automatically visual EO PASS.
5. The user-supplied screenshots demonstrate positive direction (natural kitchen moment + textured clean copy zone + legible expressive dark green lockup for Plastic Cups) and recurrent failure patterns (Tree Skirt solid slab; Guitar Pick staged blank wall; Plush Keychain insufficient type contrast; writing-board wrong user orientation). **These are conversation-local examples; their original pixel bytes are not yet an authenticated, owner-approved, cross-account reference set.** No private image was silently uploaded or published.
6. Existing Figma PFH Design file index contains Homepage, PDP and LDP pages; it does not by itself establish an authenticated owner-approved gallery of production Onepage banners. No current Onepage pixel census was claimed.

## Root cause

Canonical rules and technical QC are centralized, but **a versioned, explicitly approved visual exemplars catalog and genuine output-to-reference pixel review are not yet part of the default compiled packet**. A connected model is therefore free to interpret prose rules without seeing a PFH reference banner or icon set, causing quality variance across accounts/models.

## Changes in this PR

- Introduce `uid-onepage-portable-quality/2026-11-12.v1` playbook: creative roles, research and customer insight evidence, product truth, design diversity, banner scene-first/soft gradient contrast, visual proof, PFH EO icon tokens, mobile re-composition and stage-specific validation.
- Attach same playbook to `compile_onepage_job`, `resolve_creative_dna`, UI template manifest and native workflow, plus a read-only MCP/HTTP endpoint for all connected clients.
- Distinguish **unqueried reference catalog**, **queried but empty**, and **metadata present but pixels not verified**; never label empty catalog `approved`.
- Preserve canonical upstream rule precedence, user-approved content/versioning, exact Onepage UI, product claims and account authentication.
- Maintain brand scoping: PFH icon colors and typography style must not leak to GiftSoul/SoulPrise.

## Still required for actual cross-account visual quality parity

1. Use authenticated Admin Reference Library to upload a **small approved set of true PFH reference source images**, at least desktop+mobile banner pairs, EO icon family, product-details crop proof and candid lifestyle/UGC. Add provenance (product family, design/variant, status of approval, viewport, reason it meets standard, capture date); do not use negatives as positive reference examples.
2. Bind these approved reference IDs to canonical brand/branch rules and expose them securely to eligible authenticated ChatGPT/Work and Web App clients for actual model visual inspection (not just textual metadata). Respect cross-workspace authorization; a private URL alone is not transferable.
3. Add a host-side image inspection step comparing real rendered desktop/mobile assets with selected approved refs and actual PDP. The current server QC may validate the receipts but cannot perform that vision task.
4. Run a fixed blind benchmark on multiple accounts/models over the **same product, seed design pool, content lock, source images, template, layout size, and review criteria**. Compare both semantic and visual failure rates; do not call parity achieved before samples pass.

## Release discipline

**Technical deployment success is not Visual EO certification.** This release centralizes the execution intelligence and makes missing visual references explicit; it does **not** claim to have filled the empty approved reference library or to have made image generation deterministic.
