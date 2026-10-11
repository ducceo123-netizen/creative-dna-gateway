# Creative-quality propagation contract

The Onepage compiler and public resolver now use the same pure compiler in `supabase/functions/_shared/creative-quality.ts`. The gateway preserves its result and rejects missing, malformed, wrong-route or unsupported quality envelopes. This synchronizes the rules supplied to each account. It does not guarantee identical generated pixels or certify artistic quality.

## Canonical data

Each active Onepage node has one additive `metadata.creative_quality_contract` object:

- `schema_version`, `revision`, and source SHA-256 hashes for branch and brand DNA
- Reviewed rules with stable IDs, category, constraint key/value, concise instruction, source locator and optional exact source excerpt
- Explicit brand/branch/product-URL scope; product cases do not become global font or styling defaults
- Explicit `supersedes` IDs, restricted to the same constraint key and narrower/equal scope
- Required visual-reference identities with affected asset slots

Hash input is recursively key-sorted JSON of node slug, version, canonical Markdown and metadata excluding the contract itself. Changes to either canonical source invalidate a stale contract. No model or network request is involved in compilation, and account identity/timestamps are excluded from the fingerprint.

The reviewed initial compact set covers product-led research/copy, distinct section purpose, non-redundant buyer questions, category-appropriate campaign typography, optical mobile balance, product-caused moments, exact SKU physical truth, Details anchor consistency, independent creative diversity, dynamic device/annotation proof, UI mask QA, icon grammar, active brand expression and review/packaging gates. Historical fixed-GTK, icon-ring and mapping-WebP rules are explicitly superseded. Private reference pointers are not treated as accessible pixels.

## Runtime behavior

- Missing/invalid/stale contracts, duplicate IDs, missing local brand expression, unresolved same-key conflicts and invalid/cyclic supersession visibly block compilation. No silently truncated rule list or fallback to account memory.
- Content authoring remains possible with a valid contract while visual references are unavailable, subject to real PDP research and normal copy approval.
- Missing required references identify the affected slots. A usable URL means `FETCH_REQUIRED`, never inspected/approved pixels. The generating account must retrieve and inspect the actual images. Product references must also be inspected.
- Category indexes refer to the single complete rule list; packets do not repeat the 443 KB historical source or repeat full rules for every slot.
- Human artistic review remains mandatory. Mechanical checks and matching policy hashes are not an artistic score or an identical-output guarantee.
- The backend returns no-store responses for current resolver/compiler state. Immutable template assets remain versioned.

## Template compatibility

`2026-10-11.v3` changes manifest delivery instructions only. Its HTML/CSS are byte-for-byte identical to `2026-10-03.v2`. Current delivery is production WebP assets plus one `onepage_{product_slug}-overall.png`. New v3 download URLs use the verified Render gateway origin; older template versions retain their historical instructions and URLs. A future format policy incompatible with the current immutable manifest visibly blocks mapping until a reviewed metadata revision is published.

Four occasion icons are listed. Explicit aliases bind `occasion_01/02` to the template's `occasion_story_01/02`. The historical slot named `occasion_story_01_mobile` is actually the Product Details picture source, so it binds to `detail_main` and preserves the anchor SKU.

The approved GTK-or-FAQ decision is propagated, but the shipped DOM supports GTK only. FAQ mapping is explicitly unavailable until a separately verified FAQ template variant is implemented. No placeholder GTK images or UI redesign are invented.

## Updating approved wisdom

An approved canonical merge changes the source hash and intentionally marks the old compact contract stale. Before restoring ready status:

1. Review the accepted change, its explicit scope, evidence and conflicts. Keep product-only and brand-only decisions scoped.
2. Update the relevant rule(s), source locator/excerpt, supersession and revision. Do not mechanically promote arbitrary appended prose or pending feedback to universal policy.
3. Read both current source nodes, recompute hashes with `sourceHashes`, and call `compileCreativeQuality` against those exact sources.
4. Apply a guarded atomic metadata update. Abort if either source changed since review.
5. Verify the current compiler and resolver return the same revision/hash for the same route/context. Run the full test suite and confirm affected runtime gates.

Until that reviewed rebuild occurs, the API reports the stale contract honestly. This is an explicit maintenance requirement, not an implemented automatic semantic-review service.

## Deployment and rollback

No database schema, permissions, membership, credentials, storage visibility or RLS changes are part of this rollout. The data sync only adds contract metadata to three existing active Onepage nodes and the missing GiftSoul Onepage aliases. The separately reviewed private-reference delivery project is independent.

Order:

1. Save exact old source/node snapshots; validate the approved bundles locally.
2. Apply the reviewed atomic data-only sync with branch and latest brand-DNA content/version/metadata guards. Confirm three active contract revisions and both GiftSoul aliases.
3. Deploy `creative-dna-public` and `creative-dna-compile-onepage` with the shared source files. Retain their existing `verify_jwt=false` public read-only behavior. Do not expose private image URLs.
4. Publish the reviewed gateway change, verify CI for the exact commit, then deploy the existing verified Render service.
5. Check three brands using human aliases and exact slugs, compare compiler/resolver hashes, verify expected missing-reference gates, template metadata/layout hashes and health. Check error logs.

Backend rollback snapshots are in `docs/quality-rollout/rollback-compiler-v2.ts.txt` and `rollback-public-v3.ts.txt`. Redeploy those exact prior function sources with their prior settings, then restore the prior gateway commit. Metadata-only rollback removes only the exact installed contract object; it must abort rather than overwrite a newer bundle. The additive valid GiftSoul aliases may remain. An old gateway/edge rollback reintroduces the known quality-propagation limitation and must be reported as such.

## Verification

`npm test`, `npm run lint`, and `npm run build`. Tests cover account-independent fingerprints; source/brand/style propagation; product-specific scoping; supersession conflicts/cycles; stale canonical state; missing/private/signed/revoked/mismatched references; real Edge handler paths with stubbed RPC; complete template slot bindings; malformed gateway envelopes; immutable manifest compatibility; and all prior UI/attachment/governance regression tests. Production validation is recorded separately after rollout; local passing tests alone are not a live deployment claim.
