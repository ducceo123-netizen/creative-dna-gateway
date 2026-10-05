import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Layers,
  Plug,
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

const BRAND_META: Record<string, { name:string; category:string }> = {
  pawfecthouse: { name:"PawfectHouse", category:"Personalized Pet & Family Gifts" },
  giftsoul: { name:"GiftSoul", category:"Custom Keepsakes & Emotional Gifts" },
  soulprise: { name:"SoulPrise", category:"Modern Artisanal Gifting" },
};

const BRANCH_LABELS: Record<string,string> = {
  "onepage-system":"Onepage",
  "ldp-system":"LDP",
  "ldp-hero":"LDP Hero",
  "home-hero":"Home Hero",
  "recipient-image":"Recipient Image",
  "seasonal-banner":"Seasonal Banner",
  "shop-by-product-image":"Shop By Product",
  "shop-by-categories":"Shop By Categories",
  "ugc-image":"UGC",
};

const FALLBACK_BRANDS = [
  { name:"PawfectHouse", category:"Personalized Pet & Family Gifts", branches:["Onepage","LDP","LDP Hero","Home Hero","Seasonal Banner","Shop By Product","Shop By Categories","UGC"] },
  { name:"GiftSoul", category:"Custom Keepsakes & Emotional Gifts", branches:["Onepage","LDP","LDP Hero","Home Hero","Recipient Image","Seasonal Banner","Shop By Product","UGC"] },
  { name:"SoulPrise", category:"Modern Artisanal Gifting", branches:["Home Hero","Recipient Image","Seasonal Banner","Shop By Product","Onepage"] },
];

const DEFAULT_BRANCH_HELP: Record<string,{usage_badge:string;description_vi:string;output_note:string}> = {
  "onepage-system": { usage_badge:"PDP / Onepage", description_vi:"Material cho toàn bộ khối Onepage gắn vào PDP: Banner, Why You'll Love It, Product Details, Occasion và Good To Know.", output_note:"Output theo cấu trúc Onepage canonical của brand." },
  "ldp-system": { usage_badge:"Landing Page", description_vi:"Hệ thống material cho toàn bộ LDP: hierarchy, section logic, copy flow và visual consistency.", output_note:"Dùng khi làm hoặc kiểm tra cả Landing Page." },
  "ldp-hero": { usage_badge:"LDP · Hero", description_vi:"Material cho hero đầu Landing Page, tập trung visual story, sản phẩm chính và khoảng trống cho content.", output_note:"Hero image theo ratio và alignment của campaign." },
  "home-hero": { usage_badge:"Homepage · Hero", description_vi:"Material cho khu vực hero trên Homepage. Dùng để tạo Main/Side hero hoặc hero campaign tương ứng.", output_note:"Homepage hero theo đúng format của brand." },
  "recipient-image": { usage_badge:"LDP · Recipient", description_vi:"Material cho block Shop by Recipient / Gift For, giúp user nhận ra nhanh món quà dành cho ai.", output_note:"Một image riêng cho từng recipient group." },
  "seasonal-banner": { usage_badge:"Seasonal Banner", description_vi:"Material cho banner theo mùa/campaign, thường nằm giữa hành trình browse hoặc trên collection/LDP.", output_note:"Banner ngang, ưu tiên scene + product + text runway." },
  "shop-by-product-image": { usage_badge:"Shop By Product", description_vi:"Material cho block Shop By Product, tập trung một sản phẩm chính, clean staging và product fidelity.", output_note:"Một image riêng cho từng product tile." },
  "shop-by-categories": { usage_badge:"Shop By Categories", description_vi:"Material cho block Shop By Categories, đại diện trực quan cho từng category/niche để user scan nhanh.", output_note:"Một image riêng cho từng category." },
  "ugc-image": { usage_badge:"UGC / Social Proof", description_vi:"Material UGC dùng cho social proof, lifestyle proof hoặc content creator-style trong LDP/PDP.", output_note:"Ảnh tự nhiên, đa angle, ưu tiên authenticity." },
};

