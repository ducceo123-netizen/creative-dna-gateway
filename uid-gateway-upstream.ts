import { randomUUID } from "node:crypto";

/** Server-only transport. Deadline covers headers AND body, even if a transport ignores abort. */
export type GatewayBudget = { requestId: string; startedAt: number; deadline: number };
export const GATEWAY_TIMEOUTS = { routes: 8_000, resolve: 18_000, compile: 25_000, train: 25_000 } as const;
export function gatewayBudget(totalMs: number): GatewayBudget {
  const startedAt = Date.now();
  return { requestId: randomUUID(), startedAt, deadline: startedAt + totalMs };
}
export function gatewayFailure(budget: GatewayBudget, operation: string, code: string, status: number, readOnly: boolean, retryAfterMs?: number) {
  return { ok: false, status, data: {
    error: readOnly ? "The service could not complete this request. Your input is unchanged." : "The submission outcome is not confirmed. Check the Pending queue before submitting again.",
    code, request_id: budget.requestId, operation, elapsed_ms: Math.max(0, Date.now() - budget.startedAt),
    recovery: { retryable: readOnly, outcome: readOnly ? "not_completed" : "unknown", action: readOnly ? "retry_read" : "verify_before_retry", ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {}) },
  } };
}
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}
export async function gatewayJson(url: string, init: RequestInit, options: {
  operation: string; timeoutMs: number; readOnly?: boolean; budget?: GatewayBudget; maxAttempts?: number;
}): Promise<{ ok: boolean; status: number; data: any }> {
  const budget = options.budget || gatewayBudget(options.timeoutMs);
  const readOnly = options.readOnly === true;
  // Mutations are always sent at most once, regardless of caller retry settings.
  const attempts = readOnly ? Math.max(1, Math.min(2, options.maxAttempts ?? 2)) : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const remaining = Math.min(options.timeoutMs, budget.deadline - Date.now());
    if (remaining <= 0) return gatewayFailure(budget, options.operation, "UPSTREAM_TIMEOUT", 504, readOnly);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let response: Response | undefined;
    let timedOut = false;
    try {
      const result = await Promise.race([
        (async () => {
          response = await fetch(url, { ...init, signal: controller.signal, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), "X-Request-ID": budget.requestId } });
          let data: any;
          try { data = await response.json(); }
          catch (error) { if (response.ok || !(error instanceof SyntaxError)) throw error; data = null; }
          const payloadError = response.ok && data && typeof data === "object" && (data.error || data.ok === false);
          return { ok: response.ok && !payloadError, status: payloadError ? 502 : response.status, data };
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("deadline")); }, remaining); }),
      ]);
      clearTimeout(timer!);
      if (result.ok) return result;
      const retryAfterMs = parseRetryAfter(response?.headers.get("retry-after") || null);
      // A successful HTTP response with a business/quality rejection is not a transient outage.
      if (readOnly && response && !response.ok && attempt + 1 < attempts && [429, 502, 503, 504].includes(result.status)) {
        const delay = retryAfterMs ?? 150;
        if (Date.now() + delay + 50 < budget.deadline) { await new Promise(r => setTimeout(r, delay)); continue; }
      }
      const failure = gatewayFailure(budget, options.operation, result.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_HTTP_ERROR", result.status, readOnly, retryAfterMs);
      // Preserve existing structured quality/evidence diagnostics. Never expose arbitrary upstream errors.
      for (const key of ["quality_gate", "research_validation", "readiness", "issues", "retry_guidance"]) {
        if (result.data && typeof result.data === "object" && key in result.data) (failure.data as Record<string, unknown>)[key] = result.data[key];
      }
      return failure;
    } catch (error) {
      const retryAfterMs = parseRetryAfter(response?.headers.get("retry-after") || null);
      return gatewayFailure(budget, options.operation, timedOut ? "UPSTREAM_TIMEOUT" : response ? "UPSTREAM_INVALID_RESPONSE" : "UPSTREAM_UNAVAILABLE", timedOut ? 504 : 502, readOnly, retryAfterMs);
    } finally { clearTimeout(timer!); }
  }
  return gatewayFailure(budget, options.operation, "UPSTREAM_UNAVAILABLE", 502, readOnly);
}
