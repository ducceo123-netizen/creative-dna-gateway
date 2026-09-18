import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const SUPABASE_PUBLIC_URL = "https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/creative-dna-public";

// Clean core gateway functions - strictly read-only and stateless
async function fetchUpstream(payload: { action: "resolve"; brand: string; branch: string } | { action: "routes" }) {
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

// MCP and ChatGPT tool definitions
const TOOL_DEFINITIONS = [
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // CORS headers for direct remote integration
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(502).json({
        status: "error",
        mode: "read_only",
        upstream: "unreachable",
        message: err?.message || "Failed to reach upstream Creative DNA API",
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Operation 1: resolve_creative_dna
  app.post("/api/resolve", async (req: Request, res: Response) => {
    try {
      const { brand, branch } = req.body;
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
      const brand = req.body.brand || req.body.arguments?.brand;
      const branch = req.body.branch || req.body.arguments?.branch;
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

  // Tool discovery & OpenAPI / MCP schema endpoints
  app.get("/api/tools", (_req: Request, res: Response) => {
    return res.json({
      name: "Creative DNA Gateway",
      version: "1.0.0",
      description: "Read-only gateway for the canonical Creative DNA knowledge system.",
      tools: TOOL_DEFINITIONS,
    });
  });

  // Remote MCP JSON-RPC 2.0 endpoint (compatible with MCP Clients & ChatGPT)
  app.post("/api/mcp", async (req: Request, res: Response) => {
    const { jsonrpc, id, method, params } = req.body || {};

    if (method === "tools/list") {
      return res.json({
        jsonrpc: jsonrpc || "2.0",
        id: id ?? null,
        result: {
          tools: TOOL_DEFINITIONS,
        },
      });
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      try {
        if (toolName === "resolve_creative_dna") {
          const upstream = await resolveCreativeDna(toolArgs.brand, toolArgs.branch);
          return res.json({
            jsonrpc: jsonrpc || "2.0",
            id: id ?? null,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(upstream.data, null, 2),
                },
              ],
              isError: !upstream.ok,
            },
          });
        }

        if (toolName === "list_creative_dna_routes") {
          const upstream = await listCreativeDnaRoutes();
          return res.json({
            jsonrpc: jsonrpc || "2.0",
            id: id ?? null,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(upstream.data, null, 2),
                },
              ],
              isError: !upstream.ok,
            },
          });
        }

        return res.status(404).json({
          jsonrpc: jsonrpc || "2.0",
          id: id ?? null,
          error: {
            code: -32601,
            message: `Method or tool '${toolName}' not found`,
          },
        });
      } catch (err: any) {
        return res.status(500).json({
          jsonrpc: jsonrpc || "2.0",
          id: id ?? null,
          error: {
            code: -32603,
            message: err?.message || "Internal error executing tool",
          },
        });
      }
    }

    // Default response for unrecognized JSON-RPC method
    return res.json({
      jsonrpc: jsonrpc || "2.0",
      id: id ?? null,
      result: {
        server: "Creative DNA Gateway",
        status: "ready",
        read_only: true,
      },
    });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Creative DNA Gateway server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
