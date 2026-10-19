# Creative-quality propagation contract

The Onepage compiler and public resolver now use the same pure compiler in `supabase/functions/_shared/creative-quality.ts`. The gateway preserves its result and rejects missing, malformed, wrong-route or unsupported quality envelopes. This synchronizes the rules supplied to each account. It does not guarantee identical generated pixels or certify artistic quality.

## Canonical data

The existing PawfectHouse-master database trigger mirrors Onepage metadata to GiftSoul and SoulPrise. Therefore one additive `metadata.creative_quality_contract` catalog is stored on the master, with `schema_version: uid-creative-quality-catalog/1` and `contracts` keyed by exact brand slug. The existing trigger propagates that same catalog; the compiler selects only the active brand, never a fallback. Each selected contract contains:

- `schema_version`, `revision`, and source SHA-256 hashes for branch and brand DNA
- Reviewed rules with stable IDs, category, constraint key/value, concise instruction, source locator and optional exact source excerpt
- Explicit brand/branch/product-URL scope; product cases do not become global font or styling defaults
- Explicit `supersedes` IDs, restricted to the same constraint key and narrower/equal scope
- Optional supplementary case/reference identities, with advisory `reference_ids` and `suggested_for` slot hints
- Only explicitly reviewed, scoped `usage: required_evidence` records and `required_reference_ids` may introduce a mandatory evidence dependency

Hash input is recursively key-sorted JSON of node slug, version, canonical Markdown and metadata excluding the contract itself. Changes to either canonical source invalidate a stale contract. No model or network request is involved in compilation, and account identity/timestamps are excluded from the fingerprint.

The reviewed initial compact set covers product-led research/copy, distinct section purpose, non-redundant buyer questions, category-appropriate campaign typography, optical mobile balance, product-caused moments, exact SKU physical truth, Details anchor consistency, independent creative diversity, dynamic device/annotation proof, UI mask QA, icon grammar, active brand expression and review/packaging gates. Historical fixed-GTK, icon-ring and mapping-WebP rules are explicitly superseded. Reference Library images are supplementary inspiration, never required seeds or universal style. Private reference pointers are not treated as accessible pixels.

## Runtime behavior

- Missing/invalid/stale contracts, duplicate IDs, missing local brand expression, unresolved same-key conflicts and invalid/cyclic supersession visibly block compilation. No silently truncated rule list or fallback to account memory.
- Content authoring remains possible with a valid contract while optional case images are unavailable, subject to real PDP research and normal copy approval.
- An empty Reference Library, unavailable case images or missing advisory `reference_ids` never block creation. There is no fixed set or count of seed images. Optional examples cannot override active brand expression, product facts, dimensions, quality rules or approval gates.
- Compiler `2026-10-11-v2` treats reference records without a `usage` as `supplementary_inspiration`. Legacy `required_for` values on those records become `suggested_for` hints, and the emitted `required_for` is empty. A usable optional image is `FETCH_IF_SELECTED`; inspect its actual pixels only if using it, otherwise omit it. Uploaded/canonical catalog metadata cannot promote itself into a mandatory rule or prove a product fact.
- Explicit `usage: required_evidence` is reserved for reviewed canonical evidence requirements, with scope and at least one affected asset slot in `required_for`. A rule may name an essential dependency in `required_reference_ids`; an absent or supplementary record cannot satisfy it. These checks are separate from optional inspiration and remain fail-closed.
- Missing required evidence identifies the affected slots and blocks their asset stage. A usable evidence URL means `FETCH_REQUIRED`, never inspected/approved pixels. With no explicit extra evidence dependency, the asset gate is `REQUIRES_PRODUCT_PIXEL_INSPECTION`; with required evidence it remains `REQUIRES_PRODUCT_AND_REFERENCE_PIXEL_INSPECTION`. Actual matching product/PDP evidence must always be acquired and inspected. Neither gate claims generation is already ready.
- Category indexes refer to the single complete rule list; packets do not repeat the 443 KB historical source or repeat full rules for every slot.
- Human artistic review remains mandatory. Mechanical checks and matching policy hashes are not an artistic score or an identical-output guarantee.
- The backend returns no-store responses for current resolver/compiler state. Immutable template assets remain versioned.

