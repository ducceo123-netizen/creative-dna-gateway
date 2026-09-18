import { ArrowLeft, BookOpen, Scale, FileText, CheckCircle2 } from "lucide-react";

interface TermsOfServiceProps {
  onBack: () => void;
}

export function TermsOfService({ onBack }: TermsOfServiceProps) {
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
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Terms of Service</h1>
          <p className="text-sm text-slate-500 mt-1">Creative DNA for ChatGPT &bull; Effective Date: September 18, 2026</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium">
          <Scale className="w-4 h-4 text-slate-600" />
          <span>Usage Guidelines</span>
        </div>
      </div>

      <div className="prose prose-slate max-w-none text-slate-700 text-sm leading-relaxed space-y-6">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            1. Acceptance of Terms
          </h2>
          <p>
            By connecting to, prompting, or calling the Creative DNA ChatGPT App or Model Context Protocol endpoint (<code>https://creative-dna-gateway.vercel.app/api/mcp</code>), you agree to be bound by these Terms of Service.
            If you do not agree to these terms, do not use the Creative DNA tools.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            2. Scope of Service & Read-Only Nature
          </h2>
          <p>
            Creative DNA provides canonical brand creative direction, typography systems, layout structures, and production rules for ecommerce creative generation.
            The service is provided strictly as a read-only reference knowledge base.
            You may not attempt to inject write requests, mutate upstream specifications, or bypass rate limits.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-600" />
            3. Permitted Creative Use
          </h2>
          <p>
            Creative specifications resolved through Creative DNA are intended for:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Generating ecommerce landing page copy, hero banners, and promotional content.</li>
            <li>Aligning UGC creators, marketing teams, and design production to brand standards.</li>
            <li>Structuring product descriptions, lifestyle imagery briefs, and onepage sales funnels.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">4. Intellectual Property & Brand Ownership</h2>
          <p>
            All brand trademarks, logos, and Creative DNA specifications for <strong>PawfectHouse</strong>, <strong>GiftSoul</strong>, and <strong>SoulPrise</strong> remain the exclusive property of their respective brand owners.
            Access granted via this gateway does not confer ownership of the underlying brand assets.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">5. Disclaimer of Warranties</h2>
          <p>
            The Creative DNA gateway is provided &quot;as is&quot; without warranties of any kind. While we strive for continuous availability and accurate canonical synchronization with Supabase, we do not guarantee uninterrupted uptime.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">6. Modifications to Service</h2>
          <p>
            We reserve the right to expand available brand routes, update specifications in accordance with brand redesigns, or refine API schemas to maintain compliance with OpenAI Apps SDK standards.
          </p>
        </section>
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
