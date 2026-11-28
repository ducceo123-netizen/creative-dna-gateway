# Incremental transport and context optimization

This release changes only the experimental V2 adapter and context bookkeeping. It leaves canonical packet creation, rule text, model/effort, research, reference inspection, Creative DNA, QC criteria, templates, approval prerequisites and artifact bytes unchanged. No database migration or environment change is required.

## Client contract

- Routine state results keep current job/content revisions, blockers, conflicts, context identity, exact asset/render/package hashes and approvals. Repeated canonical/completed step lists become explicit counts. Known PNG/WebP dimensions are available through `onepage_get_state` with `detail:"full"`; unknown fields/formats remain visible.
- Stage context always contains the full required rule text. Its compact receipt replaces duplicate `requiredRuleIds` and `ruleHashes` with `coverageRef:"#/coverage"`. Both values remain present in the same response. The original bundle hash still identifies the expanded canonical bundle. `detail:"full"` provides the original response shape.
- The durable full coverage receipt remains the only gate input. A wire receipt is never accepted as a substitute for stored evidence. Repeated reads skip job/history writes only if every receipt in the group matches exactly.
- `state.context.loaded` means the server previously issued matching coverage. It does not attest to model memory. A host may avoid a repeated call only when it actually retains the complete bundle and its stage, snapshot hash, template mode and bundle hash still match. Reconnect or context loss requires reloading. No cross-stage delta or rules-by-ID-only response exists.
- Use the revision returned by a successful mutation for the next action. Reload state after conflict, reconnect or uncertain completion. All writes still enforce revision checks.
- Public `onepage_get_rule_or_evidence` now preserves arrays, strings, nulls and canonical objects exactly instead of spreading them into a metadata object. Other public status replies and initialization still disclose the shared anonymous sandbox.

## Validation and measurement

Run `npm --prefix v2 test`, `npm --prefix v2 run lint`, `npm --prefix v2 run build`, and `node --test v2/test-kit/public-mode.test.mjs`. The offline benchmark is `node --import tsx v2/optimization-benchmark.ts SNAPSHOT_DIRECTORY`; it expects the three authorized brand JSON files and exports only sizes/hashes/statuses. The test kit exercises compact/full fallback and repeated context reads on the deployed service.

Live before/after checks use the same three existing public jobs and pinned packets. State and context byte counts are reported separately from tool-schema/initialization overhead, which increases slightly to explain the new contract. The protocol comparison also restores and compares the exact previous stage bundle and full packet.

Wire bytes, avoided job writes and retained canonical data do not establish token billing, end-to-end creative speed or EO parity. Actual GPT connection, model usage and blinded creative A/B remain separate acceptance requirements. The previous workspace 403 still applies; this release does not retry plugin creation or claim it was successful.

## Isolation and rollback

Deploy only `uid-brands-architecture-v2-test` (`srv-dc53i6vf3r2c73dd34ig`) from `experiment/uid-brands-architecture-v2`, with automatic deploys disabled. Public test authentication and the separate Supabase project remain unchanged. Do not merge main or deploy another service.

To undo this release, redeploy the previously verified public application commit `1a51f4c61e7c4d22404410ee6528c5bba5569d93` to that same test service. Do not restore or migrate the database. Stored jobs/receipts retain their original schemas; earlier code can resume them. Older clients that depend on complete state arrays should use `detail:"full"` on the new endpoint or the corresponding previous test-kit version after rollback.
