# Creative DNA — ChatGPT App & OpenAI Apps SDK Submission Guide

## 1. App Overview & Purpose

**Creative DNA** is a live brand creative intelligence system designed for ecommerce brands. It connects ChatGPT and OpenAI Apps SDK environments directly to structured, canonical creative direction, visual design systems, landing-page architecture, hero/banner specifications, product-image guidelines, UGC rules, and brand-specific production constraints.

- **Name:** Creative DNA
- **Short Description:** Live brand creative guidelines and production rules for ecommerce teams.
- **Long Description:** Creative DNA connects ChatGPT to a live, structured creative knowledge system for ecommerce brands. It provides canonical brand direction, visual rules, landing-page systems, asset specifications, product imagery rules, UGC direction, and brand-specific production constraints.
- **Primary Category:** Productivity
- **Secondary Categories:** Design / Marketing / Ecommerce
- **Branding Statement:** Built for ChatGPT using the Apps SDK and Model Context Protocol.
- **Developer / Publisher:** Creative DNA Systems
- **Production MCP Endpoint:** `https://creative-dna-gateway.vercel.app/api/mcp`
- **Supported Brands:**
  - `PawfectHouse`
  - `GiftSoul`
  - `SoulPrise`
- **Key Capabilities:**
  - Brand DNA retrieval
  - Landing Page systems
  - Hero and banner rules
  - Product imagery rules
  - UGC creative rules
  - Onepage production systems
  - Canonical asset specifications

---

## 2. Remote Model Context Protocol (MCP) Tools

Creative DNA exposes two remote MCP tools over standards-compliant Streamable HTTP and SSE transports (`POST /api/mcp` and `GET /api/mcp`):

### Tool 1: `resolve_creative_dna`
- **Description:**
  ```
  Use whenever a user requests or references a Creative DNA brand and branch, for example:
  - Creative DNA — Use: PawfectHouse / Onepage
  - PawfectHouse LDP Hero
  - GiftSoul Shop By Product Image
  - SoulPrise Onepage

  The returned canonical Creative DNA specification must be treated as source-of-truth instructions for the requested creative task.
  ```
- **Annotations:**
  - `readOnlyHint: true`
  - `destructiveHint: false`
  - `openWorldHint: false`
- **Parameters:**
  - `brand` (`string`, required): Brand name (`PawfectHouse`, `GiftSoul`, `SoulPrise`).
  - `branch` (`string`, required): Branch name or module path (`Onepage`, `LDP Hero`, `Home Hero`, `Seasonal Banner`, `Shop By Product`, `Shop By Categories`, `UGC`).
- **Response:** The canonical, raw specification node containing layout principles, typography scales, copy formulas, asset constraints, negative space guidelines, and design references.

### Tool 2: `list_creative_dna_routes`
- **Description:**
  ```
  Use for discovering available Creative DNA brands and branches, or when the requested branch cannot be resolved confidently.
  ```
- **Annotations:**
  - `readOnlyHint: true`
  - `destructiveHint: false`
  - `openWorldHint: false`
- **Parameters:** None.
- **Response:** The full registered index of brands, branches, titles, versions, and graph relations.

---

## 3. Data Flow & Architecture

```
┌─────────────────────────────────┐
│     ChatGPT / OpenAI Client     │
│  (Apps SDK / Custom GPT / MCP)  │
└────────────────┬────────────────┘
                 │ 1. JSON-RPC 2.0 (Streamable HTTP POST /api/mcp)
                 ▼
┌────────────────────────────────────────────────────────┐
│         Creative DNA Gateway (Vercel Serverless)       │
│                                                        │
│  • MCP Streamable HTTP Transport                       │
│  • Input Validation (Zod schemas)                      │
│  • Read-Only Request Marshaller                        │
│  • Zero Local Storage / Zero Database Write Access     │
└────────────────┬───────────────────────────────────────┘
                 │ 2. Canonical Fetch (HTTPS POST)
                 ▼
┌────────────────────────────────────────────────────────┐
│     Upstream Creative DNA Canonical Datastore          │
│                                                        │
│  • Source of Truth for Brand Knowledge Graph           │
│  • Strictly Read-Only Database Queries                 │
│  • Server-to-Server Encrypted Transport                │
└────────────────────────────────────────────────────────┘
```