type PromptField = { label:string; required:boolean; placeholder:string };
const TASK_PROMPT_FIELDS: Record<string,PromptField[]> = {
  "onepage-system": [
    { label:"Product / Collection", required:true, placeholder:"PDP URL hoặc Collection URL" },
    { label:"Theme", required:false, placeholder:"Halloween / Christmas / Book Lovers /..." },
    { label:"Custom content", required:false, placeholder:"Copy, angle hoặc yêu cầu riêng nếu có" },
  ],
  "ldp-system": [
    { label:"Product / Collection", required:true, placeholder:"Product URL hoặc Collection URL" },
    { label:"Theme / Campaign", required:false, placeholder:"America 250 / Book Lovers / Christmas /..." },
    { label:"Page goal", required:false, placeholder:"Campaign page, niche page, product line..." },
  ],
  "ldp-hero": [
    { label:"Product / Collection", required:true, placeholder:"Product hoặc collection cần làm hero" },
    { label:"Theme", required:false, placeholder:"Campaign / niche / season" },
    { label:"Ratio / Align", required:false, placeholder:"21:9, 18:9, center, right..." },
    { label:"Angle / Story", required:false, placeholder:"Moment hoặc art direction mong muốn" },
  ],
  "home-hero": [
    { label:"Product / Collection", required:true, placeholder:"Product URL hoặc Collection URL" },
    { label:"Theme / Campaign", required:true, placeholder:"Halloween / Christmas /..." },
    { label:"Slot", required:false, placeholder:"Main / Side / Both nếu branch hỗ trợ" },
    { label:"Idea", required:false, placeholder:"Story, moment hoặc creative angle" },
  ],
  "recipient-image": [
    { label:"Recipient", required:true, placeholder:"Family / Couple / Dad & Grandpa /..." },
    { label:"Theme", required:false, placeholder:"Campaign / season nếu có" },
    { label:"Quantity", required:false, placeholder:"Số ảnh cần tạo" },
    { label:"Age / Relationship", required:false, placeholder:"Chi tiết casting nếu cần" },
  ],
  "seasonal-banner": [
    { label:"Product / Collection", required:true, placeholder:"Product hoặc collection liên quan" },
    { label:"Theme / Campaign", required:true, placeholder:"Halloween / Christmas /..." },
    { label:"Idea", required:false, placeholder:"Moment / story / use case" },
    { label:"Custom size", required:false, placeholder:"Chỉ nhập khi muốn override size mặc định" },
  ],
  "shop-by-product-image": [
    { label:"Product", required:true, placeholder:"PDP URL / product image / product spec" },
    { label:"Product type", required:false, placeholder:"Mug / Socks / Ornament /..." },
    { label:"Theme / Context", required:false, placeholder:"Book Lover / Halloween /..." },
    { label:"Ratio / Size", required:false, placeholder:"Nếu muốn override mặc định" },
  ],
  "shop-by-categories": [
    { label:"Category / Niche", required:true, placeholder:"Reading / Crochet / Gardening /..." },
    { label:"Product pool", required:false, placeholder:"Collection URL hoặc danh sách sản phẩm" },
    { label:"Theme", required:false, placeholder:"Campaign / season nếu có" },
  ],
  "ugc-image": [
    { label:"Product / Collection", required:true, placeholder:"PDP hoặc Collection URL" },
    { label:"Theme / Context", required:false, placeholder:"Use case / campaign / occasion" },
    { label:"Quantity", required:false, placeholder:"Số ảnh UGC cần tạo" },
    { label:"Angle mix", required:false, placeholder:"POV / human with product / product-only..." },
  ],
};

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
  const [supportedBrands, setSupportedBrands] = useState(FALLBACK_BRANDS);
  const [branchGuides, setBranchGuides] = useState<any[]>([]);

  useEffect(() => {
    const loadCanonicalRoutes = async () => {
      try {
        const res = await fetch("/api/routes", { method:"POST", headers:{ "Content-Type":"application/json" } });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data?.routes)) return;

        const grouped = new Map<string, { name:string; category:string; branches:string[] }>();
        for (const route of data.routes) {
          const brandKey = String(route.brand || "").toLowerCase();
          const branchKey = String(route.branch || "").toLowerCase();
          if (!brandKey || !branchKey) continue;
          const meta = BRAND_META[brandKey] || { name:route.brand, category:"Creative DNA" };
          if (!grouped.has(brandKey)) grouped.set(brandKey, { ...meta, branches:[] });
          const label = BRANCH_LABELS[branchKey] || branchKey.split("-").map((x:string)=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ");
          const item = grouped.get(brandKey)!;
          if (!item.branches.includes(label)) item.branches.push(label);
        }

        const order = ["pawfecthouse","giftsoul","soulprise"];
        const next = order.map(k=>grouped.get(k)).filter(Boolean) as { name:string; category:string; branches:string[] }[];
        if (next.length) setSupportedBrands(next);
      } catch {
        // Keep fallback routes so dashboard remains usable if route discovery is temporarily unavailable.
      }
    };
    loadCanonicalRoutes();

    const loadBranchGuides = async () => {
      try {
        const res = await fetch("/api/branch-guides", { cache:"no-store" });
        const data = await res.json();
        if (res.ok && Array.isArray(data?.guides)) setBranchGuides(data.guides);
      } catch {
        // Optional visual guide layer; branch selection remains usable without it.
      }
    };
    loadBranchGuides();

    const syncGuides = () => {
      if (document.visibilityState === "visible") loadBranchGuides();
    };
    const guidePoll = window.setInterval(syncGuides, 10000);
    document.addEventListener("visibilitychange", syncGuides);
    window.addEventListener("focus", syncGuides);

    return () => {
      window.clearInterval(guidePoll);
      document.removeEventListener("visibilitychange", syncGuides);
      window.removeEventListener("focus", syncGuides);
    };
  }, []);

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

  const selectedBranchSlug = useMemo(() => {
    const entry = Object.entries(BRANCH_LABELS).find(([,label]) => label === branch);
    return entry?.[0] || branch.toLowerCase().replace(/\s+/g,"-");
  }, [branch]);

  const promptFields = useMemo(
    () => TASK_PROMPT_FIELDS[selectedBranchSlug] || [],
    [selectedBranchSlug],
  );

  const samplePrompt = useMemo(() => {
    const lines = [useCommand, ...promptFields.map(f => `${f.label}: <${f.placeholder}>`)];
    return lines.join("\n");
  }, [useCommand, promptFields]);

  const selectedGuide = useMemo(() => {
    const brandSlug = brand.toLowerCase();
    const stored = branchGuides.find((g:any) => g.brand_slug === brandSlug && g.branch_slug === selectedBranchSlug) || null;
    return {
      ...(DEFAULT_BRANCH_HELP[selectedBranchSlug] || {
        usage_badge:"Creative DNA",
        description_vi:"Material guide cho branch này.",
        output_note:"Bám canonical Creative DNA của branch."
      }),
      ...(stored || {}),
    };
  }, [brand, branchGuides, selectedBranchSlug]);

  const selectBranch = (nextBrand: string, nextBranch: string) => {
    setBrand(nextBrand);
    setBranch(nextBranch);
    setResponseData(null);
    setResponseMeta(null);
    requestAnimationFrame(() => {
      document.getElementById("branch-preview")?.scrollIntoView({ behavior: "smooth", block: "center" });
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
                <span className="text-lg font-extrabold tracking-tight text-slate-900">UID Brands</span>
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

        <div className="grid xl:grid-cols-[0.9fr_1.1fr] gap-5 items-start">
          <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900">Chọn Brand / Branch</h2>
              </div>
              <span className="text-xs text-slate-400">{supportedBrands.length} brands</span>
            </div>

            <div className="space-y-3">
              {supportedBrands.map((b) => (
                <div key={b.name} className={`rounded-xl border p-4 transition-colors ${brand === b.name ? "border-indigo-200 bg-indigo-50/30" : "border-slate-100 bg-slate-50/60"}`}>
                  <div className="flex flex-col sm:flex-row xl:flex-col 2xl:flex-row sm:items-center xl:items-start 2xl:items-center sm:justify-between gap-1.5 mb-3">
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

          <section id="branch-preview" className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs xl:sticky xl:top-20">
            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[10px] font-extrabold uppercase tracking-wider text-indigo-700">{selectedGuide.usage_badge}</span>
                  {selectedGuide.ratio_note && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{selectedGuide.ratio_note}</span>}
                </div>
                <h3 className="text-xl font-extrabold text-slate-900">{selectedGuide.title_vi || `${brand} / ${branch}`}</h3>
                <p className="text-sm text-slate-600 leading-relaxed mt-2">{selectedGuide.description_vi}</p>
              </div>

              <div>
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center min-h-[260px]">
                  {selectedGuide.page_url && selectedGuide.css_selector ? (
                    <iframe
                      src={`/api/branch-preview?url=${encodeURIComponent(selectedGuide.page_url)}&selector=${encodeURIComponent(selectedGuide.css_selector)}`}
                      title={`${brand} ${branch} live UI preview`}
                      className="w-full h-[520px] bg-white"
                    />
                  ) : (
                    <div className="text-center px-6">
                      <Layers className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                      <div className="text-xs font-bold text-slate-500">Chưa có Live UI preview</div>
                      <div className="text-[11px] text-slate-400 mt-1">Admin lưu Page URL + CSS selector để nhúng section thật.</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Output chính</div>
                <div className="text-xs text-slate-700 mt-1">{selectedGuide.output_note}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Input thường cần</div>
                    <div className="text-[11px] text-slate-400 mt-1">Prompt mẫu để user biết task này cần đưa gì vào.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(samplePrompt,"sample-prompt")}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-bold hover:bg-slate-200"
                  >
                    {copiedKey === "sample-prompt" ? <Check className="w-3.5 h-3.5 text-emerald-600"/> : <Copy className="w-3.5 h-3.5"/>}
                    {copiedKey === "sample-prompt" ? "Đã copy" : "Copy prompt"}
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-2 mt-3">
                  {promptFields.map((field) => (
                    <div key={field.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">{field.label}</span>
                        <span className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${field.required ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                          {field.required ? "Required" : "Optional"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">{field.placeholder}</div>
                    </div>
                  ))}
                </div>

                <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-950 px-3 py-3 font-mono text-[11px] leading-relaxed text-emerald-300 overflow-x-auto">{samplePrompt}</pre>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 rounded-lg bg-slate-950 px-3 py-2.5 font-mono text-xs text-emerald-300 break-words">{useCommand}</div>
                <button onClick={() => handleCopy(useCommand,"guide-use-command")} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-bold">
                  {copiedKey === "guide-use-command" ? <Check className="w-3.5 h-3.5"/> : <Copy className="w-3.5 h-3.5"/>}
                  {copiedKey === "guide-use-command" ? "Đã copy" : "Copy"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Plug className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900">Cài Creative DNA vào ChatGPT</h2>
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Flow cài đúng theo UI ChatGPT hiện tại: bật Chế độ nhà phát triển → vào Plugin → tạo server MCP tùy chỉnh → điền thông tin Creative DNA.
              </p>

              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5 mt-4">
                {[
                  ["1", "Bật Chế độ nhà phát triển", "ChatGPT → Settings → Plugin → Chế độ nhà phát triển."],
                  ["2", "Mở trang Plugin", "Vào Plugin ở sidebar → bấm dấu + góc phải."],
                  ["3", "Tạo MCP tùy chỉnh", "Chọn “Tạo server MCP tùy chỉnh”."],
                  ["4", "Điền thông tin", "Tên: Creative DNA · URL máy chủ: MCP endpoint bên cạnh · Xác thực: Không có tính năng xác thực."],
                  ["5", "Xác nhận & Tạo", "Tick “Tôi hiểu và muốn tiếp tục” → bấm Tạo. Sau đó Creative DNA sẽ xuất hiện trong Plugin."],
                ].map(([n,title,desc])=>(
                  <div key={n} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-extrabold flex items-center justify-center">{n}</div>
                    <div className="text-xs font-bold text-slate-900 mt-2">{title}</div>
                    <div className="text-[11px] leading-relaxed text-slate-500 mt-1">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:w-[390px] shrink-0 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700">MCP endpoint</div>
              <div className="mt-2 rounded-lg bg-slate-950 px-3 py-3 font-mono text-[11px] text-emerald-300 break-all">{PRODUCTION_MCP_URL}</div>
              <button
                type="button"
                onClick={() => handleCopy(PRODUCTION_MCP_URL, "install-mcp-url")}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-bold"
              >
                {copiedKey === "install-mcp-url" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === "install-mcp-url" ? "Đã copy endpoint" : "Copy MCP endpoint"}
              </button>
              <div className="mt-3 rounded-lg border border-indigo-100 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
                <div><span className="font-bold text-slate-800">Tên:</span> Creative DNA</div>
                <div className="mt-1"><span className="font-bold text-slate-800">URL máy chủ:</span> {PRODUCTION_MCP_URL}</div>
                <div className="mt-1"><span className="font-bold text-slate-800">Xác thực:</span> Không có tính năng xác thực</div>
              </div>
            </div>
          </div>
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
