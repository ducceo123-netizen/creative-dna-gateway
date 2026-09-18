import { useState, useEffect } from "react";
import {
  Sparkles,
  ArrowRight,
  ListFilter,
  Layers,
  Database,
  Terminal,
  ExternalLink,
  Info,
  CheckCircle,
} from "lucide-react";
import { JsonViewer } from "./components/JsonViewer";
import { ApiStatus } from "./components/ApiStatus";
import { HealthResponse, QueryMeta, RouteItem } from "./types";

const NATURAL_ROUTES_PRESETS: Array<{ brand: string; branch: string; label: string }> = [
  { brand: "PawfectHouse", branch: "Onepage", label: "PawfectHouse / Onepage" },
  { brand: "PawfectHouse", branch: "LDP Hero", label: "PawfectHouse / LDP Hero" },
  { brand: "PawfectHouse", branch: "Home Hero", label: "PawfectHouse / Home Hero" },
  { brand: "PawfectHouse", branch: "Seasonal Banner", label: "PawfectHouse / Seasonal Banner" },
  { brand: "PawfectHouse", branch: "Shop By Product", label: "PawfectHouse / Shop By Product" },
  { brand: "PawfectHouse", branch: "Shop By Categories", label: "PawfectHouse / Shop By Categories" },
  { brand: "PawfectHouse", branch: "UGC", label: "PawfectHouse / UGC" },
  { brand: "GiftSoul", branch: "LDP Hero", label: "GiftSoul / LDP Hero" },
  { brand: "GiftSoul", branch: "Shop By Product", label: "GiftSoul / Shop By Product" },
  { brand: "GiftSoul", branch: "UGC", label: "GiftSoul / UGC" },
  { brand: "SoulPrise", branch: "Onepage", label: "SoulPrise / Onepage" },
];

