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
  CheckCircle2,
  Copy,
  Check,
  ShieldCheck,
  Cpu,
  Play,
  Activity,
  Compass,
  FileCode,
  Zap,
  BookOpen,
  Scale,
  HelpCircle,
} from "lucide-react";
import { JsonViewer } from "./components/JsonViewer";
import { ApiStatus } from "./components/ApiStatus";
import { PrivacyPolicy } from "./components/PrivacyPolicy";
import { TermsOfService } from "./components/TermsOfService";
import { SupportPage } from "./components/SupportPage";
import { AdminFeedback } from "./components/AdminFeedback";
import { FeedbackUpload } from "./components/FeedbackUpload";
import { HealthResponse, QueryMeta, RouteItem } from "./types";

const PRODUCTION_MCP_URL = "https://creative-dna-gateway.vercel.app/api/mcp";
const PRODUCTION_ORIGIN = "https://creative-dna-gateway.vercel.app";

const SUPPORTED_BRANDS = [
  {
    name: "PawfectHouse",
    category: "Personalized Pet & Family Gifts",
    branches: ["Onepage", "LDP Hero", "Home Hero", "Seasonal Banner", "Shop By Product", "Shop By Categories", "UGC"],
  },
  {
    name: "GiftSoul",
    category: "Custom Keepsakes & Emotional Gifts",
    branches: ["LDP Hero", "Shop By Product", "UGC"],
  },
  {
    name: "SoulPrise",
    category: "Modern Artisanal Gifting",
    branches: ["Onepage"],
  },
];

const CAPABILITIES = [
  { name: "Brand DNA", desc: "Canonical voice, tone, typography, color codes, and emotional branding principles." },
  { name: "Landing Page systems", desc: "Section hierarchy, modular layout rules, and high-converting flow logic." },
  { name: "Hero/banner rules", desc: "Above-the-fold visual weight, headline formulations, and CTA placement." },
  { name: "Product imagery rules", desc: "Photography angles, staging standards, aspect ratios, and render guidelines." },
  { name: "UGC rules", desc: "Creator briefs, hook patterns, authentic framing, and social creative guardrails." },
  { name: "Onepage systems", desc: "Unified single-page sales funnel architectures engineered for peak conversion." },
];

const PRESET_PROMPTS = [
  {
    brand: "PawfectHouse",
    branch: "Onepage",
    label: "PawfectHouse / Onepage",
    prompt: "Creative DNA — Use: PawfectHouse / Onepage. Generate a high-converting above-the-fold hero and feature layout following the canonical creative rules.",
  },
  {
    brand: "PawfectHouse",
    branch: "LDP Hero",
    label: "PawfectHouse / LDP Hero",
    prompt: "Creative DNA — Use: PawfectHouse / LDP Hero. Draft 3 headline options and visual creative direction aligned with brand specifications.",
  },
  {
    brand: "GiftSoul",
    branch: "Shop By Product",
    label: "GiftSoul / Shop By Product",
    prompt: "Creative DNA — Use: GiftSoul / Shop By Product Image. Specify the canonical product grid image staging guidelines.",
  },
  {
    brand: "GiftSoul",
    branch: "UGC",
    label: "GiftSoul / UGC",
    prompt: "Creative DNA — Use: GiftSoul / UGC. Write a creator brief and 3 hook variations following brand authentic content standards.",
  },
  {
    brand: "SoulPrise",
    branch: "Onepage",
    label: "SoulPrise / Onepage",
    prompt: "Creative DNA — Use: SoulPrise / Onepage. Outline the canonical section structure and conversion copy flow.",
  },
];

type ActivePage = "home" | "privacy" | "terms" | "support" | "admin-feedback" | "feedback-upload";