## Template compatibility

`2026-10-11.v3` changes manifest delivery instructions only. Its HTML/CSS are byte-for-byte identical to `2026-10-03.v2`. Current delivery is production WebP assets plus one `onepage_{product_slug}-overall.png`. New v3 download URLs use the verified Render gateway origin; older template versions retain their historical instructions and URLs. A future format policy incompatible with the current immutable manifest visibly blocks mapping until a reviewed metadata revision is published.

Four occasion icons are listed. Explicit aliases bind `occasion_01/02` to the template's `occasion_story_01/02`. The historical slot named `occasion_story_01_mobile` is actually the Product Details picture source, so it binds to `detail_main` and preserves the anchor SKU.

The approved GTK-or-FAQ decision is propagated. The gateway exposes separate immutable GTK and FAQ mapping variants; consumers must select the variant from the approved content decision. FAQ v2026-10-19.faq.v1 reconstructs the missing markup against verified store CSS, with explicitly disclosed lack of captured live FAQ DOM/pixel parity. It uses exact approved questions/answers, all expanded for review, and no GTK placeholder images. Upstream legacy packet capability text is resolved only by the gateway serving the actual variant; quality and research gates remain independent.

## Updating approved wisdom

An approved canonical merge changes the source hash and intentionally marks the old compact contract stale. Before restoring ready status:

1. Review the accepted change, its explicit scope, evidence and conflicts. Keep product-only and brand-only decisions scoped.
2. Update the relevant rule(s), source locator/excerpt, supersession and revision. Do not mechanically promote arbitrary appended prose or pending feedback to universal policy.
3. Read both current source nodes, recompute hashes with `sourceHashes`, and call `compileCreativeQuality` against those exact sources.
4. Apply a guarded atomic metadata update. Abort if either source changed since review.
5. Verify the current compiler and resolver return the same revision/hash for the same route/context. Run the full test suite and confirm affected runtime gates.

Until that reviewed rebuild occurs, the API reports the stale contract honestly. This is an explicit maintenance requirement, not an implemented automatic semantic-review service.

## Deployment and rollback

No database schema, permissions, membership, credentials, storage visibility or RLS changes are part of this rollout. The data sync only adds contract metadata to three existing active Onepage nodes and the missing GiftSoul Onepage aliases. The private Reference Library storage/UI rollout is independent of this quality-contract metadata change. Adding or removing a library image never edits canonical rules.

Order:

1. Save exact old source/node snapshots; validate the approved bundles locally.
2. Validate all three branches and latest brand-DNA content/version/slug/metadata guards before writing; then update only the existing PawfectHouse master so its normal trigger fans the catalog out atomically. Confirm three active contract revisions and both GiftSoul aliases.
3. Deploy `creative-dna-public` and `creative-dna-compile-onepage` with the shared source files. Retain their existing `verify_jwt=false` public read-only behavior. Do not expose private image URLs.
4. Publish the reviewed gateway change, verify CI for the exact commit, then deploy the existing verified Render service.
5. Check three brands using human aliases and exact slugs, compare compiler/resolver hashes, verify optional inspiration cannot block creation and explicit evidence gates remain enforced, template metadata/layout hashes and health. Check error logs.

Backend rollback snapshots are in `docs/quality-rollout/rollback-compiler-v2.ts.txt` and `rollback-public-v3.ts.txt`. Redeploy those exact prior function sources with their prior settings, then restore the prior gateway commit. Metadata-only rollback removes only the exact installed catalog object from the master and verifies the existing mirror fanout; it must abort rather than overwrite a newer bundle. The additive valid GiftSoul aliases may remain. An old gateway/edge rollback reintroduces the known quality-propagation limitation and must be reported as such.

## Verification

`npm test`, `npm run lint`, and `npm run build`. Tests cover account-independent fingerprints; source/brand/style propagation; product-specific scoping; supersession conflicts/cycles; stale canonical state; optional empty/missing/available case images across all three brands; legacy seven-image removal; private/signed/revoked/mismatched required evidence; real Edge handler paths with stubbed RPC; complete template slot bindings; malformed gateway envelopes; immutable manifest compatibility; and all prior UI/attachment/governance regression tests. Production validation is recorded separately after rollout; local passing tests alone are not a live deployment claim.


