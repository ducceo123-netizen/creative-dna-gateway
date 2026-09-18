import { useState } from "react";
import { ArrowLeft, Mail, ExternalLink, Terminal, HelpCircle, Check, Copy } from "lucide-react";

interface SupportPageProps {
  onBack: () => void;
}

export function SupportPage({ onBack }: SupportPageProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-4 sm:px-6 space-y-8 animate-in fade-in duration-200">
      <div className="flex items-center justify-between pb-6 border-b border-slate-200">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors mb-3 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to App</span>
          </button>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Support & Contact</h1>
          <p className="text-sm text-slate-500 mt-1">Technical assistance, brand onboarding, and ChatGPT App integration support.</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
          <HelpCircle className="w-4 h-4" />
          <span>Developer & User Support</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Contact Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Direct Email Support</h2>
              <p className="text-xs text-slate-500">Reach the engineering & brand compliance team</p>
            </div>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Have questions about integrating Creative DNA with your custom GPT, reporting an edge case, or requesting a brand addition?
          </p>
          <div className="pt-2">
            <a
              href="mailto:support@creative-dna-gateway.vercel.app"
              className="inline-flex items-center justify-between w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 transition-colors"
            >
              <span>support@creative-dna-gateway.vercel.app</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          </div>
        </div>

        {/* MCP Endpoint Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Production MCP Endpoint</h2>
              <p className="text-xs text-slate-500">For Cursor, Claude Desktop, or OpenAI Apps SDK</p>
            </div>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Use the Streamable HTTP endpoint directly in your MCP client configuration:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-slate-900 text-emerald-400 text-xs font-mono rounded-lg overflow-x-auto truncate">
              https://creative-dna-gateway.vercel.app/api/mcp
            </code>
            <button
              type="button"
              onClick={() => copyText("https://creative-dna-gateway.vercel.app/api/mcp", "mcp-url")}
              className="p-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-slate-600 transition-colors"
              title="Copy URL"
            >
              {copied === "mcp-url" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Frequently Asked Questions & Operational Guidance */}
      <div className="space-y-4 pt-4">
        <h2 className="text-base font-semibold text-slate-900">Support, Troubleshooting & FAQ</h2>
        <div className="grid grid-cols-1 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">What does Creative DNA do?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Creative DNA connects ChatGPT to a live, structured creative knowledge system for ecommerce brands. It provides canonical brand direction, typography rules, landing-page systems, hero and banner specifications, product imagery rules, UGC direction, and brand-specific production constraints.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Which brands are currently supported?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Currently supported brands with full canonical creative systems include:
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-md text-xs font-medium">PawfectHouse</span>
              <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-md text-xs font-medium">GiftSoul</span>
              <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-md text-xs font-medium">SoulPrise</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Basic Usage Examples in ChatGPT</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              You can invoke Creative DNA naturally in your prompts:
            </p>
            <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
              <li><code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono">Creative DNA — Use: PawfectHouse / Onepage</code> to write an above-the-fold landing page layout.</li>
              <li><code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono">Check Creative DNA rules for PawfectHouse LDP Hero section.</code></li>
              <li><code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono">List available Creative DNA routes.</code> to discover all registered branches.</li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Is Creative DNA strictly read-only?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Yes. All specifications are strictly read-only reference data stored in an authoritative canonical datastore. The application does not support, expose, or perform database writes, mutations, or generative alterations of brand guidelines.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Troubleshooting & Resolution</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              If ChatGPT cannot locate a brand or branch:
            </p>
            <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
              <li>Call <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">list_creative_dna_routes</code> to inspect valid branch keys.</li>
              <li>Common aliases are automatically handled (e.g. &quot;Onepage&quot; maps to &quot;onepage-system&quot;, &quot;LDP Hero&quot; maps to &quot;ldp-hero&quot;).</li>
              <li>If you encounter a rate limit response (HTTP 429), pause for a few seconds before retrying.</li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Reporting Incorrect Resolutions or Security Issues</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              - <strong>Incorrect Resolution:</strong> If a route resolves unexpected specifications, please send the requested brand/branch name and expected behavior to our support contact below.
              <br />
              - <strong>Security & Privacy Inquiries:</strong> If you identify potential vulnerabilities or privacy concerns, please report them directly to our designated support channel.
            </p>
            <div className="pt-1">
              <span className="text-xs text-slate-700 font-semibold">Designated Support Contact: </span>
              <a href="mailto:support@creative-dna-gateway.vercel.app" className="text-indigo-600 hover:text-indigo-800 text-xs font-mono font-medium">
                support@creative-dna-gateway.vercel.app
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
        >
          Return to Creative DNA
        </button>
      </div>
    </div>
  );
}
