import { APPROVED_PRIVATE_REFERENCES, type PrivateReference } from './private-reference-catalog.ts';
import { digestReference, isReferenceMember, isVerifiedReferenceUser, readBoundedReferenceBytes, referenceBearer, type PrivateReferenceDeps } from './private-reference-access.ts';

export type PrivateIngestDeps = PrivateReferenceDeps & { upload: (reference: PrivateReference, bytes: Uint8Array) => Promise<boolean> };
/** One-time provisioning for precisely the approved seven hashes, never a general uploader. */
export function createPrivateReferenceIngestHandler(deps: PrivateIngestDeps, references: readonly PrivateReference[] = APPROVED_PRIVATE_REFERENCES) {
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID(); let actor: string | null = null, referenceId: string | null = null;
    const finish = (status: number, result: string) => {
      deps.audit({ event: 'uid_private_reference_ingest', request_id: requestId, actor_user_id: actor, reference_id: referenceId, result, status });
      return Response.json({ status: result, reference_id: referenceId, request_id: requestId }, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
    };
    if (request.method !== 'POST') return finish(405, 'POST_REQUIRED');
    const token = referenceBearer(request);
    if (!token) return finish(401, 'AUTHENTICATED_ADMIN_REQUIRED');
    try {
      const user = await deps.verifyUser(token);
      if (!isVerifiedReferenceUser(user)) return finish(401, 'AUTHENTICATED_ADMIN_REQUIRED');
      actor = user.id;
      const member = await deps.findMembership(token, user.id);
      if (!isReferenceMember(member, user.id) || member.role !== 'admin') return finish(403, 'UID_ADMIN_REQUIRED');
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some(k => k !== 'reference_id') || url.searchParams.getAll('reference_id').length !== 1) return finish(400, 'REFERENCE_ID_REQUIRED');
      const reference = references.find(r => r.id === url.searchParams.get('reference_id'));
      if (!reference) return finish(404, 'REFERENCE_NOT_FOUND');
      referenceId = reference.id;
      if (request.headers.get('Content-Type') !== reference.mime_type) return finish(415, 'EXACT_REFERENCE_MIME_REQUIRED');
      const length = request.headers.get('Content-Length');
      if (length !== null && Number(length) !== reference.byte_length) return finish(400, 'EXACT_REFERENCE_BYTES_REQUIRED');
      let bytes: Uint8Array | null;
      try { bytes = await readBoundedReferenceBytes(request.body, reference.byte_length); }
      catch { return finish(400, 'EXACT_REFERENCE_BYTES_REQUIRED'); }
      if (!bytes || bytes.byteLength !== reference.byte_length || await digestReference(bytes) !== reference.sha256) return finish(400, 'EXACT_REFERENCE_HASH_REQUIRED');
      if (!await deps.bucketIsPrivate()) return finish(503, 'PRIVATE_STORAGE_UNAVAILABLE');
      const matches = async (value: Uint8Array | null) => !!value && value.byteLength === reference.byte_length && await digestReference(value) === reference.sha256;
      const existing = await deps.download(reference);
      if (existing) return finish(await matches(existing) ? 200 : 409, await matches(existing) ? 'ALREADY_STORED' : 'IMMUTABLE_OBJECT_CONFLICT');
      // A single upload attempt only. Uncertain outcomes are resolved by a read, not a replay.
      let written = false;
      try { written = await deps.upload(reference, bytes); } catch { /* Read to establish the outcome. */ }
      const stored = await deps.download(reference);
      if (!await matches(stored)) return finish(503, 'STORAGE_WRITE_NOT_VERIFIED');
      return finish(written ? 201 : 200, written ? 'STORED_AND_VERIFIED' : 'STORED_AND_VERIFIED_AFTER_RECHECK');
    } catch { return finish(503, 'PRIVATE_REFERENCE_SERVICE_UNAVAILABLE'); }
  };
}
