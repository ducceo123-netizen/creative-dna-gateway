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

      {/* Frequently Asked Questions */}
      <div className="space-y-4 pt-4">
        <h2 className="text-base font-semibold text-slate-900">Frequently Asked Questions</h2>
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-900">How do I invoke Creative DNA in ChatGPT?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Simply reference the brand and branch in your prompt: &quot;Creative DNA — Use: PawfectHouse / Onepage&quot;. ChatGPT will automatically query the canonical knowledge graph and use the returned guidelines.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-900">Is Creative DNA read-only?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Yes. All specifications are strictly read-only and maintained directly in the upstream Supabase knowledge base. ChatGPT cannot modify or overwrite brand rules.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-900">How can I discover all supported branches?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Ask ChatGPT: &quot;List available Creative DNA routes&quot;, or inspect the interactive Brand DNA Explorer on this app.
            </p>
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
