import { PRIVATE_REFERENCE_BUCKET } from './private-reference-catalog.ts';
import { readBoundedReferenceBytes } from './private-reference-access.ts';
import { privateReferenceRuntime, type ReferenceRuntimeConfig } from './private-reference-runtime.ts';
import { libraryId, LIBRARY_PAGE_SIZE, MAX_LIBRARY_IMAGE_BYTES, parseLibraryRecord, type LibraryRecord } from './reference-library-contract.ts';
import type { LibraryDeps } from './reference-library.ts';
const prefix = 'library/v1/';
/** Reuses existing secrets and bucket. No new credentials, policies, schema or audience. */
export function referenceLibraryRuntime(config: ReferenceRuntimeConfig, fetcher: typeof fetch = fetch): LibraryDeps {
  const auth = privateReferenceRuntime(config, fetcher);
  const serviceHeaders: Record<string, string> = { apikey: config.serviceKey };
  if (!config.serviceKey.startsWith('sb_secret_')) serviceHeaders.Authorization = `Bearer ${config.serviceKey}`;
  const path = (id: string) => { if (!libraryId(id)) throw new Error('Invalid reference'); return PRIVATE_REFERENCE_BUCKET + '/' + prefix + id; };
  const call = (route: string, init: RequestInit = {}) => fetcher(config.supabaseUrl + '/storage/v1/' + route, { ...init, headers: { ...serviceHeaders, ...init.headers }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const json = async (response: Response, limit = 16384) => {
    if (!response.ok) throw new Error('Storage unavailable');
    const bytes = await readBoundedReferenceBytes(response.body, limit);
    if (!bytes) throw new Error('Storage unavailable');
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const find = async (id: string): Promise<LibraryRecord | null> => {
    const response = await call('object/info/' + path(id));
    if (response.status === 404) return null;
    // Supabase may return 400 with a structured 404 for a missing object.
    if (response.status === 400) {
      const bytes = await readBoundedReferenceBytes(response.body, 2048);
      const error = JSON.parse(new TextDecoder().decode(bytes || new Uint8Array()));
      if (String(error.statusCode) === '404' || error.error === 'not_found') return null;
      throw new Error('Storage unavailable');
    }
    const info = await json(response), record = parseLibraryRecord(info.metadata);
    if (info.name !== prefix + id || info.bucket_id !== PRIVATE_REFERENCE_BUCKET || record.id !== id || info.size !== record.byte_length || info.content_type !== record.mime_type) throw new Error('Invalid stored reference');
    return record;
  };
  return {
    verifyUser: auth.verifyUser, findMembership: auth.findMembership, bucketIsPrivate: auth.bucketIsPrivate, audit: auth.audit,
    find,
    async list(offset) {
      const data = await json(await call('object/list/' + PRIVATE_REFERENCE_BUCKET, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: prefix.slice(0,-1), limit: LIBRARY_PAGE_SIZE + 1, offset, sortBy: { column: 'created_at', order: 'desc' } }) }), 131072);
      if (!Array.isArray(data) || data.length > LIBRARY_PAGE_SIZE + 1 || data.some(row => !libraryId(row.name))) throw new Error('Invalid library listing');
      const references: LibraryRecord[] = [];
      // Bound concurrent metadata reads; never expose provider paths or metadata wholesale.
      for (let index = 0; index < Math.min(data.length, LIBRARY_PAGE_SIZE); index += 4) {
        const batch = await Promise.all(data.slice(index, Math.min(index + 4, LIBRARY_PAGE_SIZE)).map(row => find(row.name)));
        references.push(...batch.filter((record): record is LibraryRecord => !!record));
      }
      return { references, next_offset: data.length > LIBRARY_PAGE_SIZE ? offset + LIBRARY_PAGE_SIZE : null };
    },
    async download(record) {
      const response = await call('object/' + path(record.id));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Storage unavailable');
      const length = response.headers.get('Content-Length');
      if (length !== null && Number(length) !== record.byte_length) throw new Error('Invalid stored length');
      return readBoundedReferenceBytes(response.body, Math.min(MAX_LIBRARY_IMAGE_BYTES, record.byte_length));
    },
    async upload(record, bytes) {
      const metadata = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(parseLibraryRecord(record)))));
      const response = await call('object/' + path(record.id), { method: 'POST', headers: { 'Content-Type': record.mime_type, 'Cache-Control': 'max-age=0', 'x-upsert': 'false', 'x-metadata': metadata }, body: bytes as BodyInit });
      return response.ok;
    },
  };
}
