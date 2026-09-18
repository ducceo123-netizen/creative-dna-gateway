# Creative DNA — Submission Verification Checklist

| Requirement | Status | Verification Detail |
|---|---|---|
| **Standards-compliant Remote MCP** | PASS | `POST /api/mcp` handles `initialize`, `tools/list`, and `tools/call` via StreamableHTTPServerTransport. |
| **Strict Read-Only Architecture** | PASS | Zero database mutation capabilities; upstream Supabase edge function is authoritative. |
| **Tool Descriptions Updated** | PASS | Clear triggers and example brand/branch pairings specified for `resolve_creative_dna` and `list_creative_dna_routes`. |
| **Read-Only Annotations** | PASS | `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` configured on MCP tools. |
| **App Name & Metadata** | PASS | Name: "Creative DNA". Short and long descriptions formatted to OpenAI Apps SDK specs. |
| **Production Health Endpoint** | PASS | `GET /api/health` returns status `200` and verifies active connection to Supabase. |
| **Public Legal & Support URLs** | PASS | `/privacy`, `/terms`, `/support` live and routed on Vercel deployment. |
| **Icon & Asset Placeholders** | PASS | `/icon.svg`, `/icon.png` (512x512), `/logo.svg` created in `/public`. |
| **No Vite/Rolldown in Runtime** | PASS | Server bundle and Vercel serverless function contain zero runtime imports of Vite or Rolldown. |
| **No Secret Key Exposure** | PASS | Zero service keys or private tokens exposed to client or browser. |
| **Canonical Production Endpoint** | PASS | `https://creative-dna-gateway.vercel.app/api/mcp` |

### Sample Prompts for Reviewers & Users
1. *"Creative DNA — Use: PawfectHouse / Onepage to draft an optimized above-the-fold landing page layout."*
2. *"List all available brand creative branches in Creative DNA."*
3. *"Retrieve the UGC creative production guidelines for GiftSoul using Creative DNA."*
4. *"Check Creative DNA rules for PawfectHouse LDP Hero section."*
