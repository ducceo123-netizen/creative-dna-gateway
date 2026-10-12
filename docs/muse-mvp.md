# UID Brands: Muse auxiliary MVP

Bootstrap: https://uid-brands-gateway-preview.onrender.com/muse

OpenAPI: https://uid-brands-gateway-preview.onrender.com/api/muse/openapi.json

This is a public, read-only API/browser entry for the existing canonical system, not a full ChatGPT widget port or an approved Meta connector. A native account-level Muse tool connection has not been verified. No credentials or account setup are necessary to test the links. If Muse can only browse, the four operations also work as ordinary GET requests.

## Copy into Muse

> Đọc https://uid-brands-gateway-preview.onrender.com/muse và dùng các API GET trong hướng dẫn. Liệt kê brand/branch, rồi compile brief PawfectHouse / Onepage. Trả lại tóm tắt yêu cầu, revision/hash, các quality/reference gates còn thiếu và link template HTML/CSS. Chỉ đọc và lập brief; chưa tạo ảnh, chưa gửi feedback hay thay đổi dữ liệu. Nếu không gọi được API, báo rõ bước bị chặn, không tự đoán rules.

For a custom connector, ask Muse to read the OpenAPI document above and expose only its four read operations. The user must review and authorize any persistent connection in Muse. Do not use the existing ChatGPT `/api/mcp` or its broader OpenAPI schema as a substitute for this bounded MVP.

## Operations

All return JSON and are read-only. GET query parameters must be URL-encoded.

- `/api/muse/routes`: discover sanitized canonical brand/branch/title metadata.
- `/api/muse/resolve?brand=PawfectHouse&branch=Onepage`: canonical rules via the same `resolveCreativeDna` function used by ChatGPT.
- `/api/muse/compile?brand=PawfectHouse`: compact Onepage packet via the same `compileOnepageJob` function, including current quality gates and the shared template. Optional `source_url` (public HTTPS URL without embedded credentials), `source_type` (`auto`, `product`, `collection`), and `theme` are brief inputs. Compiling does not fetch the source URL, persist a job, or generate assets.
- `/api/muse/template`: current shared template manifest with stable HTML/CSS links and SHA-256 hashes. Optional `version` selects an existing immutable version. Download the original HTML and CSS; do not reconstruct the mapping.

Only public, non-sensitive URLs/themes belong in GET query strings, which may appear in browser history or infrastructure access logs. Never send signed URLs, credentials, personal data, or confidential brief material. Responses use `Cache-Control: no-store`. Public canonical data has the same visibility as the pre-existing resolver/compiler.

## Boundaries and failure behavior

- No data copy, database migration, new authentication, account permission changes, admin actions, upload, training feedback, private-reference bytes, image generation, or added paid resource.
- ChatGPT MCP tools, metadata, widgets, and write approval flow are unchanged.
- A successful HTTP response is not a completed creative deliverable. Preserve `quality_execution_guard`, `template_policy_compatibility`, all quality/reference gates, revision/hash, product-truth and inspection requirements. Report `BLOCKED` and stop the affected stage. Private references remain behind their existing authentication boundary.
- The existing gateway rate limiter applies: 120 requests/minute/IP, `429` plus `Retry-After`. This is the same bounded in-memory limiter; not a distributed quota guarantee.
- Bad input: `400`; missing route/template: `404`; invalid upstream contract: `422`; upstream failure: corresponding failure status or `502`. Failures are sanitized and must not be presented as success.
- Only GET/HEAD/OPTIONS are accepted on these endpoints; mutation methods receive `405`. Unknown `/api/muse/*` paths receive the existing JSON `404`.

## Compatibility evidence and remaining user test

Meta's [custom connector help](https://www.meta.com/help/artificial-intelligence/1687253048996149/) says users can ask Muse to create a Custom Connector. Its [connector guidelines](https://muse.ai/platform/docs) request API or MCP setup/tool documentation. Neither page supplies a public, detailed transport/import contract. This MVP therefore provides a conventional OpenAPI 3.1 GET surface plus a browsable bootstrap. A standards-shaped API alone is not evidence of a connected Muse account.

Automated tests verify operation allowlisting, schema, strict inputs, failure sanitization, unchanged canonical payloads/gates, template identity, and existing rate/security middleware. The release smoke should verify live routes, resolve, compile, template hashes, invalid inputs, rejected mutation methods, and the existing ChatGPT MCP discovery. Final Muse end-to-end acceptance is the user's copied prompt producing a live canonical response inside Muse.
