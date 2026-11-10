# UID Brands Studio — isolated Web App

Branch: `webapp/uid-brands-studio-mvp` — stays separate from gateway `main`.
Production: https://uid-brands-studio-webapp.onrender.com

## Current status (Nov 10, 2026)

- Dedicated Render service, auto-deploying this branch; gateway and MCP unchanged.
- Standalone responsive task manager for Onepage, LDP, Scale Store Brand, UGC; briefs, copy draft, QA feedback, state, JSON export.
- **Cloud sync enabled only when `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are configured.** Login requires an **existing** Supabase Auth email/password account with active `public.creative_dna_team_members` membership. No public signup or self-provisioning.
- Task records and revision snapshots are stored in separate RLS-enabled `public.studio_tasks` and `public.studio_task_versions` tables. Each member sees only tasks **they own**; this is not a shared team queue yet. Contributor/admin can create/edit/delete; viewer is read-only.
- The frontend keeps session tokens in memory only, without localStorage persistence. Users sign in again after tab reload. The server uses a publishable key plus the **user's access token** for all Supabase REST calls, not service-role bypass. Refresh tokens are used only for silent token renewal in the current tab.
- If Cloud auth is not configured, drafts fall back to **browser-local** storage with no collaboration or account protection.
- Optional text generation endpoint requires server-side `OPENAI_API_KEY` **and** `STUDIO_ACCESS_TOKEN`. These are **not configured**. No live paid AI actions are enabled. Source URLs are never automatically fetched or inspected by AI.
- No automated research crawler, image generation, asset uploads, ZIP export or Shopify publishing yet.

## Security and limitations

- **Do not enable paid AI** on a publicly reachable service until per-user authentication is attached to the AI route, plus rate limits, usage ledger and budget caps. Temporary static token protection is only for controlled development.
- No private keys in browser or source control. The Supabase publishable key is intentionally public but all tasks require both authenticated role and Row Level Security.
- Team access currently reuses `creative_dna_team_members`. New users must be invited/provisioned **explicitly** in Supabase Auth and added as active team members; database tables do not auto-create members.
- Other people's tasks are not visible. Shared organization workspaces and role-based review assignments are a separate follow-up.
- Revisions record a best-effort post-write snapshot. If snapshot creation fails, API reports `versionSaved:false`; there is no automatic transaction rollback yet.
- Existing Supabase governance tables `uid_tasks`, `uid_task_revisions`, and gateway MCP endpoints remain unchanged.
- Runtime env: `PORT`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, optional `OPENAI_API_KEY`, `STUDIO_ACCESS_TOKEN`, `STUDIO_MODEL`.

## Smoke tests

```sh
node --check studio/server.mjs
node studio/tests/smoke.mjs
```

CI runs the above on pushes to the Studio branch. Production Auth+RLS CRUD must still be tested with an authorized team member; CI intentionally does not use real credentials.

## Next production milestones

1. Real browser acceptance test with an authorized team account.
2. Workspace/team ownership model, explicit user invitations, shared review queue and role-separated approvals.
3. Atomic version persistence, optimistic concurrency regression tests and private attachments with storage RLS.
4. Account-level AI budget controls, usage logging, and staged Research → Content → Materials executor.
5. Image quality controls, materials manifests, visual previews, ZIP export, and review QA.