## Canonical optional-library correction plan (prepared, not applied)

The historical live catalog revision is `2026-10-11-approved-quality-v1` (28 stored / 25 active rules per brand). Local rollout snapshots are historical evidence, not authority to overwrite the current database. The old seven references are all style examples, not primary product evidence. Their exact identities and rule associations remain in the private rollout snapshots; the public repository contains only generic examples.

The new compiler already interprets those old links as optional, so deployment does not depend on uploading any of the seven images. Canonical cleanup should remove fixed-example dependencies as follows:

1. Obtain fresh snapshots of each active Onepage node and each latest active brand-DNA node for `pawfecthouse`, `giftsoul` and `soulprise`, including IDs, version, content, input schema, status, confidence, metadata and updated timestamp. Read the current master/mirror trigger definitions. Require exactly one active Onepage node per brand and the expected exact master catalog on all three. Stop on ambiguity or any unexpected newer revision.
2. Build a new brand-keyed catalog using the fresh bundles, retaining all unrelated rules, reference records and metadata. Set each bundle revision to `2026-10-11-optional-reference-library-v2` (or a later reviewed revision if that revision already exists).
3. Remove the seven legacy records identified in the reviewed private snapshot from `references` and remove only those seven IDs from their three associated rules' advisory `reference_ids`, omitting an empty property. Do not remove the three rules or change their active typography, responsive composition or reviewed icon instructions. Do not relabel the seven as `required_evidence`, auto-upload them, or copy them into the new library. Library contents are user-managed and need no baseline seed.
4. In `content.brevity.v1`, preserve the approved word-count guidance and replace only “Calibrate whole-page density to references.” with “If a relevant supplementary case is selected, it may inform whole-page density; no case image is required.” Record the user-approved correction in its source locator/revision without fabricating a canonical excerpt. Keep all source research, physical truth, exact SKU/variant, UI proof, review, delivery and brand-local rules intact.
5. Recompute `sourceHashes` against the fresh source nodes. A catalog-only metadata change leaves these hashes unchanged, because the catalog itself is excluded. Do not edit historical prose or non-contract metadata to hide disagreement; the active compiled policy takes precedence. If a separate reviewed source change is needed, update and rehash it explicitly.
6. Compile all three proposed bundles locally against the exact fresh snapshots. Verify the rule set is otherwise unchanged, the correct brand-local expression is active, no optional image is required, `reference_gate.missing_reference_ids` and `blocked_asset_slots` are empty (unless an unrelated explicit required-evidence dependency exists), and product evidence plus human review remain required. Empty and populated user libraries must have the same mandatory rules.
7. In one guarded transaction, lock the three Onepage rows and the exact reviewed brand-DNA rows. Abort if any reviewed source field or old catalog differs from the snapshot, including a newly active brand-DNA version. Update only the PawfectHouse master with `jsonb_set(metadata, '{creative_quality_contract}', :new_catalog)`. Never write the GiftSoul/SoulPrise mirrors separately, disable triggers, or overwrite the rest of metadata. Let the existing master trigger fan out. Verify the exact new catalog on all three and unchanged content/version/input schema/non-contract metadata/status/confidence, then commit; otherwise raise and roll back.
8. Deploy the shared v2 compiler in both `creative-dna-public` and `creative-dna-compile-onepage` and the matching gateway validator in a coordinated release. The v2 gateway intentionally rejects the older v1 compiler envelope instead of claiming the updated semantics. Preserve existing public read-only/JWT settings and private image boundaries. Check resolver/compiler hash parity for all three brands, source/product gates, template compatibility and no missing-seven creation gate.
9. For rollback, restore only an exact-match installed catalog to its saved predecessor through the same guarded master transaction and verify fanout. Never overwrite a newer user/library or canonical change. Rolling back the v2 compiler reintroduces the old fixed-style-reference gate and must be disclosed.

This plan makes no Supabase changes and performs no deployment. It does not alter database schema, membership, RLS, bucket visibility or credentials.
