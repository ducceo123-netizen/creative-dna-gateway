# UID Brands Knowledge Governance — Production Runbook

## Deployment (2026-10-10)
- Supabase: five additive governance migrations deployed (baselines, evaluations, snapshots, hash utilities, transactional merge and rollback).
- Admin Edge Function: creative-dna-admin-feedback v11 deployed.
- Vercel Gateway: PR #46 deployed, CI and Vercel checks successful.
- Canonical knowledge content was not modified during deployment.
- Governance baselines and evaluations initially contain **zero approved cases**; production Accept/Merge is deliberately **blocked** until approved baseline cases and a passed evaluation exist.

## Admin workflow
1. Open `/admin/feedback` and expand **Knowledge Governance**.
2. Register approved baseline case(s) for Brand / Material: original brief, approved output and enforceable assertions. Use a new case_key version for updates; baselines are append-only.
3. For Onepage shared structural merges, create at least one approved baseline per affected brand.
4. Generate candidate outputs using the production creative workflow for every baseline. Record genuine `source_run_id`, artifact URL and structured output.
5. Run the evaluation against all approved cases. It checks required/forbidden text, required keys, immutable fields and missing candidate cases. Canonical lexical overlaps are only review suggestions, not proof of contradiction.
6. Review product fidelity, UGC/visual quality, brand fit and conflicts yourself. Document findings. Only a complete mechanical pass plus explicit admin verification can produce a passed evaluation ID.
7. Paste the evaluation ID, evidence URLs, baseline IDs and review notes into the proposal's Regression Gate. Only then Accept/Merge.
8. Before and after snapshots are taken transactionally. For an unwanted change, use **Rollback entire proposal**; it fails if any affected node has newer edits.

## Scope and limitations
- There is **no autonomous ChatGPT/image generation runner in the backend**. Candidate outputs must be produced by the production workflow and supplied with traceable artifacts.
- Visual/product truth scoring cannot be proven by keyword tests; Admin signoff is mandatory.
- Service-role direct SQL outside the governance RPC must remain restricted operationally.
- Legacy accepted proposals from before the new gate are not silently merged. They require reviewed migration to a governed state.
- Never backfill fake baseline approvals or force evaluation_status=passed.

## Operational safety
- Verify new changes with CI and Vercel build status before production rollout.
- Keep the Supabase Edge Function and Gateway in sync; upstream is the authoritative merge gate.
- Keep rollback snapshots immutable and preserve audit history.
