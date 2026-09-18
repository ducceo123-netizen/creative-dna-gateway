import { ArrowLeft, ShieldCheck, Lock, EyeOff, Server, Database } from "lucide-react";

interface PrivacyPolicyProps {
  onBack: () => void;
}

export function PrivacyPolicy({ onBack }: PrivacyPolicyProps) {
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
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Privacy Policy</h1>
          <p className="text-sm text-slate-500 mt-1">Creative DNA for ChatGPT & OpenAI Apps SDK &bull; Last updated: September 18, 2026</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
          <ShieldCheck className="w-4 h-4" />
          <span>Strict Read-Only Privacy</span>
        </div>
      </div>

      <div className="prose prose-slate max-w-none text-slate-700 text-sm leading-relaxed space-y-6">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-indigo-600" />
            1. Overview & Read-Only Information Retrieval
          </h2>
          <p>
            Creative DNA is a dedicated, read-only information retrieval application built for ChatGPT, the OpenAI Apps SDK, and AI agents.
            The app retrieves structured, canonical Creative DNA specifications for ecommerce brands.
            Our service is strictly <strong>read-only</strong>. It does not possess any ability to create, alter, overwrite, seed, or modify the Creative DNA database or upstream specifications.
            Creative DNA does not sell, rent, monetize, or trade user data to any third parties.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <EyeOff className="w-4 h-4 text-indigo-600" />
            2. Strict Data Minimization & Sensitive Data Exclusion
          </h2>
          <p>
            Creative DNA is engineered with strict data minimization principles:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>No Passwords or Financial Data:</strong> We do not request, process, or store account passwords, credit card numbers, payment credentials, bank account info, or financial data.</li>
            <li><strong>No Health or Sensitive Personal Data:</strong> We do not collect health data, biometric records, government IDs, or sensitive personal demographic categories.</li>
            <li><strong>No User Chat Logs:</strong> Conversations between end users and ChatGPT are never harvested, recorded, or used for model training by our gateway.</li>
            <li><strong>No Behavioral Tracking:</strong> The gateway does not deploy advertising trackers, tracking pixels, or cross-site behavioral telemetry.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-600" />
            3. Request Processing & Purpose Limitation
          </h2>
          <p>
            When ChatGPT or an AI client issues a call to our Model Context Protocol endpoint (<code>POST /api/mcp</code>) or resolver endpoint (<code>POST /api/resolve</code>), the payload contains only the requested brand identifier (e.g. <code>PawfectHouse</code>) and the branch or module name (e.g. <code>Onepage</code>).
          </p>
          <p>
            These user-provided brand and branch parameters are processed by the backend <strong>solely to resolve and return the requested Creative DNA specification</strong>. They are not repurposed for user profiling or advertising.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-600" />
            4. Infrastructure, Operational Logs & Data Retention
          </h2>
          <p>
            The Creative DNA Gateway operates on Vercel-hosted serverless cloud infrastructure and queries an isolated, private canonical datastore.
          </p>
          <p>
            <strong>Operational Logging:</strong> In accordance with standard web infrastructure operations, transient operational logs (such as request timestamps, HTTP status codes, response latencies, and client IP addresses) may be generated and retained by our hosting providers (Vercel and cloud network providers) solely as required for operational reliability, DDoS prevention, rate-limiting enforcement, and security auditing.
          </p>
          <p>
            <strong>Conservative Retention:</strong> We do not maintain long-term databases of user identities. Ephemeral operational log records are maintained only for the operational lifespan established by cloud platform security standards and are rotated automatically.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">5. OpenAI Apps SDK & Platform Compliance</h2>
          <p>
            Creative DNA operates in full compliance with the OpenAI Developer Policies and ChatGPT App Directory standards. The application was built for ChatGPT using the Apps SDK and Model Context Protocol, operating exclusively on public brand design rules with explicit read-only tool hints.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">6. Contact & Privacy Inquiries</h2>
          <p>
            If you have questions, concerns, or requests regarding this Privacy Policy or data processing practices, please contact our privacy and engineering point of contact:
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