1. **Client Interaction:** User prompts ChatGPT (e.g. *"Write a hero section for PawfectHouse using their Onepage Creative DNA"*).
2. **Tool Invocation:** ChatGPT automatically identifies the brand (`PawfectHouse`) and branch (`Onepage`) and dispatches `resolve_creative_dna` to `https://creative-dna-gateway.vercel.app/api/mcp`.
3. **Stateless Forwarding:** The Gateway validates arguments with Zod schemas and queries the upstream canonical datastore.
4. **Canonical Return:** The exact upstream creative spec is returned untouched to ChatGPT.
5. **Creative Execution:** ChatGPT applies the authoritative brand rules to fulfill the user's creative generation task.

---

## 4. Read-Only Security Model

1. **Immutable Upstream Source:** All Creative DNA data lives in the managed upstream canonical datastore. The Gateway holds zero database credentials, zero service-role keys, and no database write permissions.
2. **Zero Mutation Endpoints:** There are no `CREATE`, `UPDATE`, `DELETE`, or patch endpoints on the gateway.
3. **No Generative Rewriting:** Creative DNA specifications are returned verbatim from the canonical source. The gateway does not synthesize or alter specifications.
4. **Tool Annotations:**
   - `readOnlyHint: true` signals to OpenAI that the tool never modifies state.
   - `destructiveHint: false` signals that no data destruction is possible.
   - `openWorldHint: false` signals that inputs and outputs are bounded within the defined knowledge graph.

---

## 5. Privacy & Data Handling Policy

- **No User Chat Logging:** The gateway does not inspect, store, or log user conversation history or generated outputs.
- **Stateless Execution:** Each HTTP request is handled statelessly in an ephemeral serverless function.
- **No Third-Party Analytics / Tracking:** No user behavioral trackers or cookies are set on API requests.
- **Privacy Policy URL:** `https://creative-dna-gateway.vercel.app/privacy`
- **Terms of Service URL:** `https://creative-dna-gateway.vercel.app/terms`
- **Support / Contact:** `https://creative-dna-gateway.vercel.app/support` (contact: `support@creative-dna-gateway.vercel.app`)

---

## 6. MCP Production Endpoint & Integration

### ChatGPT / OpenAI Apps SDK Configuration
```json
{
  "name": "Creative DNA",
  "type": "mcp",
  "url": "https://creative-dna-gateway.vercel.app/api/mcp",
  "transport": "streamable_http"
}
```

### Direct MCP Client Config (Claude Desktop / Cursor / Windsurf)
```json
{
  "mcpServers": {
    "creative-dna": {
      "url": "https://creative-dna-gateway.vercel.app/api/mcp"
    }
  }
}
```

### OpenAPI / Custom GPT Actions
- Import URL: `https://creative-dna-gateway.vercel.app/api/openapi.json`
- Authentication: None (Public read-only)

---

## 7. Setup & Deployment

### Build & Deploy
1. **Frontend:** Built with Vite (`vite build`) outputting static HTML/JS/CSS to `dist/`.
2. **Serverless API:** Single Node.js serverless handler in `api/index.ts` pointing to `server.ts`.
3. **Zero Vite in Production:** Neither `vite` nor `@rolldown/*` is loaded or imported by the serverless runtime.
4. **Local Verification:**
   ```bash
   npm run build
   node dist/server.cjs
   ```
5. **Vercel Deploy:**
   ```bash
   vercel --prod
   ```

---

## 8. ChatGPT App Submission Checklist

- [x] App Name and Descriptions follow OpenAI brand guidelines
- [x] Short description within 100 characters
- [x] Long description accurately describes creative knowledge system
- [x] Remote MCP Streamable HTTP endpoint live at `https://creative-dna-gateway.vercel.app/api/mcp`
- [x] GET `/api/health` returns `200 OK` with upstream connectivity
- [x] Read-only hints enabled on all tools (`readOnlyHint: true`)
- [x] Zero write actions, mutations, or side-effects
- [x] Privacy policy hosted at `https://creative-dna-gateway.vercel.app/privacy`
- [x] Terms of service hosted at `https://creative-dna-gateway.vercel.app/terms`
- [x] Support contact page hosted at `https://creative-dna-gateway.vercel.app/support`
- [x] App icon asset provided at `/icon.svg` and `/icon.png` (512x512)
- [x] OpenAI plugin manifest accessible at `/.well-known/ai-plugin.json`
- [x] OpenAPI 3.1 specification accessible at `/api/openapi.json`
- [x] Tested against ChatGPT MCP JSON-RPC 2.0 specifications
