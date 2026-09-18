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
            1. Acceptance of Terms & App Purpose
          </h2>
          <p>
            By connecting to, prompting, querying, or calling the Creative DNA ChatGPT App or Model Context Protocol endpoint (<code>https://creative-dna-gateway.vercel.app/api/mcp</code>), you agree to these Terms of Service.
            Creative DNA connects ChatGPT and AI agents to live, structured creative guidelines, design systems, and production rules for ecommerce brands.
            If you do not agree to these terms, do not use the Creative DNA tools or endpoints.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            2. Scope of Service & Strictly Read-Only Nature
          </h2>
          <p>
            Creative DNA operates strictly as a <strong>read-only</strong> informational retrieval gateway.
            The service retrieves canonical brand guidelines, typography scales, layout hierarchy, and copy rules from an authoritative upstream datastore.
            The system provides no capability to create, update, delete, approve, seed, or mutate Creative DNA specifications.
            Attempting to submit write mutations, bypass rate limits, probe private datastore endpoints, or perform automated denial-of-service traffic is strictly prohibited.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-600" />
            3. Acceptable Use & Permitted Creative Tasks
          </h2>
          <p>
            Specifications resolved through Creative DNA are intended for:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Generating ecommerce landing page copy, hero banners, and promotional campaigns in accordance with brand rules.</li>
            <li>Aligning UGC creators, marketing teams, and creative directors to canonical brand specifications.</li>
            <li>Structuring product detail pages, lifestyle photography briefs, and conversion funnel components.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">4. User Responsibility for Creative & Product Decisions</h2>
          <p>
            While Creative DNA provides structured brand guidelines, <strong>users remain solely responsible for all final creative, advertising, legal, and product decisions</strong>.
            You must independently review and verify any copy, visual assets, claims, regulatory compliance, and commercial materials generated with the assistance of Creative DNA prior to public distribution or commercial use.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">5. Intellectual Property Notice</h2>
          <p>
            All brand trademarks, trade names, logos, design assets, and proprietary specifications for <strong>PawfectHouse</strong>, <strong>GiftSoul</strong>, and <strong>SoulPrise</strong> remain the exclusive property of their respective trademark and brand owners.
            Access granted via this gateway provides a limited, non-exclusive reference license solely to guide creative production and does not transfer intellectual property rights or ownership of underlying brand assets.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">6. Service Availability & Disclaimer of Warranties</h2>
          <p>
            The Creative DNA gateway is provided on an &quot;as is&quot; and &quot;as available&quot; basis without warranties of any kind, whether express or implied.
            We do not guarantee that every Creative DNA specification is exhaustive, uninterrupted, error-free, or suitable for every commercial use case.
            Service availability may be subject to network latency, upstream datastore maintenance, or hosting provider downtime.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">7. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, Creative DNA and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, goodwill, or business interruption arising out of or in connection with the use or inability to use the gateway or specifications.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">8. Modifications to Service & Terms</h2>
          <p>
            We reserve the right to expand available brand routes, update specifications in accordance with brand redesigns, or refine API schemas to maintain compliance with OpenAI Apps SDK standards. Material revisions to these Terms will be reflected with an updated effective date.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">9. Contact & Support</h2>
          <p>
            For questions regarding these Terms or to report technical issues, please contact our support team at:
            <br />
            <a href="mailto:support@creative-dna-gateway.vercel.app" className="text-indigo-600 hover:text-indigo-800 font-medium">
              support@creative-dna-gateway.vercel.app
            </a>
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
