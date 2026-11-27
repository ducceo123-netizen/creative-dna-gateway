# UID Brands V2 — Supabase read-only preflight

Observed 2026-11-27, Asia/Ho_Chi_Minh. Inspected all nine FINAL handoff documents in the prescribed order. This inventory describes observed infrastructure, not permission to mutate it. No production DDL, DML, Edge deployment, auth configuration, credential generation, feedback, object upload or private content/identity export was performed. CLI used its existing authenticated session. Only metadata SELECTs, function-source downloads, project/function/secret-name listing, and public OAuth discovery were used.

## Pinned sources and access

- Repository main: `87bf39d1f38eb1d0baee159b921efbd7e3aaf923`.
- Studio branch inspected read-only: `d596ed89756586cb5d6073c5578bcfdfb3a016b1`.
- Supabase project: `wuonwttmkadwsmefjukv`, name `creative-dna`, status `ACTIVE_HEALTHY`, region `ap-northeast-1`, Postgres `17.6.1.166`.
- Supabase CLI `2.121.0`, existing authentication works. No Supabase-related environment variables were present in this shell.
- `supabase projects list --output json`: exit 0. The CLI warns the current checkout is not linked; explicit project-ref commands nevertheless work without linking or rewriting project configuration.
- `supabase functions list --project-ref wuonwttmkadwsmefjukv --output json`: exit 0.
- All seven handoff metadata SELECTs ran individually via `supabase db query --linked --project-ref wuonwttmkadwsmefjukv --output json <SELECT>`: exit 0. Additional metadata-only SELECTs inspected RLS flags, grants, migration version/name history, public RPC definitions and the referenced `uid_task_private` function definitions. No private application table rows, auth identities or asset bytes were read.
- Initial invocation without `--linked` was rejected locally; adding `--linked` selected the Management API path. The CLI printed `Initialising login role...`; only supplied SELECT statements were submitted. No manual role/credential changes were requested.
- `supabase migration list --project-ref ...` direct database path failed with SQLSTATE `28P01`, password authentication failed for `cli_login_postgres`. Migration history was successfully read through the Management API SELECT path; no database password was requested or obtained.

## Live schema inventory

| Metadata | Observed |
|---|---:|
| Public tables | 37 |
| Public columns | 339 |
| Public constraints | 171 |
| Public indexes | 75 |
| Public/storage policies | 61 |
| Public triggers | 26 |
| Public RPC definitions | 65 |
| Applied migrations | 69 |
| Migration files in main | 17 |

All 37 public tables have `relrowsecurity=true`. This verifies the enabled flag only. It does not prove policy effectiveness, correct grants, or tenant isolation under real credentials. No authenticated cross-owner mutation test was run against production.

The live table names match the handoff list. Detailed metadata is stored locally in `work/supabase-preflight/{columns,constraints,indexes,policies,triggers,rpc_metadata,rls,grants,migrations}.json`; these files are metadata, not data dumps. Live RPC definitions and downloaded implementation sources are intentionally local only. `artifact-hashes.json` records evidence hashes.

Storage buckets observed through the prescribed metadata query:

| Bucket | Public |
|---|---|
| creative-dna-references | false |
| feedback-context | true |
| uid-task-artifacts | false |
| studio-attachments | false |

Existing production storage must not be reused for V2 writes. `uid-task-artifacts` has owner-folder, live-membership and verified-artifact policies; authenticated update/delete and anonymous access are restricted. `studio-attachments` policies bind folder owner and task owner. Policy text was read; effective behavior remains untested in production.

All 17 migration filenames in main have matching names but different timestamps in deployed history. Main is not a complete schema bootstrap. In particular, Studio, task checkpoint, Clipo and several core migrations exist live but are absent from main's migration directory. Do not replay the repository migration set into production or infer a complete sandbox schema from it.

## Deployed Edge Functions and divergence

All nine listed functions remain ACTIVE at their handoff versions:

