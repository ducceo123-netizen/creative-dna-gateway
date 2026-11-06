import { TRUSTPILOT_VERSION, trustpilotProfile } from '../../supabase/functions/_shared/trustpilot-research.ts';

/** Synthetic offline fixture only. Never a live source receipt or production research. */
export function blockedTrustpilotFixture(source_url: string, product_ids: string[], brand = 'pawfecthouse') {
  const profile_url = trustpilotProfile(brand);
  return {
    schema_version: TRUSTPILOT_VERSION, scope: { source_url, profile_url, product_ids: [...product_ids] },
    attempts: [{ id: 'test-attempt', profile_url, product_ids: [...product_ids], queries: ['Synthetic selected product research query'], tool: 'offline-test-only', observed_at: '2026-10-20T00:00:00Z', status: 'blocked', selection: 'Synthetic blocked outcome, not an actual access report.', sort_order: 'unknown', filters: [], reviews_inspected: 0, limitations: ['Offline fixture simulates inaccessible source; no review text or findings are invented.'] }],
    observations: [], insights: [],
  };
}
