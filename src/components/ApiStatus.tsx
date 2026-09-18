import { Activity, RefreshCw, ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { HealthResponse } from "../types";

interface ApiStatusProps {
  health: HealthResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export function ApiStatus({ health, loading, onRefresh }: ApiStatusProps) {
  const isHealthy = health?.status === "ok" && health?.upstream === "connected";

  return (
    <div
      id="api-status-card"
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl shadow-xs"
    >
      <div className="flex items-center gap-3">
        <div
          className={`relative flex items-center justify-center w-8 h-8 rounded-lg border ${
            isHealthy
              ? "bg-emerald-50 border-emerald-200 text-emerald-600"
              : health
              ? "bg-amber-50 border-amber-200 text-amber-600"
              : "bg-slate-50 border-slate-200 text-slate-400"
          }`}
        >
          {isHealthy ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : health ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <Activity className="w-4 h-4 animate-pulse" />
          )}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              API Status
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
                isHealthy
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : health
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isHealthy ? "bg-emerald-500 animate-pulse" : health ? "bg-amber-500" : "bg-slate-400"
                }`}
              />
              {isHealthy ? "Upstream Connected" : health ? "Upstream Degraded" : "Checking..."}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
            <span>Source: Creative DNA Canonical Datastore</span>
            {health?.latencyMs !== undefined && (
              <>
                <span className="text-slate-300">•</span>
                <span>Latency: {health.latencyMs}ms</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded-md border border-slate-200">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
          <span>Stateless Gateway</span>
        </div>

        <button
          id="refresh-health-btn"
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors border border-transparent hover:border-slate-200 disabled:opacity-50"
          title="Refresh connection status"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-slate-800" : ""}`} />
        </button>
      </div>
    </div>
  );
}