| Function | Version | verify_jwt |
|---|---:|---|
| creative-dna-references | 4 | true |
| creative-dna-task-checkpoints | 2 | true |
| creative-dna-admin-feedback | 23 | false |
| creative-dna-feedback-submit | 10 | false |
| clipo-research-refs | 6 | false |
| creative-dna-public | 15 | false |
| creative-dna | 4 | true |
| creative-dna-compile-onepage | 17 | false |
| creative-dna-reference-ingest | 3 | true |

Deployment bundle hashes still match the handoff: compiler `a7cc4e7b18b6539f85a9c1785b449b52ca4aaaae61baa5a247e0c4182a96200a`; public resolver `62c31026bbcf3d837c36a9006e7a78101d6522e5af75a32c1cd779cc4bdc2dcb`. These are bundle hashes, not individual entrypoint hashes.

`supabase functions download --project-ref ... --use-api --workdir work/supabase-preflight/live-functions` downloaded source locally with exit 0. Comparison found 36 files: 25 byte-identical to main, 2 differing, 9 absent from main. Detailed hashes are in `function-source-comparison.json`.

- `creative-dna-compile-onepage/index.ts` is byte-identical, SHA-256 `885e7bbb7dc01f2dcbc2aa65fb832709e447c5eab802bd8380c24a308862c877`.
- `creative-dna-public/index.ts` is byte-identical, SHA-256 `e4d7c4052ab54aaf16a92488ef87d3d20bf119d1b426f8688c7a82eb2d2dd95b`.
- `_shared/product-research.ts` differs: deployed SHA-256 `f805ebabf2cb3a3f6282504abe037ae0a98c81fb578f633cf8804279b5072b35`, main `adb34d8db13838c8c370f8b7308a97c6cb4d714b47c8b9e6ac6da7f870442a50`. Main adds `onepage-content-plan.ts`, `VALIDATE_ONEPAGE_CONTENT_PLAN` and its readiness gate; deployed shared source does not. Gateway overlays must be included when defining the effective baseline. Do not treat the Edge compiler alone as full gateway parity.
- `creative-dna-admin-feedback/index.ts` also differs. It is outside V2 write scope and must remain untouched.
- Live-only files include checkpoint schema/runtime/handler, `creative-dna/index.ts`, feedback-submit, and Clipo implementation/metadata. Do not commit these downloaded files wholesale or copy private reference assets.

## Existing primitives: reuse and incompatibilities

| Primitive | Reuse assessment |
|---|---|
| `uid_tasks` + `uid_task_revisions` + `uid_task_receipts` | Reuse the contract/pattern in isolated storage: owner identity, expected revision, immutable snapshots and payload-hash idempotency. Actual production writes prohibited. |
| `uid_task_private.save` | Observed transaction-level owner/task advisory locks, revision CAS, request receipt reuse, owner quotas, and verified asset-hash linkage. Stronger atomic pattern than Studio's two-request snapshot save. |
| `creative-dna-task-checkpoints` | Deployed handler is hard-coded disabled with `false` and comment requiring separate activation approval. It must not be enabled by this task. |
| `studio_pipeline_runs` | Owner/task/run ID, stage/status/state/revision columns are useful contract inputs. Existing transition model is not canonical Onepage V2. |
| `studio_pipeline_snapshots` | Immutable snapshot concept reusable; Studio server writes run then snapshot in separate REST operations and reports `versionSaved`, so this is not an atomic durable checkpoint proof. |
| `studio/orchestrator.mjs` | Incompatible as V2 execution engine: 7 coarse stages, 8-image ceiling, 23K-character research/DNA truncation, vision on first four images, draft-only output. Would drop canonical stages/slots/evidence if reused wholesale. |
| `studio_research_packs`, `studio_deliverables`, `studio_onepage_asset_bindings` | Reuse source/task/owner/content/material/evidence/QA binding concepts; target an isolated namespace only. |
| `studio_ai_usage_daily` | Attempted-call/image quotas, not provider-token telemetry. Do not label as token measurement. |
| Governance + EO/Clipo | Read-only source and permission patterns. Pending proposals are not canonical; discovered references are not approved EO. |