export default function App() {
  const [currentPage, setCurrentPage] = useState<ActivePage>("home");
  const [brand, setBrand] = useState("PawfectHouse");
  const [branch, setBranch] = useState("Onepage");
  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [responseData, setResponseData] = useState<any>(null);
  const [responseMeta, setResponseMeta] = useState<QueryMeta | null>(null);
  const [activeTab, setActiveTab] = useState<"viewer" | "specs" | "mcp">("viewer");
  const [routesList, setRoutesList] = useState<RouteItem[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpTestResult, setMcpTestResult] = useState<any>(null);

  // Sync client-side route with URL path
  useEffect(() => {
    const syncRouteFromPath = () => {
      const path = window.location.pathname.toLowerCase();
      if (path === "/privacy") {
        setCurrentPage("privacy");
      } else if (path === "/terms") {
        setCurrentPage("terms");
      } else if (path === "/support") {
        setCurrentPage("support");
      } else if (path === "/admin/feedback") {
        setCurrentPage("admin-feedback");
      } else if (path === "/feedback/upload") {
        setCurrentPage("feedback-upload");
      } else {
        setCurrentPage("home");
      }
    };

    syncRouteFromPath();
    window.addEventListener("popstate", syncRouteFromPath);
    return () => window.removeEventListener("popstate", syncRouteFromPath);
  }, []);

  const navigateTo = (page: ActivePage) => {
    setCurrentPage(page);
    const path = page === "home" ? "/" : page === "admin-feedback" ? "/admin/feedback" : `/${page}`;
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Copy helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

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

  // Live MCP protocol tester
  const runMcpLiveTest = async (testType: "initialize" | "tools/list" | "tools/call") => {
    setMcpTesting(true);
    setActiveTab("mcp");
    try {
      let body: any;
      if (testType === "initialize") {
        body = {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "chatgpt-client-simulator", version: "1.0.0" },
          },
        };
      } else if (testType === "tools/list") {
        body = {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        };
      } else {
        body = {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "resolve_creative_dna",
            arguments: { brand: "PawfectHouse", branch: "Onepage" },
          },
        };
      }

      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setMcpTestResult({
        testType,
        status: res.status,
        ok: res.ok,
        timestamp: new Date().toLocaleTimeString(),
        request: body,
        response: json,
      });
    } catch (err: any) {
      setMcpTestResult({
        testType,
        status: 500,
        ok: false,
        timestamp: new Date().toLocaleTimeString(),
        error: err?.message || "Failed to execute MCP test",
      });
    } finally {
      setMcpTesting(false);
    }
  };

  if (currentPage === "privacy") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
        <PrivacyPolicy onBack={() => navigateTo("home")} />
      </div>
    );
  }

  if (currentPage === "terms") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
        <TermsOfService onBack={() => navigateTo("home")} />
      </div>
    );
  }

  if (currentPage === "admin-feedback") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
        <AdminFeedback onBack={() => navigateTo("home")} />
      </div>
    );
  }

  if (currentPage === "feedback-upload") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
        <FeedbackUpload onBack={() => navigateTo("home")} />
      </div>
    );
  }

  if (currentPage === "support") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
        <SupportPage onBack={() => navigateTo("home")} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased selection:bg-slate-200">
      {/* Top Professional Header */}
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur-xs sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-950 flex items-center justify-center p-1.5 shadow-xs border border-slate-800">
              <img src="/icon.svg" alt="Creative DNA" className="w-full h-full" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                  Creative DNA
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  ChatGPT App
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Live Creative Intelligence for Ecommerce Brands
              </p>
            </div>
          </div>

          {/* Quick Navigation Links */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              id="nav-explorer-btn"
              type="button"
              onClick={() => {
                document.getElementById("explorer-section")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
            >
              Explorer
            </button>
            <button
              id="nav-support-btn"
              type="button"
              onClick={() => navigateTo("support")}
              className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
            >
              Support
            </button>
            <a
              id="nav-mcp-btn"
              href="/api/mcp"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-200"
            >
              <span>MCP Endpoint</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Hero Section */}
        <section id="hero-section" className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>OpenAI Apps SDK &amp; Model Context Protocol Compliant</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Live Creative Intelligence for Ecommerce Brands
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Creative DNA connects ChatGPT to a live, structured brand knowledge system containing creative direction, visual rules, landing-page systems, asset specifications, product-image rules, UGC direction, and brand-specific production constraints.
            </p>
          </div>

          {/* Live Status Ribbon */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</div>
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live &amp; Operational
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mode</div>
                <div className="text-xs font-bold text-slate-900 mt-0.5">Strictly Read-Only</div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-700 flex items-center justify-center">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Source of Truth</div>
                <div className="text-xs font-bold text-slate-900 mt-0.5 truncate">Creative DNA Canonical Datastore</div>
              </div>
            </div>
          </div>

          {/* Quick MCP Endpoint Copy bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-900 text-white rounded-xl">
            <div className="flex items-center gap-2.5 overflow-hidden w-full sm:w-auto">
              <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-xs truncate">
                <span className="text-slate-400">Remote MCP Server: </span>
                <span className="font-mono text-emerald-300">{PRODUCTION_MCP_URL}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
              <button
                id="copy-mcp-url-btn"
                type="button"
                onClick={() => handleCopy(PRODUCTION_MCP_URL, "mcp-url")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded-lg text-slate-200 transition-colors border border-slate-700"
              >
                {copiedKey === "mcp-url" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === "mcp-url" ? "Copied URL" : "Copy MCP Endpoint"}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Brand & Capabilities Grid */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Supported Brands */}
          <div className="md:col-span-6 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Supported Brands</h2>
              </div>
              <span className="text-xs text-slate-500 font-medium">3 Canonical Brands</span>
            </div>

            <div className="space-y-3">
              {SUPPORTED_BRANDS.map((b) => (
                <div
                  key={b.name}
                  className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/70 hover:bg-slate-50 transition-colors space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">{b.name}</span>
                    <span className="text-[11px] text-slate-500">{b.category}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {b.branches.map((br) => (
                      <button
                        key={br}
                        type="button"
                        onClick={() => {
                          setBrand(b.name);
                          setBranch(br);
                          handleResolve(b.name, br);
                          document.getElementById("explorer-section")?.scrollIntoView({ behavior: "smooth" });
                        }}
                        className="px-2 py-0.5 rounded text-[11px] font-medium bg-white hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 border border-slate-200 transition-colors"
                      >
                        {br}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Capabilities */}
          <div className="md:col-span-6 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Capabilities</h2>
              </div>
              <span className="text-xs text-slate-500 font-medium">6 Core Modules</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {CAPABILITIES.map((c) => (
                <div
                  key={c.name}
                  className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 space-y-1"
                >
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                    {c.name}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-normal">{c.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive Explorer & ChatGPT Prompts */}
        <section id="explorer-section" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Interactive Brand &amp; Branch Explorer</h2>
              <p className="text-xs text-slate-500">Test canonical resolution or copy pre-structured prompt triggers for ChatGPT.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                id="tab-viewer-btn"
                type="button"
                onClick={() => setActiveTab("viewer")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  activeTab === "viewer"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                }`}
              >
                Canonical Spec Viewer
              </button>
              <button
                id="tab-mcp-btn"
                type="button"
                onClick={() => setActiveTab("mcp")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  activeTab === "mcp"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                }`}
              >
                Live MCP Tester
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Form & Presets */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                <div className="space-y-3">
                  <div>
                    <label htmlFor="brand-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Brand Name
                    </label>
                    <input
                      id="brand-input"
                      type="text"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder="e.g. PawfectHouse, GiftSoul, SoulPrise"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-slate-900 text-slate-800"
                    />
                  </div>

                  <div>
                    <label htmlFor="branch-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Branch / Path
                    </label>
                    <input
                      id="branch-input"
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="e.g. Onepage, LDP Hero, UGC"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-slate-900 text-slate-800"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      id="resolve-dna-btn"
                      type="button"
                      onClick={() => handleResolve()}
                      disabled={loading}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{loading ? "Resolving..." : "Resolve Creative DNA"}</span>
                    </button>
                    <button
                      id="list-routes-btn"
                      type="button"
                      onClick={handleListRoutes}
                      disabled={loading}
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors border border-slate-200 disabled:opacity-50"
                      title="Discover all registered routes"
                    >
                      <ListFilter className="w-3.5 h-3.5" />
                      <span>Discover Routes</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Sample ChatGPT Prompts */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Quick Prompts for ChatGPT
                  </span>
                  <span className="text-[11px] text-slate-400">Click to test &amp; copy</span>
                </div>
                <div className="space-y-2">
                  {PRESET_PROMPTS.map((p, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg border border-slate-100 bg-slate-50/70 hover:bg-slate-50 transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-800">{p.label}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setBrand(p.brand);
                              setBranch(p.branch);
                              handleResolve(p.brand, p.branch);
                            }}
                            className="px-2 py-0.5 text-[10px] font-medium bg-white hover:bg-slate-200 text-slate-700 rounded border border-slate-200"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(p.prompt, `prompt-${idx}`)}
                            className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-200"
                            title="Copy prompt"
                          >
                            {copiedKey === `prompt-${idx}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono line-clamp-2">{p.prompt}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Display Viewer / MCP Tester */}
            <div className="lg:col-span-7">
              {activeTab === "viewer" ? (
                <JsonViewer
                  data={responseData}
                  meta={responseMeta}
                  loading={loading}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">MCP Protocol Test Runner</h3>
                      <p className="text-xs text-slate-500">Live test Streamable HTTP transport and readOnly annotations.</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => runMcpLiveTest("initialize")}
                        disabled={mcpTesting}
                        className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border border-slate-200"
                      >
                        initialize
                      </button>
                      <button
                        type="button"
                        onClick={() => runMcpLiveTest("tools/list")}
                        disabled={mcpTesting}
                        className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border border-slate-200"
                      >
                        tools/list
                      </button>
                      <button
                        type="button"
                        onClick={() => runMcpLiveTest("tools/call")}
                        disabled={mcpTesting}
                        className="px-2.5 py-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-md"
                      >
                        tools/call
                      </button>
                    </div>
                  </div>

                  {mcpTesting ? (
                    <div className="h-64 flex flex-col items-center justify-center gap-2 text-slate-400">
                      <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs">Executing MCP JSON-RPC 2.0 handshake...</span>
                    </div>
                  ) : mcpTestResult ? (
                    <div className="space-y-3 font-mono text-xs">
                      <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-600">Method: {mcpTestResult.testType}</span>
                        <span className={`font-semibold ${mcpTestResult.ok ? "text-emerald-600" : "text-rose-600"}`}>
                          HTTP {mcpTestResult.status} ({mcpTestResult.timestamp})
                        </span>
                      </div>
                      <div className="p-3 bg-slate-950 text-slate-200 rounded-lg overflow-x-auto max-h-96 text-[11px] leading-relaxed">
                        <pre>{JSON.stringify(mcpTestResult.response || mcpTestResult.error, null, 2)}</pre>
                      </div>
                    </div>
                  ) : (
                    <div className="h-64 flex flex-col items-center justify-center gap-2 text-slate-400 text-center p-4">
                      <Terminal className="w-8 h-8 text-slate-300" />
                      <p className="text-xs">Click one of the test methods above to simulate ChatGPT calling this remote MCP server.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Live System Health Banner */}
        <ApiStatus health={health} loading={healthLoading} onRefresh={checkHealth} />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900">Creative DNA</span>
              <span>&bull;</span>
              <span>Built for ChatGPT using the Apps SDK and Model Context Protocol</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
            <button
              id="footer-privacy-btn"
              type="button"
              onClick={() => navigateTo("privacy")}
              className="hover:text-slate-900 cursor-pointer"
            >
              Privacy Policy
            </button>
            <button
              id="footer-terms-btn"
              type="button"
              onClick={() => navigateTo("terms")}
              className="hover:text-slate-900 cursor-pointer"
            >
              Terms of Service
            </button>
            <button
              id="footer-support-btn"
              type="button"
              onClick={() => navigateTo("support")}
              className="hover:text-slate-900 cursor-pointer"
            >
              Support &amp; Contact
            </button>
            <a
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-900"
            >
              OpenAPI 3.1
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
