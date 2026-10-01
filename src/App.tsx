import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Layers,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { JsonViewer } from "./components/JsonViewer";
import { PrivacyPolicy } from "./components/PrivacyPolicy";
import { TermsOfService } from "./components/TermsOfService";
import { SupportPage } from "./components/SupportPage";
import { AdminFeedback } from "./components/AdminFeedback";
import { FeedbackUpload } from "./components/FeedbackUpload";
import { QueryMeta } from "./types";

const PRODUCTION_MCP_URL = "https://creative-dna-gateway.vercel.app/api/mcp";

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

type ActivePage = "home" | "privacy" | "terms" | "support" | "admin-feedback" | "feedback-upload";

export default function App() {
  const [currentPage, setCurrentPage] = useState<ActivePage>("home");
  const [brand, setBrand] = useState("PawfectHouse");
  const [branch, setBranch] = useState("Onepage");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [responseData, setResponseData] = useState<any>(null);
  const [responseMeta, setResponseMeta] = useState<QueryMeta | null>(null);

  useEffect(() => {
    const syncRouteFromPath = () => {
      const path = window.location.pathname.toLowerCase();
      if (path === "/privacy") setCurrentPage("privacy");
      else if (path === "/terms") setCurrentPage("terms");
      else if (path === "/support") setCurrentPage("support");
      else if (path === "/admin/feedback") setCurrentPage("admin-feedback");
      else if (path === "/feedback/upload") setCurrentPage("feedback-upload");
      else setCurrentPage("home");
    };
    syncRouteFromPath();
    window.addEventListener("popstate", syncRouteFromPath);
    return () => window.removeEventListener("popstate", syncRouteFromPath);
  }, []);

  const navigateTo = (page: ActivePage) => {
    setCurrentPage(page);
    const path = page === "home" ? "/" : page === "admin-feedback" ? "/admin/feedback" : `/${page}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const useCommand = useMemo(() => `Creative DNA — Use: ${brand} / ${branch}`, [brand, branch]);
  const trainCommand = useMemo(() => `Creative DNA — Train: ${brand} / ${branch}`, [brand, branch]);

  const selectBranch = (nextBrand: string, nextBranch: string) => {
    setBrand(nextBrand);
    setBranch(nextBranch);
    setResponseData(null);
    setResponseMeta(null);
    requestAnimationFrame(() => {
      document.getElementById("chatgpt-command")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const handleResolve = async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, branch }),
      });
      const data = await res.json();
      setResponseData(data);
      setResponseMeta({
        action: "resolve",
        timestamp: new Date().toLocaleTimeString(),
        durationMs: Math.round(performance.now() - start),
        status: res.status,
        ok: res.ok,
      });
    } catch (err: any) {
      setResponseData({ error: err?.message || "Failed to resolve Creative DNA" });
      setResponseMeta({
        action: "resolve",
        timestamp: new Date().toLocaleTimeString(),
        durationMs: Math.round(performance.now() - start),
        status: 500,
        ok: false,
      });
    } finally {
      setLoading(false);
    }
  };

  if (currentPage === "privacy") {
    return <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased"><PrivacyPolicy onBack={() => navigateTo("home")} /></div>;
  }
  if (currentPage === "terms") {
    return <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased"><TermsOfService onBack={() => navigateTo("home")} /></div>;
  }
  if (currentPage === "admin-feedback") {
    return <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased"><AdminFeedback onBack={() => navigateTo("home")} /></div>;
  }
  if (currentPage === "feedback-upload") {
    return <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased"><FeedbackUpload onBack={() => navigateTo("home")} /></div>;
  }
  if (currentPage === "support") {
    return <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased"><SupportPage onBack={() => navigateTo("home")} /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased selection:bg-indigo-100">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-950 flex items-center justify-center p-1.5 border border-slate-800">
              <img src="/icon.svg" alt="Creative DNA" className="w-full h-full" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold tracking-tight text-slate-900">Creative DNA</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">Chọn brand & branch → copy câu lệnh → dùng ngay trong ChatGPT</p>
            </div>
          </div>

          <nav className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigateTo("admin-feedback")}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              Feedback Admin
            </button>
            <button
              type="button"
              onClick={() => navigateTo("support")}
              className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 rounded-lg"
            >
              Support
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-7 space-y-6">
        <section className="space-y-2">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[11px] font-bold text-indigo-700">
            <Sparkles className="w-3.5 h-3.5" />
            Creative DNA Gateway
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Gọi đúng Creative DNA trong ChatGPT
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Chọn đúng nhánh bạn muốn dùng. Dashboard sẽ tạo sẵn câu lệnh ngắn để copy vào ChatGPT.
          </p>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900">Chọn Brand / Branch</h2>
            </div>
            <span className="text-xs text-slate-400">{SUPPORTED_BRANDS.length} brands</span>
          </div>

          <div className="space-y-3">
            {SUPPORTED_BRANDS.map((b) => (
              <div key={b.name} className={`rounded-xl border p-4 transition-colors ${brand === b.name ? "border-indigo-200 bg-indigo-50/30" : "border-slate-100 bg-slate-50/60"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 mb-3">
                  <span className="text-sm font-extrabold text-slate-900">{b.name}</span>
                  <span className="text-[11px] text-slate-400">{b.category}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.branches.map((br) => {
                    const selected = brand === b.name && branch === br;
                    return (
                      <button
                        key={br}
                        type="button"
                        onClick={() => selectBranch(b.name, br)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                          selected
                            ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                            : "bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"
                        }`}
                      >
                        {br}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="chatgpt-command" className="bg-slate-950 text-white rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-indigo-300">
                <MessageSquareText className="w-4 h-4" />
                <span className="text-[11px] font-extrabold uppercase tracking-wider">Câu lệnh dùng trong ChatGPT</span>
              </div>
              <div className="text-lg font-extrabold mt-1">{brand} / {branch}</div>
            </div>
            <span className="self-start px-2.5 py-1 rounded-full bg-white/10 text-[10px] font-bold text-slate-300 border border-white/10">
              Selected branch
            </span>
          </div>

          <div className="rounded-xl bg-slate-900 border border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-700">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Use</span>
              <button
                type="button"
                onClick={() => handleCopy(useCommand, "use-command")}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
              >
                {copiedKey === "use-command" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === "use-command" ? "Đã copy" : "Copy"}
              </button>
            </div>
            <div className="px-4 py-4 font-mono text-sm sm:text-base text-emerald-300 break-words">{useCommand}</div>
          </div>

          <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-center rounded-xl bg-white/5 border border-white/10 px-4 py-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Khi muốn train feedback / wisdom</div>
              <div className="font-mono text-xs text-slate-300 mt-1 break-words">{trainCommand}</div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(trainCommand, "train-command")}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white"
            >
              {copiedKey === "train-command" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === "train-command" ? "Đã copy" : "Copy Train"}
            </button>
          </div>

          <p className="text-xs text-slate-400">
            Sau câu lệnh, chỉ cần viết tiếp yêu cầu của bạn, ví dụ product URL, theme, ratio hoặc feedback cụ thể.
          </p>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-slate-500" />
              <div>
                <div className="text-sm font-bold text-slate-900">Advanced / Debug</div>
                <div className="text-xs text-slate-400">Canonical spec & MCP endpoint — chỉ mở khi cần kiểm tra.</div>
              </div>
            </div>
            <span className="text-xs font-semibold text-slate-500">{showAdvanced ? "Ẩn" : "Mở"}</span>
          </button>

          {showAdvanced && (
            <div className="border-t border-slate-100 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleResolve}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {loading ? "Đang resolve..." : "View canonical spec"}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy(PRODUCTION_MCP_URL, "mcp-url")}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200"
                >
                  {copiedKey === "mcp-url" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy MCP endpoint
                </button>
                <a
                  href="/api/mcp"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Open endpoint <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {responseData && <JsonViewer data={responseData} meta={responseMeta} loading={loading} />}
            </div>
          )}
        </section>

        <section className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          Canonical Creative DNA vẫn là source of truth; dashboard này chỉ giúp chọn đúng route và gọi nhanh trong ChatGPT.
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white mt-10 py-6">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <span>Creative DNA · ChatGPT creative knowledge gateway</span>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => navigateTo("privacy")} className="hover:text-slate-700">Privacy</button>
            <button type="button" onClick={() => navigateTo("terms")} className="hover:text-slate-700">Terms</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
