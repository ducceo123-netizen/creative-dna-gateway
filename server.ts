import express, { Request, Response } from "express";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const SUPABASE_PUBLIC_URL = "https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/creative-dna-public";
export const CANONICAL_PRODUCTION_ORIGIN = "https://creative-dna-gateway.vercel.app";
export const CANONICAL_PRODUCTION_MCP_URL = `${CANONICAL_PRODUCTION_ORIGIN}/api/mcp`;

// Clean core gateway functions - strictly read-only and stateless
export async function fetchUpstream(payload: { action: "resolve"; brand: string; branch: string } | { action: "routes" }) {
  const response = await fetch(SUPABASE_PUBLIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawJson = await response.json();
  return {
    status: response.status,
    ok: response.ok,
    data: rawJson,
  };
}

export async function resolveCreativeDna(brand: string, branch: string) {
  if (!brand || typeof brand !== "string" || !brand.trim()) {
    throw new Error("Missing or invalid 'brand' parameter");
  }
  if (!branch || typeof branch !== "string" || !branch.trim()) {
    throw new Error("Missing or invalid 'branch' parameter");
  }

  return fetchUpstream({
    action: "resolve",
    brand: brand.trim(),
    branch: branch.trim(),
  });
}

export async function listCreativeDnaRoutes() {
  return fetchUpstream({
    action: "routes",
  });
}

// Tool definitions for OpenAPI / ChatGPT Actions / Discovery documentation
export const TOOL_DEFINITIONS = [
  {
    name: "resolve_creative_dna",
    description: "Resolves and returns the canonical, read-only Creative DNA specification (content policy, input schema, asset rules, design references) for a specified brand and branch from the upstream Supabase source of truth.",
    inputSchema: {
      type: "object",
      properties: {
        brand: {
          type: "string",
          description: "Target brand name (e.g., 'PawfectHouse', 'GiftSoul', 'SoulPrise')",
        },
        branch: {
          type: "string",
          description: "Target branch or module path (e.g., 'Onepage', 'LDP Hero', 'Home Hero', 'Seasonal Banner', 'Shop By Product', 'Shop By Categories', 'UGC')",
        },
      },
      required: ["brand", "branch"],
    },
  },
  {
    name: "list_creative_dna_routes",
    description: "Lists all available brands, branches, titles, versions, and node types registered in the canonical Creative DNA knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Creates and configures a standards-compliant Model Context Protocol server.
 * Strictly adheres to read-only security rules:
 * - No database writes, training, seeding, approvals, updates, or deletes.
 * - Single source of truth is the upstream Supabase API.
 * - Returns upstream response unchanged without rewriting, summarizing, or synthesizing new DNA.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "Creative DNA Gateway",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
      instructions:
        "Read-only gateway for the Creative DNA system. Use list_creative_dna_routes to discover available brand routes, and resolve_creative_dna to resolve canonical specifications from the upstream Supabase source of truth. No modifications, generation, or synthesis allowed.",
    }
  );

  // Tool 1: resolve_creative_dna
  server.registerTool(
    "resolve_creative_dna",
    {
      title: "Resolve Creative DNA",
      description:
        "Resolves and returns the canonical, read-only Creative DNA specification (content policy, input schema, asset rules, design references) for a specified brand and branch from the upstream Supabase source of truth.",
      inputSchema: {
        brand: z
          .string()
          .min(1)
          .describe("Target brand name (e.g., 'PawfectHouse', 'GiftSoul', 'SoulPrise')"),
        branch: z
          .string()
          .min(1)
          .describe("Target branch or module path (e.g., 'Onepage', 'LDP Hero', 'Home Hero', 'Seasonal Banner', 'Shop By Product', 'Shop By Categories', 'UGC')"),
      },
    },
    async ({ brand, branch }) => {
      try {
        const upstream = await resolveCreativeDna(brand, branch);
        return {
          content: [
            {
              type: "text",
              text: typeof upstream.data === "string" ? upstream.data : JSON.stringify(upstream.data, null, 2),
            },
          ],
          isError: !upstream.ok,
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err?.message || "Error resolving Creative DNA" }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: list_creative_dna_routes
  server.registerTool(
    "list_creative_dna_routes",
    {
      title: "List Creative DNA Routes",
      description:
        "Lists all available brands, branches, titles, versions, and node types registered in the canonical Creative DNA knowledge graph.",
      inputSchema: {},
    },
    async () => {
      try {
        const upstream = await listCreativeDnaRoutes();
        return {
          content: [
            {
              type: "text",
              text: typeof upstream.data === "string" ? upstream.data : JSON.stringify(upstream.data, null, 2),
            },
          ],
          isError: !upstream.ok,
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err?.message || "Error listing Creative DNA routes" }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

/**
 * Builds the Express application with all API endpoints and the standards-compliant MCP server.
 */
export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  // CORS headers for direct remote integration (OpenAI Apps SDK, ChatGPT, MCP clients, curl)
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID"
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  // Health / Upstream connectivity check
  app.get("/api/health", async (_req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const upstream = await listCreativeDnaRoutes();
      const latencyMs = Date.now() - startTime;
      return res.json({
        status: "ok",
        mode: "read_only",
        upstream: upstream.ok ? "connected" : "error",
        upstreamStatus: upstream.status,
        latencyMs,
        productionMcpUrl: CANONICAL_PRODUCTION_MCP_URL,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(502).json({
        status: "error",
        mode: "read_only",
        upstream: "unreachable",
        message: err?.message || "Failed to reach upstream Creative DNA API",
        latencyMs: Date.now() - startTime,
        productionMcpUrl: CANONICAL_PRODUCTION_MCP_URL,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Operation 1: resolve_creative_dna
  app.post("/api/resolve", async (req: Request, res: Response) => {
    try {
      const { brand, branch } = req.body || {};
      if (!brand || !branch) {
        return res.status(400).json({
          error: "Both 'brand' and 'branch' are required string parameters.",
        });
      }

      const upstream = await resolveCreativeDna(brand, branch);
      return res.status(upstream.status).json(upstream.data);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  });

  // Operation 2: list_creative_dna_routes
  app.all("/api/routes", async (_req: Request, res: Response) => {
    try {
      const upstream = await listCreativeDnaRoutes();
      return res.status(upstream.status).json(upstream.data);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  });

  // Tool-compatible aliases (for direct ChatGPT Actions / RPC calls)
  app.post("/api/tools/resolve_creative_dna", async (req: Request, res: Response) => {
    try {
      const brand = req.body?.brand || req.body?.arguments?.brand;
      const branch = req.body?.branch || req.body?.arguments?.branch;
      if (!brand || !branch) {
        return res.status(400).json({
          error: "Missing required arguments: brand, branch",
        });
      }
      const upstream = await resolveCreativeDna(brand, branch);
      return res.status(upstream.status).json(upstream.data);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Error resolving Creative DNA" });
    }
  });

  app.post("/api/tools/list_creative_dna_routes", async (_req: Request, res: Response) => {
    try {
      const upstream = await listCreativeDnaRoutes();
      return res.status(upstream.status).json(upstream.data);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Error listing Creative DNA routes" });
    }
  });

  // Tool discovery & OpenAPI / schema endpoint
  app.get("/api/tools", (_req: Request, res: Response) => {
    return res.json({
      name: "Creative DNA Gateway",
      version: "1.0.0",
      description: "Read-only gateway for the canonical Creative DNA knowledge system.",
      canonicalOrigin: CANONICAL_PRODUCTION_ORIGIN,
      mcpEndpoint: CANONICAL_PRODUCTION_MCP_URL,
      tools: TOOL_DEFINITIONS,
    });
  });

  // Standards-compliant Remote Model Context Protocol (MCP) Streamable HTTP & SSE Server
  // Supports initialize, notifications/initialized, ping, tools/list, and tools/call
  app.all("/api/mcp", async (req: Request, res: Response) => {
    const accept = (req.headers.accept || "").toLowerCase();

    // Friendly browser / GET discovery if not requesting text/event-stream
    if (req.method === "GET" && !accept.includes("text/event-stream")) {
      return res.json({
        name: "Creative DNA Gateway",
        version: "1.0.0",
        description: "Standards-compliant Remote Model Context Protocol (MCP) server for OpenAI Apps SDK and ChatGPT.",
        canonicalUrl: CANONICAL_PRODUCTION_MCP_URL,
        protocolVersion: "2024-11-05",
        transports: ["Streamable HTTP (POST)", "Server-Sent Events (GET SSE)"],
        capabilities: {
          tools: { listChanged: false },
        },
        tools: [
          {
            name: "resolve_creative_dna",
            description: "Resolves and returns the canonical, read-only Creative DNA specification for brand and branch.",
            parameters: { brand: "string (required)", branch: "string (required)" },
          },
          {
            name: "list_creative_dna_routes",
            description: "Lists all available brands, branches, titles, versions, and node types in the Creative DNA graph.",
            parameters: {},
          },
        ],
        security: {
          read_only: true,
          database_writes: "forbidden",
          generative_rewriting: "disabled",
          source_of_truth: "https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/creative-dna-public",
        },
      });
    }

    // Normalize Accept header for clients that omit text/event-stream or send default Accept: */*
    if (req.method === "POST") {
      if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
        req.headers.accept = "application/json, text/event-stream";
      }
    }

    try {
      // Per-request stateless Streamable HTTP transport (MCP spec compliant, serverless & Vercel friendly)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      console.error("MCP Server Error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: {
            code: -32603,
            message: err?.message || "Internal MCP Server error",
          },
        });
      }
    }
  });

  // Explicit 404 handler for unmatched /api/* requests - guarantees API requests never fall through to the SPA index.html
  app.all("/api/*", (_req: Request, res: Response) => {
    return res.status(404).json({
      error: "Not Found",
      message: "The requested API endpoint does not exist on this gateway.",
    });
  });

  return app;
}

export const app = createApp();
export default app;

export function startServer() {
  const PORT = 3000;
  const distPath = path.join(process.cwd(), "dist");

  // Serve static assets from built Vite dist
  app.use(express.static(distPath));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  return app.listen(PORT, "0.0.0.0", () => {
    console.log(`Creative DNA Gateway server running on http://0.0.0.0:${PORT}`);
    console.log(`Production MCP endpoint configured at: ${CANONICAL_PRODUCTION_MCP_URL}`);
  });
}

/**
 * Determines whether server.ts is executed directly as the main process
 * (e.g. `npm run dev` with tsx or `npm start` with node dist/server.cjs)
 * versus being imported as a module by a serverless function entrypoint (like Vercel `api/index.ts`)
 * or a test runner.
 */
export function isDirectExecution(): boolean {
  // Never start standalone server on Vercel or in serverless environments
  if (process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return false;
  }
  // Never start standalone server in test mode
  if (process.env.NODE_ENV === "test") {
    return false;
  }
  // Check process entry argument to see if this file was invoked directly
  if (typeof process.argv[1] !== "string") {
    return false;
  }
  const entryFile = path.resolve(process.argv[1]);
  const baseName = path.basename(entryFile);
  return baseName === "server.ts" || baseName === "server.cjs" || baseName === "server.js";
}

// Start server if run directly (local dev / container)
if (isDirectExecution()) {
  startServer();
}
