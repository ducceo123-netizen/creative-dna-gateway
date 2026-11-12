# UID Brands Studio — Production operator notes
Branch: `webapp/uid-brands-studio-mvp` (not Gateway `main`)
Production: https://uid-brands-studio-webapp.onrender.com

## Current capability (12 November 2026)
- Authenticated Studio tasks, per-owner Supabase storage, attachments and review history. Browser reload resumes a valid Supabase session using sessionStorage in the same tab; explicit sign-out clears it.
- Onepage canonical template preview at desktop width / mobile 390px, explicit unmapped placeholders, exact slot mapping, contextual multi-select feedback and grouped history.
- Public storefront collector supports only direct product/collection URLs for PawfectHouse, GiftSoul and SoulPrise. Collection JSON is fetched in up to three 24-product pages (72 maximum), preserving product title, handle, URL, description, variants, image URL, public product_type and tags when exposed. This is **not** complete competitor or buyer-review research. Collection endpoints may block pagination; scan reports warnings and partial coverage.
- Hybrid Bridge: "Scan & prepare Hybrid handoff" stores a research snapshot, requests a one-time owner-bound sync token, and displays a reviewable prompt. User must copy it into an authorized ChatGPT conversation with UID Brands plugin. The connected `sync_uid_studio_result` action may write completed **text** back to the task if explicitly supplied a fresh token. No automatic ChatGPT inbox, proactive task execution, or image sync.
- Human production: Upload assets and bind exact slots. "Download Hybrid Draft ZIP" exports mapped private task attachments plus manifest, content and manual QA. ZIP is a **draft**, not a production approval or live website proof. No publishing.
- API Auto: staged Research → Creative DNA → Content → Materials → Vision QA → Export. This code path requires server-side `OPENAI_API_KEY` and `STUDIO_AI_EXECUTOR_ENABLED=true`, per-run confirmation, owner-specific rate limits and quota. Separately billed; not part of a ChatGPT Plus subscription. Never enable paid calls without the owner's explicit decision. Image reference fidelity and full responsive layout still require human QA.
- ChatGPT Connect/Plan Usage is release-gated and not enabled.

## Recommended no-fee flow
1. Sign in; create/save a task with a **direct valid source URL**.
2. Open Workflow → Task & files → "Scan & prepare Hybrid handoff".
3. Review the scan warnings, copy the prompt from the generated field and paste into the UID Brands ChatGPT thread. Do not share the one-time token publicly.
4. In ChatGPT, ask to prepare the full copy and sync text through the UID Brands plugin using this exact token. Only accept a confirmed synced:true result.
5. Upload actual material images to Studio and bind them in Materials. Review both desktop/mobile layouts, group feedback and mark resolved only after inspection.
6. Export Hybrid Draft ZIP. Inspect the files and all QA gates before any external publish.

## Verified vs not verified
- GitHub CI tests validate code-level contracts and mock workflows, NOT production Cloud auth/RLS/storage, live storefront availability, actual API billing, end-to-end browser behavior, generated image fidelity or packaging correctness with real private objects.
- Changes to Studio code require a Render deployment on branch `webapp/uid-brands-studio-mvp`; pushing to Gateway main does not deploy Studio.
- The production environment and its secrets must never be copied into source control, pasted into chats, or displayed to customers.

## Developer tests
```sh
node --check studio/server.mjs
node studio/tests/smoke.mjs
node studio/tests/workflows.mjs
node studio/tests/research.mjs
node studio/tests/attachments.mjs
node studio/tests/company-auth.mjs
node studio/tests/hybrid.mjs
node studio/tests/execution-modes.mjs
node studio/tests/orchestrator.mjs
node studio/tests/pipeline-integration.mjs
node studio/tests/review-editor.mjs
```
