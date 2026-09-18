import { useState } from "react";
import { Copy, Check, Terminal, FileCode } from "lucide-react";

interface JsonViewerProps {
  data: any;
  title?: string;
  loading?: boolean;
  meta?: {
    action: string;
    durationMs: number;
    status: number;
  } | null;
}

export function JsonViewer({ data, title = "Canonical Spec Viewer", loading = false, meta }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const formattedJson = data !== null && data !== undefined ? JSON.stringify(data, null, 2) : "";

  const handleCopy = async () => {
    if (!formattedJson) return;
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy JSON:", err);
    }
  };

  const getByteSize = (str: string) => {
    const bytes = new Blob([str]).size;
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div id="json-viewer-container" className="flex flex-col rounded-xl border border-slate-200 bg-slate-900 shadow-sm overflow-hidden text-slate-100">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2 font-mono">
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-slate-200">{title}</span>
          {meta && (
            <span className="flex items-center gap-1.5 ml-2 text-slate-400">
              <span className={`inline-block px-1.5 py-0.5 rounded font-mono font-medium ${
                meta.status >= 200 && meta.status < 300 
                  ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/60" 
                  : "bg-rose-950/80 text-rose-300 border border-rose-800/60"
              }`}>
                {meta.status}
              </span>
              <span className="text-slate-500">•</span>
              <span>{meta.durationMs}ms</span>
              <span className="text-slate-500">•</span>
              <span>{getByteSize(formattedJson)}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {formattedJson && (
            <button
              id="copy-json-button"
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors border border-slate-700 active:scale-95"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Code body */}
      <div className="relative max-h-[580px] overflow-auto p-4 font-mono text-[13px] leading-relaxed select-text bg-[#0d1117]">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400 text-center gap-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-mono text-slate-400">Fetching canonical specification from Creative DNA datastore...</p>
          </div>
        ) : formattedJson ? (
          <pre className="text-slate-300 whitespace-pre-wrap break-words font-mono">
            {formattedJson}
          </pre>
        ) : (
          <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-center">
            <FileCode className="w-8 h-8 text-slate-600 mb-2 stroke-[1.5]" />
            <p className="text-sm">No response data yet.</p>
            <p className="text-xs text-slate-600 mt-1">
              Click &quot;Resolve Creative DNA&quot; or &quot;Discover Routes&quot; to inspect live JSON payload.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