## Authentication, credentials and sandbox availability

Production OAuth discovery was fetched with unauthenticated GET: HTTP 200 at `https://wuonwttmkadwsmefjukv.supabase.co/.well-known/oauth-authorization-server/auth/v1`. Issuer is `.../auth/v1`; authorization, token and dynamic registration endpoints are present; S256 is supported. This is issuer discovery readiness only, not successful GPT OAuth or V2 principal isolation.

Existing member verification uses a fixed production Clipo MCP ping, which checks verified user and live membership. This can inform the V2 auth boundary but reusing its production JWT does not prove separate test credentials or inability to access V1. No client registration, user creation, token generation, login attempt or auth-setting write occurred.

Accessible project metadata contains exactly three projects: production `creative-dna` ACTIVE_HEALTHY; `pod-product-clone` INACTIVE; `gameuid` INACTIVE. Neither inactive project is identified or authorized as V2. No separately provisioned V2 project, isolated OAuth issuer, sandbox database or sandbox storage was found. A local namespace can support isolated offline state, but does not supply a persistent remotely deployed database or hosted authentication. Separate service deployment needs explicitly isolated durable storage/auth, not production credentials.

Secret inventory was filtered to NAMES ONLY; no values or digests were saved or printed: `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `UID_RULE_REVIEW_V3_ENABLED`. These are production dependencies and must not be copied to V2.

Full private Auth configuration was not exported because it can contain provider secrets; public discovery and deployed authorization code were inspected instead. No auth users/team rows were dumped. RLS behavior under V2 credentials and database write-isolation tests remain blocked until isolated credentials/storage exist.

## Current official documentation checked

The current [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-projects-list) and local command help were used for the read-only commands. [Management API query reference](https://supabase.com/docs/reference/api/v1-run-a-query) documents the API query surface.

The [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) explains that grants and RLS policies combine; enabling RLS alone is not sufficient proof of effective authorization. V2 needs negative ownership tests in its isolated store.

The [branching guide](https://supabase.com/docs/guides/deployment/branching) states branches are separate environments with credentials, begin without application data by default, and merge causes a production deployment workflow. No branch was created or merged. The [current changelog](https://supabase.com/changelog) reports CLI v3.4.0 creates `config.jsonc` for new projects while existing TOML remains supported. No CLI upgrade or configuration conversion was needed or performed.

## Status

PASS: authenticated metadata discovery, all required metadata SELECTs, full function-source download/comparison, migration history, schema/primitive inventory, public OAuth discovery, secret-name-only inventory.

BLOCKED: a separately provisioned V2 authenticated durable backend; actual V2 credential negative integration testing; full GPT OAuth connection. Full private Auth settings and production policy effectiveness remain deliberately unverified. Production credential reuse is not an acceptable substitute.

## Isolated V2 Free project provisioning (2026-11-27)

The parent authorized exactly one new, separate Free test project after the mandatory read-only review; existing projects remain forbidden write targets. Live Management API `GET /v1/organizations/nwjevadsrduexjodnbdh` returned `plan: free` immediately before and after creation. Entitlements deny paid compute changes, high availability, disk modifications, IPv4 and persistent branching. Before creation there was one active project and two inactive projects in the only visible organization, with one organization member.

Official [Free pricing](https://supabase.com/pricing) is $0/month, two active projects, 500 MB database and 1 GB file storage. [Billing rules](https://supabase.com/docs/guides/platform/billing-on-supabase) apply the plan at organization level; paused projects do not count toward the active Free-project limit. The [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) also counts Owner/Admin members' project quotas. The API accepted creation, establishing available capacity. Free projects can pause after a week of inactivity; this is a test environment, with no paid upgrade authorized.

The CLI `projects create --help` has no free-plan flag. The official API's deprecated `plan` field is ignored; organization subscription determines cost. `desired_instance_size` was omitted (the documented smallest default), and no HA, addon, upgrade, billing or production branch fields were supplied. One `POST /v1/projects` returned HTTP 201.

- New project: `uid-brands-architecture-v2-test`
- New ref: `muyyitsvkkjzjojetynr`
- Region: `ap-southeast-1`
- Observed status: `ACTIVE_HEALTHY`
- Verified organization plan after creation: `free`
- Redacted evidence: `work/supabase-preflight/v2-project-redacted.json`
- Independent generated password: held only in local `work/v2-cloud-secrets/` files, directory mode 0700 and files 0600; no value is included in this report or repository.

No existing project, production database, auth config, Render service, organization membership or payment settings were modified. No invitations, signup or email requests were sent. Subsequent schema/role/auth setup is a separate operation limited to this exact new ref.

Supabase's [OAuth server documentation](https://supabase.com/docs/guides/auth/oauth-server) explicitly states no separate OAuth 2.1 charge; users count toward the plan's MAU allowance. The [pooler metadata API](https://supabase.com/docs/reference/api/v1-get-pooler-config) and [connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) are being used to prepare isolated PostgreSQL access.


### New-project schema and strict TLS verification

After explicit root authorization and the source agent's migration freeze, applied only `v2/migrations/001_isolated_v2_store.sql` to the new ref `muyyitsvkkjzjojetynr`, in one transaction. The script requires the exact new pooler user/ref/host, verified TLS, an empty existing V2 namespace, no public application tables and no legacy `uid_task_private` schema. Applied SQL SHA-256: `c503fa22a4e5cffc7898114f20cebd443ec0554c3700685a1308c969944e50ab`.

Created independent runtime login `uid_brands_v2_app`, with no superuser, BYPASSRLS, database creation, role creation, replication, inheritance, public-schema CREATE or V2-schema CREATE permissions. Runtime connection limit is eight. The four immutable tables deny UPDATE; the runtime role has no broad admin credentials. The schema is unavailable to anonymous, authenticated and service-role API users. Empty expiry cleanup returned zero through the narrowly scoped admin-owned function. No production or unrelated schema was touched.

Initial strict TLS probe correctly rejected the missing CA with `SELF_SIGNED_CERT_IN_CHAIN`. The CA was located from Supabase's official [dashboard custom content source](https://github.com/supabase/supabase/blob/23424bec35831d88f4ddff689945774e61de5f26/apps/studio/hooks/custom-content/custom-content.json) and fetched over HTTPS from its official download URL. Certificate SHA-256 is `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`, subject Supabase Root 2021 CA, expires 2031-04-26. The subsequent admin SELECT and app-role verification both passed with certificate and hostname verification enabled (`rejectUnauthorized: true`). No TLS bypass was used.

Redacted migration receipt: `work/supabase-preflight/v2-migration-redacted.json`. Runtime credential/config files are local-only mode 0600 under `work/v2-cloud-secrets/`. Environment variable names only: `V2_MODE`, `V2_STORE`, `V2_DATABASE_URL`, `V2_DATABASE_HOST`, `V2_DATABASE_PROJECT_REF`, `V2_DATABASE_CA_PEM`.

### OAuth readiness of the new isolated project

Read-only auth metadata confirms OAuth server and dynamic registration disabled by default, signup enabled by default, email login enabled, default site URL localhost. OIDC discovery and JWKS return HTTP 200 even while OAuth is disabled; these alone do not establish readiness. OAuth authorization-server discovery returns `feature_disabled`. Issuer is `https://muyyitsvkkjzjojetynr.supabase.co/auth/v1`. The standard discovery path is `/.well-known/oauth-authorization-server/auth/v1` on the project origin.

The official [OAuth setup guide](https://supabase.com/docs/guides/auth/oauth-server/getting-started) says the beta is available on all plans with no separate charge. It requires enablement, authorization UI path, a login/consent interface and OAuth client registration; [MCP guidance](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) covers discovery and PKCE. No auth settings, test users, signup, invitations or email requests have been changed or issued in this operation.
