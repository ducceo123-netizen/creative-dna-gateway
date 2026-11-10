# UID Brands Studio — isolated Web App MVP

Branch: `webapp/uid-brands-studio-mvp` (separate from `main` and existing MCP gateway).

Start locally: `node studio/server.mjs`; open `http://localhost:10000`.
Separate Render web service: build command `echo "No build needed"`, start command `node studio/server.mjs`, runtime Node, free plan, branch above.

## Implemented
- Responsive independent Web App UI: dashboard, create task, Onepage/LDP/Scale Store Brand/UGC workflow choice; task detail, editable copy, feedback/QA, approvals, filter, JSON export.
- Local task drafts in browser localStorage only. **No cloud persistence, accounts, cross-browser sync or team collaboration yet.**
- Isolated `POST /api/ai/content` optional content drafting via the official OpenAI Responses API. Only available when **both** `OPENAI_API_KEY` and `STUDIO_ACCESS_TOKEN` are securely configured server-side. Never add them to repository or the UI. One-click disabled without config. Token entered per browser session; do not persist.
- AI drafts are marked for review, never published. No material image generation or automated external research yet. Source URLs in briefs are not fetched and cannot be treated as inspected.
- No change to existing UID Brands MCP, primary Render service, main branch or store products.

## Security and production gates
- Until real user authentication, role-based authorization, rate limits, budget controls, account separation and durable storage exist, **do not configure paid AI keys on a public deployment**. The token is a temporary developer gate, not production authentication.
- Never persist secrets or sensitive merchant/customer information to localStorage; this MVP suits non-sensitive drafts only.
- Before enabling production AI, implement user identity, strict budgets, tenant isolation and request accounting; protect any provider access with authenticated backend routes.
- Environment: PORT (optional), OPENAI_API_KEY (optional), STUDIO_ACCESS_TOKEN (optional), STUDIO_MODEL (optional, defaults to gpt-4.1-mini).
- No external domains, managed database, billing or model calls are provisioned by deployment.

## Smoke checks
`node --check studio/server.mjs`
`node studio/tests/smoke.mjs`

## Roadmap
1. Supabase authenticated per-workspace task/version persistence, migration from local drafts.
2. Safe budgeted AI orchestration for research & copy, explicit approval stages.
3. Generated images, manifest and ZIP export backed by object storage.
4. Playwright visual regression for key task flows and responsive QA.
