# Creative DNA — ChatGPT App Directory Reviewer Guide

**Submission Status:** Production Ready  
**Compliance Standard:** OpenAI Apps SDK & Model Context Protocol (MCP)  
**Statement of Association:** Built for ChatGPT using the Apps SDK and Model Context Protocol.  
*(Creative DNA is an independent production tool. It is not affiliated with, sponsored by, or endorsed by OpenAI.)*

---

## 1. Executive Summary for Reviewers

- **App Name:** Creative DNA
- **Production URL:** `https://creative-dna-gateway.vercel.app`
- **MCP Endpoint:** `https://creative-dna-gateway.vercel.app/api/mcp`
- **Health Endpoint:** `https://creative-dna-gateway.vercel.app/api/health`
- **Authentication Required:** **None** (Public read-only reference service; no login, password, or API key required from end users)
- **Supported Brands:** `PawfectHouse`, `GiftSoul`, `SoulPrise`
- **Security Profile:** Strictly read-only; no user data collection; no database mutations or write capabilities.

---

## 2. Reviewer Test Cases

Reviewers can verify the application in ChatGPT or via any standards-compliant MCP client using the three test cases below.

### Test Case 1: Discover MCP Tools

**Objective:** Verify that the server declares exactly two read-only tools with complete parameter schemas and read-only annotations.

**Request:**
Send MCP `tools/list` request or ask ChatGPT:
> *"What tools does Creative DNA provide?"*

**Expected Output:**
- Exactly two tools are returned:
  1. `resolve_creative_dna`
  2. `list_creative_dna_routes`
- Both tools declare read-only hints (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`).
- Zero database write, update, delete, or admin tools exist.

---

### Test Case 2: Resolve Canonical Creative DNA

**Objective:** Verify canonical specification retrieval and strict read-only execution without mutation.

**Request:**
Invoke `resolve_creative_dna` with:
```json
{
  "brand": "PawfectHouse",
  "branch": "Onepage"
}
```
Or prompt ChatGPT:
> *"Creative DNA — Use: PawfectHouse / Onepage to draft an optimized above-the-fold landing page layout."*

**Expected Output:**
- Canonical resolution: `pawfecthouse / onepage-system`
- Canonical Creative DNA specification returned with brand color tokens, typography scales, hero component rules, and production constraints.
- Response is strictly read-only reference data.
- Zero write operations, mutations, or approval/update workflows are triggered.

---

### Test Case 3: List Creative DNA Routes

**Objective:** Verify route discovery without internal infrastructure leakage.

**Request:**
Invoke `list_creative_dna_routes` with:
```json
{}
```
Or prompt ChatGPT:
> *"List all available brand creative branches in Creative DNA."*

**Expected Output:**
- Returns public brand routing metadata for `PawfectHouse`, `GiftSoul`, and `SoulPrise`.
- Provides branch identifiers (e.g. `onepage-system`, `ldp-hero`, `home-hero`, `shop-by-product-image`, `ugc-production-rules`).
- Does NOT expose internal database primary keys, database schemas, or infrastructure credentials.

---

## 3. Architecture & Data Flow

```
┌─────────────┐         HTTPS (MCP Streamable)         ┌───────────────────────────┐
│             │ ─────────────────────────────────────> │                           │
│   ChatGPT   │                                        │  Creative DNA Gateway     │
│  (Apps SDK) │ <───────────────────────────────────── │  (Vercel Serverless)      │
│             │            JSON-RPC Response           │                           │
└─────────────┘                                        └─────────────┬─────────────┘
                                                                     │ Encrypted HTTPS
                                                                     │ Server-side only
                                                                     v
                                                       ┌───────────────────────────┐
                                                       │  Creative DNA Canonical   │
                                                       │  Datastore (Read-Only)    │
                                                       └───────────────────────────┘
```

1. **Public MCP Interface:** The gateway exposes standard Streamable HTTP endpoints (`POST /api/mcp` and `GET /api/mcp`) supporting standard MCP JSON-RPC messages (`initialize`, `tools/list`, `tools/call`, `ping`).
2. **Read-Only Resolver:** Incoming requests are validated against strict Zod schemas and rate-limited.
3. **Canonical Datastore:** The gateway retrieves authoritative brand data from the private upstream datastore via server-side encrypted calls.
4. **Zero Secret Exposure:** Upstream endpoint configuration and access tokens remain exclusively server-side. No credentials, tokens, or raw internal URLs are transmitted to the client or browser.

---

## 4. Geographic & Country Availability

**Recommendation:** Broad availability in all countries and territories supported by the ChatGPT App Directory and applicable OpenAI policies.

- Creative DNA contains no geographic restrictions, country-specific legal limitations, or localized payment requirements.
- The service provides universal ecommerce brand guidelines and production systems applicable globally.

---

## 5. Compliance & Security Summary

| Standard | Implementation |
|---|---|
| **Protocol Compliance** | Model Context Protocol Specification (version `2024-11-05`) |
| **Transport** | Streamable HTTP with Server-Sent Events (SSE) fallback |
| **Write/Mutation Protection** | Strictly zero write endpoints; database is read-only |
| **User Privacy** | No user chat logs, account passwords, payment credentials, or health data processed or stored |
| **Rate Limiting** | Sliding window rate limiter (120 req/min/IP) protects availability |
| **Input Validation** | Strict brand/branch length and character sanitization via Zod |
| **Public Documentation** | `/privacy`, `/terms`, `/support` live and accessible |