export default function App() {
  const [brand, setBrand] = useState("PawfectHouse");
  const [branch, setBranch] = useState("Onepage");
  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [responseData, setResponseData] = useState<any>(null);
  const [responseMeta, setResponseMeta] = useState<QueryMeta | null>(null);
  const [activeTab, setActiveTab] = useState<"viewer" | "specs">("viewer");
  const [routesList, setRoutesList] = useState<RouteItem[]>([]);

  // Fetch health on mount
  const checkHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/health");
      const data: HealthResponse = await res.json();
      setHealth(data);
    } catch (err: any) {
      setHealth({
        status: "error",
        mode: "read_only",
        upstream: "unreachable",
        latencyMs: 0,
        timestamp: new Date().toISOString(),
        message: err?.message || "Failed to reach health endpoint",
      });
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  // 1. resolve_creative_dna
  const handleResolve = async (customBrand?: string, customBranch?: string) => {
    const targetBrand = customBrand || brand;
    const targetBranch = customBranch || branch;

    if (!targetBrand.trim() || !targetBranch.trim()) {
      alert("Please provide both Brand and Branch.");
      return;
    }

    setLoading(true);
    setActiveTab("viewer");
    const startTime = performance.now();

    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: targetBrand.trim(),
          branch: targetBranch.trim(),
        }),
      });

      const data = await res.json();
      const durationMs = Math.round(performance.now() - startTime);

      setResponseData(data);
      setResponseMeta({
        action: "resolve",
        timestamp: new Date().toLocaleTimeString(),
        durationMs,
        status: res.status,
        ok: res.ok,
      });
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      setResponseData({ error: err?.message || "Failed to execute resolve_creative_dna" });
      setResponseMeta({
        action: "resolve",
        timestamp: new Date().toLocaleTimeString(),
        durationMs,
        status: 500,
        ok: false,
      });
    } finally {
      setLoading(false);
    }
  };

  // 2. list_creative_dna_routes
  const handleListRoutes = async () => {
    setLoading(true);
    setActiveTab("viewer");
    const startTime = performance.now();

    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();
      const durationMs = Math.round(performance.now() - startTime);

      if (data && Array.isArray(data.routes)) {
        setRoutesList(data.routes);
      }

      setResponseData(data);
      setResponseMeta({
        action: "routes",
        timestamp: new Date().toLocaleTimeString(),
        durationMs,
        status: res.status,
        ok: res.ok,
      });
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      setResponseData({ error: err?.message || "Failed to execute list_creative_dna_routes" });
      setResponseMeta({
        action: "routes",
        timestamp: new Date().toLocaleTimeString(),
        durationMs,
        status: 500,
        ok: false,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPreset = (pBrand: string, pBranch: string) => {
    setBrand(pBrand);
    setBranch(pBranch);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased selection:bg-slate-200">
      {/* Top minimal header */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-xs sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-mono font-bold text-sm shadow-xs">
              CD
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 id="app-title" className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                  Creative DNA Gateway
                </h1>
                <span id="gateway-badge" className="px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  Read-only runtime gateway
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Stateless interface &bull; Upstream Supabase single source of truth
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/creative-dna-public"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 px-2.5 py-1 rounded-md transition-colors"
            >
              <span>Upstream Endpoint</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </header>

      {/* Main content container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* API Health & Architecture Banner */}
        <ApiStatus health={health} loading={healthLoading} onRefresh={checkHealth} />

        {/* Testing & Control Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Form & Presets */}
          <div className="lg:col-span-5 space-y-5">
            {/* Query Form Box */}
            <div id="query-form-card" className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-slate-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Gateway Test Controller</h2>
                </div>
                <span className="text-xs text-slate-400 font-mono">POST /api/resolve</span>
              </div>

              {/* Brand Input */}
              <div className="space-y-1.5">
                <label htmlFor="brand-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Brand <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="brand-input"
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="e.g. PawfectHouse"
                    className="w-full px-3.5 py-2 text-sm bg-slate-50/70 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all font-mono"
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Target brand namespace in the knowledge tree.
                </p>
              </div>

              {/* Branch Input */}
              <div className="space-y-1.5">
                <label htmlFor="branch-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Branch <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="branch-input"
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="e.g. Onepage"
                    className="w-full px-3.5 py-2 text-sm bg-slate-50/70 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all font-mono"
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Module or recipe branch path (e.g. Onepage, LDP Hero, UGC).
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <button
                  id="resolve-btn"
                  type="button"
                  onClick={() => handleResolve()}
                  disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 active:scale-98 transition-all disabled:opacity-60 shadow-xs cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>{loading && responseMeta?.action === "resolve" ? "Resolving..." : "Resolve DNA"}</span>
                  <ArrowRight className="w-3.5 h-3.5 opacity-70" />
                </button>

                <button
                  id="list-routes-btn"
                  type="button"
                  onClick={handleListRoutes}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-800 transition-all border border-slate-200 disabled:opacity-60 cursor-pointer"
                >
                  <ListFilter className="w-4 h-4 text-slate-600" />
                  <span>{loading && responseMeta?.action === "routes" ? "Listing..." : "List Routes"}</span>
                </button>
              </div>

              <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Default test: PawfectHouse / Onepage</span>
                <button
                  type="button"
                  onClick={() => {
                    setBrand("PawfectHouse");
                    setBranch("Onepage");
                  }}
                  className="text-slate-600 hover:text-slate-900 underline underline-offset-2 font-medium"
                >
                  Reset Default
                </button>
              </div>
            </div>

            {/* Presets & Natural Routes */}
            <div id="presets-card" className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-600" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                    Natural Routing Examples
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400">Click to load</span>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
                {NATURAL_ROUTES_PRESETS.map((item) => {
                  const isSelected = brand === item.brand && branch === item.branch;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleSelectPreset(item.brand, item.branch)}
                      className={`text-xs px-2.5 py-1.5 rounded-md font-mono transition-all border cursor-pointer ${
                        isSelected
                          ? "bg-slate-900 text-white border-slate-900 shadow-2xs"
                          : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {routesList.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
                    <span>Discovered Routes ({routesList.length})</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1 text-xs">
                    {routesList.map((route, i) => (
                      <div
                        key={`${route.brand}-${route.branch}-${i}`}
                        onClick={() => handleSelectPreset(route.brand, route.branch)}
                        className="flex items-center justify-between p-1.5 rounded hover:bg-slate-100 cursor-pointer text-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 font-mono text-[11px] truncate">
                          <span className="font-semibold text-slate-900">{route.brand}</span>
                          <span className="text-slate-400">/</span>
                          <span className="text-slate-600">{route.branch}</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-600 shrink-0">
                          {route.node_type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Read-Only Hard Rules Summary */}
            <div className="rounded-xl border border-slate-200 bg-slate-100/70 p-4 space-y-2 text-xs text-slate-600">
              <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                <Database className="w-3.5 h-3.5 text-slate-700" />
                <span>Stateless Architecture Guarantees</span>
              </div>
              <ul className="space-y-1 text-[11px] text-slate-500 list-disc list-inside">
                <li>Never mutates, edits, trains, or inserts database records</li>
                <li>Zero database credentials or secrets exposed to browser</li>
                <li>Live query directly dispatched to canonical Supabase endpoint</li>
                <li>No local permanent caching or synthesized Creative DNA</li>
              </ul>
            </div>
          </div>

          {/* Right Column: JSON Viewer & Integration Specs */}
          <div className="lg:col-span-7 space-y-3">
            {/* Tabs for Viewer vs Integration Specs */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("viewer")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activeTab === "viewer"
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  Raw Response JSON
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("specs")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activeTab === "specs"
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  ChatGPT & MCP Integration
                </button>
              </div>

              {responseMeta && activeTab === "viewer" && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                  <span>Op: {responseMeta.action}</span>
                  <span>&bull;</span>
                  <span>{responseMeta.timestamp}</span>
                </div>
              )}
            </div>

            {/* Viewer Tab */}
            {activeTab === "viewer" ? (
              <div className="space-y-3">
                <JsonViewer
                  data={responseData}
                  title={
                    responseMeta
                      ? `Response: ${responseMeta.action.toUpperCase()} (${responseMeta.status})`
                      : "JSON Response Viewer"
                  }
                  meta={
                    responseMeta
                      ? {
                          action: responseMeta.action,
                          durationMs: responseMeta.durationMs,
                          status: responseMeta.status,
                        }
                      : null
                  }
                />

                {/* Quick inspection helper if resolved */}
                {responseData?.resolved_at && (
                  <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Creative DNA Resolved: {responseData?.creative_dna?.title || "System Node"}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Timestamp: {responseData.resolved_at}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Integration Specs Tab */
              <div className="space-y-4 bg-white border border-slate-200 rounded-xl p-5 text-xs shadow-xs">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                  <Info className="w-4 h-4 text-slate-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    ChatGPT &amp; Remote MCP Server Integration
                  </h3>
                </div>

                <p className="text-slate-600 leading-relaxed">
                  This server implements the clean tool interfaces needed for remote execution via ChatGPT Custom GPT Actions or Model Context Protocol (MCP) clients.
                </p>

                {/* Tool 1: resolve_creative_dna */}
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between font-mono font-semibold text-slate-900">
                    <span>1. resolve_creative_dna</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-700">POST /api/resolve</span>
                  </div>
                  <p className="text-slate-500 text-[11px]">
                    Resolves canonical Creative DNA specification for a specified brand and branch.
                  </p>
                  <div className="bg-slate-900 text-slate-200 p-2.5 rounded font-mono text-[11px] overflow-x-auto">
                    {`curl -X POST https://${window.location.host}/api/resolve \\
  -H "Content-Type: application/json" \\
  -d '{"brand": "PawfectHouse", "branch": "Onepage"}'`}
                  </div>
                </div>

                {/* Tool 2: list_creative_dna_routes */}
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between font-mono font-semibold text-slate-900">
                    <span>2. list_creative_dna_routes</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-700">POST /api/routes</span>
                  </div>
                  <p className="text-slate-500 text-[11px]">
                    Returns all available brands and branches registered in the Creative DNA knowledge graph.
                  </p>
                  <div className="bg-slate-900 text-slate-200 p-2.5 rounded font-mono text-[11px] overflow-x-auto">
                    {`curl -X POST https://${window.location.host}/api/routes \\
  -H "Content-Type: application/json"`}
                  </div>
                </div>

                {/* Remote MCP Endpoint */}
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between font-mono font-semibold text-slate-900">
                    <span>3. Remote MCP JSON-RPC Endpoint</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-700">POST /api/mcp</span>
                  </div>
                  <p className="text-slate-500 text-[11px]">
                    Supports JSON-RPC 2.0 <code className="font-semibold text-slate-700">tools/list</code> and{" "}
                    <code className="font-semibold text-slate-700">tools/call</code> methods natively for Cursor, Claude Desktop, and MCP agents.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
