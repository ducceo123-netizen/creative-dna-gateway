import { PRIVATE_REFERENCE_BUCKET, type PrivateReference } from './private-reference-catalog.ts';
import { readBoundedReferenceBytes, type PrivateReferenceDeps, type ReferenceMembership, type VerifiedReferenceUser } from './private-reference-access.ts';

export type ReferenceRuntimeConfig = { supabaseUrl: string; publishableKey: string; serviceKey: string };
/** Existing server-only credentials are confined to this project's fixed API origin. */
export function privateReferenceRuntime(config: ReferenceRuntimeConfig, fetcher: typeof fetch = fetch): PrivateReferenceDeps {
  if (config.supabaseUrl !== 'https://wuonwttmkadwsmefjukv.supabase.co' || !config.publishableKey || !config.serviceKey) throw new Error('Reference runtime unavailable');
  const url = config.supabaseUrl;
  const userHeaders = (token: string) => ({ apikey: config.publishableKey, Authorization: `Bearer ${token}` });
  const serviceHeaders: Record<string, string> = { apikey: config.serviceKey };
  // Modern secret keys are not JWTs. Only the legacy service-role JWT is a bearer token.
  if (!config.serviceKey.startsWith('sb_secret_')) serviceHeaders.Authorization = `Bearer ${config.serviceKey}`;
  const request = (path: string, headers: Record<string, string>) => fetcher(url + path, { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  return {
    async verifyUser(token) {
      const response = await request('/auth/v1/user', userHeaders(token));
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new Error('Auth unavailable');
      return await response.json() as VerifiedReferenceUser;
    },
    async findMembership(token, userId) {
      // Use the requesting user's existing self-read RLS policy, not service-role access.
      const response = await request('/rest/v1/creative_dna_team_members?select=user_id,role,is_active&user_id=eq.' + encodeURIComponent(userId) + '&limit=2', userHeaders(token));
      if (!response.ok) throw new Error('Membership unavailable');
      const rows: unknown = await response.json();
      return Array.isArray(rows) && rows.length === 1 ? rows[0] as ReferenceMembership : null;
    },
    async bucketIsPrivate() {
      const response = await request('/storage/v1/bucket/' + PRIVATE_REFERENCE_BUCKET, serviceHeaders);
      if (!response.ok) throw new Error('Storage unavailable');
      const bucket = await response.json();
      return bucket.id === PRIVATE_REFERENCE_BUCKET && bucket.public === false;
    },
    async download(reference: PrivateReference) {
      // Path is sourced exclusively from the immutable server allowlist.
      const response = await request('/storage/v1/object/' + PRIVATE_REFERENCE_BUCKET + '/' + reference.object_path, serviceHeaders);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Storage unavailable');
      const length = response.headers.get('Content-Length');
      if (length !== null && Number(length) !== reference.byte_length) throw new Error('Unexpected object length');
      // Bound the reader even if the service omits or lies about Content-Length.
      return readBoundedReferenceBytes(response.body, reference.byte_length);
    },
    audit(event) { console.info(JSON.stringify(event)); },
  };
}

/** Used only by the separate active-admin, exact-hash ingestion boundary. No upserts. */
export function privateReferenceUploader(config: ReferenceRuntimeConfig, fetcher: typeof fetch = fetch) {
  // Reuse strict fixed-project validation; no client controls destinations or credentials.
  privateReferenceRuntime(config, fetcher);
  return async (reference: PrivateReference, bytes: Uint8Array) => {
    const headers: Record<string, string> = { apikey: config.serviceKey, 'Content-Type': reference.mime_type, 'Cache-Control': 'private, no-store', 'x-upsert': 'false' };
    if (!config.serviceKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${config.serviceKey}`;
    const response = await fetcher(config.supabaseUrl + '/storage/v1/object/' + PRIVATE_REFERENCE_BUCKET + '/' + reference.object_path, {
      method: 'POST', headers, body: bytes as BodyInit, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    return response.ok;
  };
}
