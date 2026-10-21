# Complete LDP design draft

The default PawfectHouse LDP outcome is a complete desktop/mobile visual draft for the owner to rebuild in Figma. Reduce hosting/code/review-UI overhead, not design completeness. There is no hosted URL or deployment completion gate and no Figma file creation requirement. Onepage delivery is unchanged.

## Handoff

1. Resolve current canonical rules, then create the existing source-backed full LDP plan, real asset outputs and sourced layout. Keep all SKU/product truth, material route dimensions, brand tokens, scope, approval/authority and freshness checks.
2. `ldp_design_draft.mapping` binds every ordered section, full copy/cards/destinations, evidence, asset specification/output, layout, hierarchy, token provenance and selectable element identity to the exact task/content/canonical snapshot. Deliver this mapping with the images. Unresolved claims or missing sources remain blockers.
3. Render the actual full desktop and mobile pages locally or through an authorized existing tool. Local HTML is optional, not a public web deliverable. Use final readable copy and actual assets. No placeholder blocks, missing footer/sections, truncated page, bare wireframe or invented review proof.
4. Download/read the exact image bytes and inspect both full images, including copy, assets, crops, hierarchy and section completeness. Compute checksums and keep truthful observation notes. Submit `research.ldp_design_draft` with current identity/mapping hash and desktop/mobile image receipts. This endpoint validates shape/revision only; `visual_qc_performed:false` always means the gateway did not inspect pixels. A host-reported receipt is not independent visual certification.
5. Attach both images and the exact mapping using supported delivery tools. Feedback stays in the existing chat and identifies task, content version, mapping hash, section/element IDs and viewport. Resolve current identity before edits, reject stale or missing targets, preserve unrelated content, and regenerate affected views/mapping. Feedback does not authorize canonical changes, publication or spending.

The legacy HTML renderer remains a local optional helper, with its old explicit hosted contract only for an intentionally requested hosted workflow. It is not invoked by the default resolver.

## Retired web demos

The synthetic demo and Sport Lovers v9 / Cooking BBQ v1 entry HTML are preserved byte-for-byte from main b67d665f in `archive/ldp-web-demos`. Their public entry routes return 410, including directory forms, instead of SPA fallback. Existing assets, manifests, source maps, CSS, scripts and brand components are not deleted or rewritten. Archived HTML is historical source, not a current delivered draft; relative paths are historical and the archive is not a runnable standalone bundle. Sport's generator additionally depends on previously external recovered materials/catalog/brand-reference inputs. Do not run it to fabricate evidence or timestamps.
