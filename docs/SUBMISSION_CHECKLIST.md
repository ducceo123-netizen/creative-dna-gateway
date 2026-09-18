# Creative DNA — Pre-Submission Compliance Checklist

This checklist confirms that the Creative DNA ChatGPT App meets all technical, architectural, security, and directory submission requirements before submission to the ChatGPT App Directory.

---

## 1. Submission Verification Checklist

- [x] **Production HTTPS works**  
  *Verified:* `https://creative-dna-gateway.vercel.app` serves valid TLS and redirects HTTP to HTTPS.
- [x] **/api/health HTTP 200**  
  *Verified:* `GET /api/health` returns HTTP `200` with datastore connectivity check `ok: true`.
- [x] **MCP initialize works**  
  *Verified:* `POST /api/mcp` handles `method: "initialize"` with protocol version `2024-11-05` and server capabilities.
- [x] **tools/list works**  
  *Verified:* `POST /api/mcp` responds with standard tools listing containing complete parameter schemas.
- [x] **resolve_creative_dna works**  
  *Verified:* Canonical specification retrieval for `PawfectHouse / Onepage` resolves to `pawfecthouse / onepage-system`.
- [x] **list_creative_dna_routes works**  
  *Verified:* Returns structured catalog of available brand routes (`PawfectHouse`, `GiftSoul`, `SoulPrise`).
- [x] **Exactly two public MCP tools**  
  *Verified:* Only `resolve_creative_dna` and `list_creative_dna_routes` are registered and exposed.
- [x] **All tools are read-only**  
  *Verified:* Marked with `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
- [x] **No database write tools**  
  *Verified:* Zero write, create, update, delete, seed, or approval endpoints exist.
- [x] **No admin tools**  
  *Verified:* No management, debugging, or administrative tools exposed.
- [x] **No secrets exposed**  
  *Verified:* Upstream tokens, keys, and credentials exist solely server-side; zero secrets in frontend or tool responses.
- [x] **No raw internal datastore URL exposed**  
  *Verified:* Error handlers, route outputs, and client payloads are scrubbed of internal infrastructure URLs.
- [x] **Privacy Policy accessible**  
  *Verified:* Live at `https://creative-dna-gateway.vercel.app/privacy` and `/api/privacy`.
- [x] **Terms accessible**  
  *Verified:* Live at `https://creative-dna-gateway.vercel.app/terms` and `/api/terms`.
- [x] **Support accessible**  
  *Verified:* Live at `https://creative-dna-gateway.vercel.app/support` and `/api/support`.
- [x] **App icon ready**  
  *Verified:* 512x512 PNG at `/icon.png` and vector SVG at `/icon.svg`.
- [x] **Directory descriptions ready**  
  *Verified:* Name, short description, long description, categories, and capabilities formatted to OpenAI App Directory specifications.
- [x] **Reviewer instructions ready**  
  *Verified:* Documented step-by-step in `docs/OPENAI_REVIEW.md`.
- [x] **Country availability reviewed**  
  *Verified:* Recommended for broad global availability; documented in `docs/OPENAI_REVIEW.md`.
- [x] **Production regression test completed**  
  *Verified:* All 6 production regression test cases passing without degradation.

---

## 2. Directory Metadata Snapshot

- **App Name:** Creative DNA
- **Short Description:** Live brand creative guidelines and production rules for ecommerce teams.
- **Long Description:** Creative DNA connects ChatGPT to a live, structured creative knowledge system for ecommerce brands. It provides canonical brand direction, visual rules, landing-page systems, asset specifications, product imagery rules, UGC direction, and brand-specific production constraints.
- **Primary Category:** Productivity
- **Secondary Categories:** Design / Marketing / Ecommerce
- **Branding Statement:** Built for ChatGPT using the Apps SDK and Model Context Protocol.
- **Supported Brands:** `PawfectHouse`, `GiftSoul`, `SoulPrise`
- **Contact:** `support@creative-dna-gateway.vercel.app`
- **Production MCP Endpoint:** `https://creative-dna-gateway.vercel.app/api/mcp`
