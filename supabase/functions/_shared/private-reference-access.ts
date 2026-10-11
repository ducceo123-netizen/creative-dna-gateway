import { APPROVED_PRIVATE_REFERENCES, type PrivateReference } from './private-reference-catalog.ts';

/** A server-verified identity, never a decoded client token or supplied account name. */
export type VerifiedReferenceUser = { id: string; role?: string; is_anonymous?: boolean; email_confirmed_at?: string | null; phone_confirmed_at?: string | null };
export type ReferenceMembership = { user_id: string; role: string; is_active: boolean };
export type ReferenceAudit = { event: 'uid_private_reference_read' | 'uid_private_reference_ingest'; request_id: string; actor_user_id: string | null; reference_id: string | null; result: string; status: number };
export type PrivateReferenceDeps = {
  verifyUser: (token: string) => Promise<VerifiedReferenceUser | null>;
  findMembership: (token: string, userId: string) => Promise<ReferenceMembership | null>;
  bucketIsPrivate: () => Promise<boolean>;
  download: (reference: PrivateReference) => Promise<Uint8Array | null>;
  audit: (event: ReferenceAudit) => void;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const memberRoles = new Set(['viewer', 'contributor', 'admin']);
const baseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

export function referenceBearer(request: Request) {
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '')?.[1];
  return token && token.length <= 16384 ? token : null;
}
export function isVerifiedReferenceUser(user: VerifiedReferenceUser | null): user is VerifiedReferenceUser {
  return !!user && uuid.test(user.id) && user.role === 'authenticated' && user.is_anonymous !== true && !!(user.email_confirmed_at || user.phone_confirmed_at);
}
export function isReferenceMember(member: ReferenceMembership | null, userId: string): member is ReferenceMembership {
  return !!member && member.user_id === userId && member.is_active === true && memberRoles.has(member.role);
}
export async function readBoundedReferenceBytes(body: ReadableStream<Uint8Array> | null, limit: number) {
  const reader = body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error('Oversized object'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function digestReference(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

/** No signed URLs, client-selected paths, public fallback, uploads, or credential storage. */
export function createPrivateReferenceHandler(deps: PrivateReferenceDeps, references: readonly PrivateReference[] = APPROVED_PRIVATE_REFERENCES) {
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    let actor: string | null = null, referenceId: string | null = null;
    const finish = (status: number, result: string, body?: Uint8Array, reference?: PrivateReference) => {
      // Audit contains only bounded internal identifiers. Never headers, tokens or raw URLs.
      deps.audit({ event: 'uid_private_reference_read', request_id: requestId, actor_user_id: actor, reference_id: referenceId, result, status });
      const headers = new Headers(baseHeaders);
      headers.set('X-Request-Id', requestId);
      if (!body || !reference) {
        if (status === 401) headers.set('WWW-Authenticate', 'Bearer');
        return Response.json({ error: result, request_id: requestId }, { status, headers });
      }
      headers.set('Content-Type', reference.mime_type);
      headers.set('Content-Length', String(body.byteLength));
      headers.set('Content-Disposition', `attachment; filename="${reference.id}.${reference.mime_type === 'image/png' ? 'png' : 'webp'}"`);
      headers.set('X-Content-SHA256', reference.sha256);
      return new Response(body as BodyInit, { status, headers });
    };
    if (request.method !== 'GET') return finish(405, 'READ_ONLY_ENDPOINT');
    const token = referenceBearer(request);
    if (!token) return finish(401, 'AUTHENTICATED_MEMBER_REQUIRED');
    try {
      const user = await deps.verifyUser(token);
      if (!isVerifiedReferenceUser(user)) return finish(401, 'AUTHENTICATED_MEMBER_REQUIRED');
      actor = user.id;
      const member = await deps.findMembership(token, user.id);
      if (!isReferenceMember(member, user.id)) return finish(403, 'UID_MEMBERSHIP_REQUIRED');

      const url = new URL(request.url);
      if (!references.length) return finish(503, 'PRIVATE_CATALOG_NOT_CONFIGURED');
      if ([...url.searchParams.keys()].length === 0) {
        // Only authenticated members may discover even the filenames and integrity hashes.
        // Library IDs and bucket/object locations remain private implementation metadata.
        deps.audit({ event: 'uid_private_reference_read', request_id: requestId, actor_user_id: actor, reference_id: null, result: 'CATALOG_ALLOWED', status: 200 });
        return Response.json({ schema: 'uid-private-reference-catalog/1', references: references.map(({ id, filename, mime_type, sha256, byte_length }) => ({ id, filename, mime_type, sha256, byte_length })) }, { headers: baseHeaders });
      }
      // Tokens must stay in Authorization. Reject ambiguous query aliases and duplicate IDs.
      if ([...url.searchParams.keys()].some(k => k !== 'reference_id') || url.searchParams.getAll('reference_id').length !== 1) return finish(400, 'REFERENCE_ID_REQUIRED');
      const requestedId = url.searchParams.get('reference_id');
      const reference = references.find(r => r.id === requestedId);
      if (!reference) return finish(404, 'REFERENCE_NOT_FOUND');
      referenceId = reference.id;
      if (!await deps.bucketIsPrivate()) return finish(503, 'PRIVATE_STORAGE_UNAVAILABLE');
      const bytes = await deps.download(reference);
      if (!bytes || bytes.byteLength !== reference.byte_length || await digestReference(bytes) !== reference.sha256) return finish(503, 'REFERENCE_BYTES_UNAVAILABLE');
      return finish(200, 'ALLOWED', bytes, reference);
    } catch {
      // Do not echo upstream errors, bodies, URLs, or secrets.
      return finish(503, 'PRIVATE_REFERENCE_SERVICE_UNAVAILABLE');
    }
  };
}
