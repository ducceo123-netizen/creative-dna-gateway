# Creative DNA

> Live brand creative guidelines and production rules for ecommerce creative generation.

Creative DNA connects ChatGPT and the OpenAI Apps SDK to a live, structured brand knowledge system containing creative direction, visual rules, landing-page systems, asset specifications, product-image rules, UGC direction, and brand-specific production constraints.

## Production Endpoints

- **Live Application:** `https://creative-dna-gateway.vercel.app`
- **Production MCP Endpoint:** `https://creative-dna-gateway.vercel.app/api/mcp`
- **Health Check:** `https://creative-dna-gateway.vercel.app/api/health`
- **OpenAPI 3.1 Schema:** `https://creative-dna-gateway.vercel.app/api/openapi.json`
- **Plugin Manifest:** `https://creative-dna-gateway.vercel.app/.well-known/ai-plugin.json`
- **Privacy Policy:** `https://creative-dna-gateway.vercel.app/privacy`
- **Terms of Service:** `https://creative-dna-gateway.vercel.app/terms`
- **Support:** `https://creative-dna-gateway.vercel.app/support`

## Muse auxiliary MVP

Use the lightweight [Muse bootstrap](https://uid-brands-gateway-preview.onrender.com/muse) for public read-only routes, canonical rules, Onepage brief compilation, and template links. [Setup and limitations](docs/muse-mvp.md). This shares the existing backend; native Muse account connection remains to be tested.

## Supported Brands

- `PawfectHouse`
- `GiftSoul`
- `SoulPrise`

## Core Capabilities

- **Brand DNA** — Visual identity, typography hierarchy, tone of voice, color codes.
- **Landing Page Systems (LDP)** — Layout patterns, section ordering, module rules.
- **Hero & Banner Rules** — Visual focus, copy density, CTA placement standards.
- **Product Imagery Rules** — Photography angles, aspect ratios, background staging.
- **UGC Rules** — Creator guidelines, authentic scripting hooks, social formatting.
- **Onepage Systems** — High-velocity single-page conversion architecture.

## Model Context Protocol (MCP) Tools

1. `resolve_creative_dna`
   - Resolves canonical brand and branch creative rules from the Supabase source of truth.
   - Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
2. `list_creative_dna_routes`
   - Discovers all registered brands and branches in the knowledge graph.
   - Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.

## Security & Architecture

- **Strictly Read-Only:** Zero write actions or database mutations permitted.
- **Authoritative Source:** Upstream Supabase edge gateway remains the single source of truth.
- **Serverless & Lightweight:** Built without runtime dependencies on frontend build tools or bundlers.

### Scale Brands

Use `compile_scale_brands_job` for store-wide brand adaptation with protected Teeinblue PDP, Track Order, Policy, Judge.me and Cart Drawer regions. This chat-first workflow resolves current Brand DNA independently of LDP, carries the Mac `website-brand-ui` methodology, and records evidence gaps without claiming QA or changing stores. See [workflow and limits](docs/scale-brands-workflow.md).
