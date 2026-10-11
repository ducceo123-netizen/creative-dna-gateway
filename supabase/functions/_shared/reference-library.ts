import { digestReference, isReferenceMember, isVerifiedReferenceUser, readBoundedReferenceBytes, referenceBearer, type PrivateReferenceDeps } from './private-reference-access.ts';
import { decodeLibraryNotes, inspectLibraryImage, libraryId, LIBRARY_IMAGE_TYPES, LIBRARY_PAGE_SIZE, MAX_LIBRARY_IMAGE_BYTES, REFERENCE_LIBRARY_SCHEMA, type LibraryRecord, type LibraryMime } from './reference-library-contract.ts';
export type LibraryDeps = Pick<PrivateReferenceDeps, 'verifyUser' | 'findMembership' | 'bucketIsPrivate' | 'audit'> & {
  list: (offset: number) => Promise<{ references: LibraryRecord[]; next_offset: number | null }>;
  find: (id: string) => Promise<LibraryRecord | null>;
  download: (record: LibraryRecord) => Promise<Uint8Array | null>;
  upload: (record: LibraryRecord, bytes: Uint8Array) => Promise<boolean>;
};
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; sandbox" };
/** Optional inspiration, authorized by the same live membership checks on every request. */
export function createReferenceLibraryHandler(deps: LibraryDeps, write = false) {
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID(); let actor: string | null = null, referenceId: string | null = null;
    const finish = (status: number, result: string, extra: Record<string, unknown> = {}) => {
      deps.audit({ event: write ? 'uid_private_reference_ingest' : 'uid_private_reference_read', request_id: requestId, actor_user_id: actor, reference_id: referenceId, result, status });
      return Response.json({ status: result, reference_id: referenceId, request_id: requestId, ...extra }, { status, headers });
    };
    if (request.method !== (write ? 'POST' : 'GET')) return finish(405, 'METHOD_NOT_ALLOWED');
    const token = referenceBearer(request);
    if (!token) return finish(401, 'AUTHENTICATED_UID_SESSION_REQUIRED');
    try {
      const user = await deps.verifyUser(token);
      if (!isVerifiedReferenceUser(user)) return finish(401, 'AUTHENTICATED_UID_SESSION_REQUIRED');
      actor = user.id;
      const member = await deps.findMembership(token, user.id);
      if (!isReferenceMember(member, user.id) || (write && member.role !== 'admin')) return finish(403, write ? 'UID_ADMIN_REQUIRED' : 'UID_MEMBERSHIP_REQUIRED');
      const url = new URL(request.url), keys = [...url.searchParams.keys()];
      const id = url.searchParams.get('reference_id');
      if (id !== null) {
        if (keys.length !== 1 || !libraryId(id)) return finish(400, 'INVALID_REFERENCE_ID');
        referenceId = id;
      } else if (write || keys.some(k => k !== 'offset') || keys.length > 1 || (keys.length && !/^(0|[1-9]\d{0,6})$/.test(url.searchParams.get('offset') || ''))) return finish(400, 'INVALID_LIBRARY_QUERY');
      if (!await deps.bucketIsPrivate()) return finish(503, 'PRIVATE_STORAGE_UNAVAILABLE');
      if (!write && !id) {
        const offset = Number(url.searchParams.get('offset') || 0);
        if (offset > 1000000) return finish(400, 'INVALID_LIBRARY_QUERY');
        const page = await deps.list(offset);
        return finish(200, 'LIBRARY_AVAILABLE', { schema: REFERENCE_LIBRARY_SCHEMA, references: page.references, next_offset: page.next_offset, can_upload: member.role === 'admin' });
      }
      if (write) {
        const mime = request.headers.get('Content-Type') || '';
        if (!LIBRARY_IMAGE_TYPES.includes(mime as LibraryMime)) return finish(415, 'RASTER_IMAGE_REQUIRED');
        const length = request.headers.get('Content-Length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) < 1 || Number(length) > MAX_LIBRARY_IMAGE_BYTES)) return finish(413, 'REFERENCE_SIZE_EXCEEDED');
        let notes, bytes: Uint8Array | null, dimensions;
        try { notes = decodeLibraryNotes(request.headers.get('X-Reference-Metadata')); bytes = await readBoundedReferenceBytes(request.body, MAX_LIBRARY_IMAGE_BYTES); dimensions = inspectLibraryImage(bytes || new Uint8Array(), mime); }
        catch { return finish(400, 'INVALID_REFERENCE_IMAGE_OR_NOTES'); }
        if (!bytes) return finish(400, 'INVALID_REFERENCE_IMAGE_OR_NOTES');
        const record: LibraryRecord = { ...notes, id: id!, mime_type: mime as LibraryMime, sha256: await digestReference(bytes), byte_length: bytes.length, ...dimensions, created_at: new Date().toISOString() };
        const same = (stored: LibraryRecord) => Object.keys(record).every(key => key === 'created_at' || (stored as any)[key] === (record as any)[key]);
        const verified = async (stored: LibraryRecord | null) => {
          if (!stored || !same(stored)) return false;
          const downloaded = await deps.download(stored);
          return !!downloaded && downloaded.length === stored.byte_length && await digestReference(downloaded) === stored.sha256;
        };
        const existing = await deps.find(id!);
        if (existing) { const matches = await verified(existing); return finish(matches ? 200 : 409, matches ? 'ALREADY_STORED' : 'IMMUTABLE_REFERENCE_CONFLICT'); }
        // One immutable object stores both the image and its notes. No partial sidecar writes.
        let written = false;
        try { written = await deps.upload(record, bytes); } catch { /* Establish outcome by reading; never replay a mutation here. */ }
        if (!await verified(await deps.find(id!))) return finish(503, 'STORAGE_WRITE_NOT_VERIFIED');
        return finish(written ? 201 : 200, 'STORED_AND_VERIFIED');
      }
      const record = await deps.find(id!);
      if (!record) return finish(404, 'REFERENCE_NOT_FOUND');
      const bytes = await deps.download(record);
      if (!bytes || bytes.length !== record.byte_length || await digestReference(bytes) !== record.sha256) return finish(503, 'REFERENCE_BYTES_UNAVAILABLE');
      inspectLibraryImage(bytes, record.mime_type);
      deps.audit({ event: 'uid_private_reference_read', request_id: requestId, actor_user_id: actor, reference_id: referenceId, result: 'ALLOWED', status: 200 });
      const extension = record.mime_type === 'image/jpeg' ? 'jpg' : record.mime_type === 'image/png' ? 'png' : 'webp';
      return new Response(bytes as BodyInit, { headers: { ...headers, 'Content-Type': record.mime_type, 'Content-Length': String(bytes.length), 'X-Content-SHA256': record.sha256, 'Content-Disposition': `attachment; filename="${record.id}.${extension}"` } });
    } catch { return finish(503, 'PRIVATE_REFERENCE_SERVICE_UNAVAILABLE'); }
  };
}
