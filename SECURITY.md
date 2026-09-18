# Security Policy — Creative DNA Gateway

Creative DNA is a dedicated Model Context Protocol (MCP) gateway connecting ChatGPT and AI agents to structured ecommerce creative guidelines and production rules. This document describes the security posture, architecture boundaries, and operational guarantees of the system.

---

## 1. Strictly Read-Only Architecture

The Creative DNA Gateway is intentionally engineered as an **immutable, read-only system**:

- **Zero Mutation Capability:** The gateway exposes no endpoints, methods, or database hooks to create, update, delete, approve, seed, or mutate Creative DNA specifications.
- **No Generative Rewriting:** The gateway does not rewrite, synthesize, summarize, or train on Creative DNA data; it retrieves and returns canonical guidelines directly from the upstream authoritative datastore.
- **Model Hints:** All MCP tool definitions explicitly broadcast read-only constraints to connecting AI agents:
  - `readOnlyHint: true`
  - `destructiveHint: false`
  - `openWorldHint: false`

---

## 2. Public MCP Attack Surface

The public Model Context Protocol surface is strictly restricted to two read-only tools:

| Tool Name | Operation | Mutation Risk |
| :--- | :--- | :--- |
| `resolve_creative_dna` | Queries canonical brand & branch creative rules | None (Strictly read-only) |
| `list_creative_dna_routes` | Enumerates available brand routes and branch titles | None (Strictly read-only) |

Administrative tools, database query interfaces, and management endpoints are never registered with or exposed through the MCP server.

---

## 3. Secret Management & Upstream Isolation

The gateway acts as an isolated stateless proxy:

- **Zero Database Credentials in Runtime:** The gateway does not store, use, or manage database service-role keys, master passwords, or admin tokens.
- **Server-Only Upstream Configuration:** The upstream datastore URL is configured strictly on the server-side via the `CREATIVE_DNA_UPSTREAM_URL` environment variable.
- **No Client Exposure:** Upstream endpoint URLs and infrastructure identifiers are completely withheld from browser bundles, public discovery documents, and client responses.
- **Environment Variable Protection:** Variables must never be prefixed with `VITE_`, `NEXT_PUBLIC_`, or `PUBLIC_`.

---

## 4. Rate Limiting & Abuse Prevention

To prevent automated scraping, denial of service, and resource exhaustion:

- **Sliding-Window Limiter:** Public `/api/*` and `/api/mcp` endpoints are protected by an automated rate-limiting layer (default: 120 requests per minute per IP address).
- **Serverless & Distributed Compatibility:** The rate limiter utilizes reliable client IP extraction (via `x-forwarded-for` and `x-real-ip`) with bounded in-memory eviction, ensuring complete resilience in ephemeral serverless (Vercel) containers without breaking legitimate bursts from ChatGPT.
- **Safe 429 Response:** When a threshold is reached, the server issues standard `HTTP 429 Too Many Requests` along with standard `Retry-After`, `RateLimit-Limit`, and `RateLimit-Reset` headers. No internal state, IP tables, or architectural internals are leaked in the response.

---

## 5. Input Validation & Body Size Limits

- **Request Size Limiting:** All inbound JSON payloads are constrained to a strict `64kb` limit (`express.json({ limit: '64kb' })`). Excessively large payloads are rejected with `HTTP 413 Payload Too Large`.
- **Strict Parameter Validation:**
  - `brand`: Must be a non-empty string, trimmed, capped at 100 characters.
  - `branch`: Must be a non-empty string, trimmed, capped at 150 characters.
- **Type Coercion Defense:** Objects, arrays, booleans, and arbitrary nested payloads are rejected prior to upstream transmission.
- **Alias Preservation:** Brand/branch alias mappings (such as `PawfectHouse / Onepage` resolving to `pawfecthouse / onepage-system`) are resolved safely without client manipulation.

---

## 6. Route Enumeration Sanitization

The `list_creative_dna_routes` operation and `/api/routes` endpoint only return public routing information necessary for tool discovery:
- `brand` (e.g. `pawfecthouse`)
- `branch` (e.g. `ldp-hero`)
- `title` (e.g. `PawfectHouse Landing Page Hero Material Recipe`)

Internal database primary keys, table names, datastore URLs, and administrative flags are explicitly stripped before delivery to clients.

---

## 7. Error Sanitization & Logging

Production error responses are sanitized to protect system topology:
- **No Stack Traces:** Internal stack traces, server paths, and runtime errors are logged exclusively to server-side stdout/stderr.
- **Sanitized Public Errors:** End-user and agent-facing responses return generic, clean error messages (e.g., `{"error": "Unable to resolve Creative DNA"}`).
- **URL Redaction:** Any validation message that might inadvertently reflect a URL pattern automatically redacts the URL before responding.

---

## 8. HTTP Security & Headers

The gateway applies standard production defensive headers:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-DNS-Prefetch-Control: off`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **CORS Protection:** Cross-Origin Resource Sharing is constrained strictly to `GET`, `POST`, and `OPTIONS`. Unsupported mutation verbs (such as `DELETE`, `PUT`, `PATCH`) are excluded. Standard MCP streaming and session headers (`Mcp-Session-Id`, `Mcp-Protocol-Version`, `Last-Event-ID`) are explicitly supported.

---

## 9. Intentionally Public Endpoints

The following public endpoints are intended for OpenAI Apps SDK, ChatGPT Actions, and user discovery:

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/api/mcp` | POST, GET | Standards-compliant Model Context Protocol transport |
| `/api/health` | GET | Operational health check (returns safe status & latency) |
| `/api/routes` | GET, POST | Route discovery for brands and branches |
| `/api/resolve` | POST | Direct REST resolver for brand creative guidelines |
| `/api/tools` | GET | Machine-readable tool discovery specifications |
| `/api/info` | GET | ChatGPT App metadata |
| `/.well-known/ai-plugin.json` | GET | OpenAI Plugin discovery manifest |
| `/api/openapi.json` | GET | OpenAPI 3.1 specification for Custom GPTs and Actions |

---

## 10. Responsible Disclosure

If you discover a security vulnerability, please report it responsibly:

- **Email:** `support@creative-dna-gateway.vercel.app`
- **Response Timeline:** We acknowledge vulnerability reports within 48 business hours and coordinate fixes prior to public disclosure.
