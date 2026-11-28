---
name: onepage-v2-test
description: Use only for explicitly requested isolated UID Brands Architecture V2 Onepage tests for PawfectHouse, GiftSoul or SoulPrise.
---

# Isolated Onepage V2

Use only this plugin's verified V2 tools at https://uid-brands-architecture-v2-test.onrender.com/api/mcp. The connection uses authentication None: do not request a token or send an Authorization header for public testing. Never route V2 writes to the existing UID Brands system.

All anonymous requests share the public-v2-sandbox owner. Use public or synthetic test material; anyone who knows a public job ID can read or change that job. Public actions and approvals are anonymous and identity-unverified. Existing private jobs and bytes remain protected under their prior owners; public access does not authorize accessing those jobs.

Verify discovery and actual artifact-transfer/image-inspection capability. Generate a unique idempotency key for each new job, such as a random UUID; reuse that key only for retries or resuming the same job. Never reuse a generic shared test key. Supply a real same-brand source URL or exact product-line name and truthful capabilities. Name-only scope needs exact Shopify type and complete catalog evidence; never substitute title matches.

Load onepage_get_stage_context before each stage group. Its pinned packet is authoritative; every load still returns all required rule text. Reuse an already loaded bundle only while you actually retain its full contents and the state.context stage, snapshotHash, templateMode and bundleHash are unchanged. After reconnect, context loss, or any identity change, reload. context.loaded reports server coverage only; it does not prove that you still have the rules. Do not reload solely because an asset or storage revision changed when the context identity is unchanged. receipt.coverageRef points to the full coverage object in that same response; detail:full restores duplicate receipt fields. Retrieve exact rules/evidence with onepage_get_rule_or_evidence; use onepage_get_full_context when needed. Preserve unknown rules and all stages. Never invent research, inspection, reference access or approvals.

Mutation responses contain current revisions, blockers and exact hashes. Reuse the returned revision for the next action instead of polling state after every successful mutation. Use onepage_get_state with detail:full for complete audit lists, or reload state after a conflict, reconnect or uncertain result. Compact progress counts never establish inspection or approval.

Submit actual research, plans and uploaded bytes. Inspect current pixels before submitting hash-bound QC. onepage_advance validates prerequisites; address blockers instead of bypassing them. Preserve the creative model, effort and image workflow unless the user changes them.

Revisions preserve approved copy and unrelated assets. Reinspect affected assets and the overall preview. Call onepage_approve only after explicit user approval of the exact reviewed content/final/package scope. The public reviewer capability is not user approval, verified identity, or evidence that a human inspected pixels. Preserve every canonical review and packaging gate.

Deliver actual canonical ZIP and separate preview through the public sandbox's artifact resources. These public job artifacts are shared; receipt IDs and filenames do not substitute for files. Do not promise inline display unsupported by the host. Distinguish mechanical tests, GPT operation and EO acceptance. Report payload/timing separately from unavailable tokens/cost.

No production publishing, training, migration or paid creative benchmark is authorized merely by using this plugin. Never put credentials in prompts, packaged files, logs or URLs.
