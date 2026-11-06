# Workspace private reference and artifact custody

Local implementation only. No cloud bucket, key, token, permission, schema, row, object, deployment or account was created or changed. Production remains disabled until an approved composition root injects real reviewed storage and authentication. These checks establish byte custody, not source truth, pixel inspection, visual/artistic quality or EO.

## Integration contract

`WorkspaceArtifactService(store, objectStore, { spool? })` is injected as the API artifact capability. All methods take a server-verified owner, exact task, and optionally `{ accessToken }` for private Supabase requests. A client never chooses a storage key, bucket, URL or credential. Never persist, log or return the token context.

- `reserveUpload(ownerId, taskId, input)` returns `{ upload, duplicate }`.
- `putUpload(ownerId, taskId, uploadId, AsyncIterable<Uint8Array>, context?)` returns the same safe envelope after durable object readback and link, or a typed error.
- `resolveUpload(ownerId, taskId, idempotencyKey)` recovers a lost reservation response by pure owner-store lookup, without object access.
- `getUpload(...)` only reads status. `reconcileUpload(..., context?)` reads the exact immutable object and can finish a previously ambiguous link without reuploading.
- `removeReference(ownerId, taskId, referenceId, { expected_state_version, content_revision })` performs a recoverable metadata unlink. Bytes/history remain. Evidence already used by an action cannot be removed.
- `openReference(..., context?)` and `openArtifact(..., context?)` return `{ stream, filename, media_type, size_bytes, sha256, dispose }` only after all object bytes have been checked. The caller sends private no-store/nosniff/attachment/sandbox headers, then pipes the stream and always calls `dispose`, including disconnects. No public/signed object URL is returned.

Suggested routes are under `/api/workspace/tasks/:taskId`:

1. `POST /uploads` with strict JSON input below.
2. `PUT /uploads/:uploadId`, `Content-Type: application/octet-stream`, raw bytes, authenticated and same-origin checked **before body consumption**. Do not route through a JSON/base64 parser. Content-length, if present, must match the reservation, but actual count/hash are checked regardless.
3. `GET /uploads/:uploadId` for authenticated exact-object reconciliation. This never submits another upload.
4. `GET /references/:referenceId` for private attachment bytes; `DELETE` with version/revision JSON for recoverable unlink.
5. Existing `GET /artifacts/:artifactId` delegates to verified streaming.

Strict reservation payload:

- `idempotency_key`: 8–128 ASCII letters/digits/colon/underscore/hyphen.
- `expected_state_version`, `content_revision`: exact current scope.
- `filename`: 1–180 ASCII characters, starts alphanumeric, remainder alphanumeric/dot/underscore/hyphen; no path, trailing dot or Windows device basename. The UI may normalize a display filename without altering bytes.
- `media_type`: `image/png`, `image/jpeg`, `image/webp` only.
- `size_bytes`: positive integer, at most 8 MiB; `sha256`: lowercase 64-character SHA256.
- `role`: `product`, `style`, `brand`, or `other`; optional `note`, at most 2,000 characters.
- `purpose`: `brief` (default) or `feedback`. Feedback optionally includes `review_index_id` and must match the current manifest when one exists.

The initial status is `reserved`. Only that status accepts bytes. Then `receiving`, `stored`, `linked`, `rejected`, `unknown`, `orphaned`, or `cleaned`. Repeated successful PUT returns its prior immutable result without consuming bytes again. An already rejected intent needs a fresh idempotency key. Never retry an ambiguous PUT: reconcile the exact upload. An absent object after timeout remains unknown because the remote operation may still complete. No background retry loop or fake completion is present.

## Revision and evidence boundary

Brief references are accepted only in an idle draft. They cannot silently amend the original brief after execution starts. Feedback references are accepted at idle `content_review`, `review`, or `completed` gates, with current content/state and review index. No upload is accepted while actions are queued/running/unknown or a revision plan is active. The final link rechecks those preconditions and increments state version; clients refresh before uploading the next file or starting/submitting an action.

`WorkspaceRecord.references` and `reference_uploads` are separate from generated `artifacts`. Reference metadata records `technical_validation: full_decode_passed` and `visual_inspection: not_performed`. No receipt, asset slot, research evidence, content approval or EO pass is minted. Feedback must explicitly name selected reference IDs in its action. The runner must validate and retain those identities through later stages, while leaving original brief evidence unchanged.

Uploads are limited to 32 retained reservations/references and 128 MiB of retained reference bytes per task, with at most 128 total intent records. Rejected/cleaned/orphaned reservations do not consume the reference-byte quota; recoverably removed linked references do consume retained storage because their bytes are kept. Object names use hashed owner/task prefixes and a new immutable version. Worker-generated artifacts should use `workspaceObjectKey` and write via the same private object's create-only `put` API only after the worker's real package/asset validation. This custody module does not generate or approve package evidence.

## Byte and storage validation

Uploads stream to a private mode-0700 temporary directory and mode-0600 file. Actual bytes/length/SHA256 are checked before a storage write. Raster magic must match declared MIME; the isolated official Sharp host checks decoded format, single-frame input and a 16-million-pixel ceiling, then computes statistics over every decoded pixel with `failOn: warning`. This rejects header-only files, corrupted/truncated pixels, unsupported/animated formats and oversized decoded dimensions without allocating a whole raw output image. PDF/SVG/HTML uploads are not accepted until a suitable independent inspection/sanitization pipeline exists.

After the external write, the service reopens the exact immutable private object, streams it to a second verified spool, rechecks bytes and raster decode, and commits the reference link in an owner transaction. State races cannot link stale evidence. A stale/corrupt unlinked object is recorded as orphaned and cleanup is attempted; unsuccessful deletion stays orphaned for explicit recovery. Interrupted object write or metadata commit outcomes stay conservative and must be reconciled. Do not infer failure-before-submit from a connection error.

Downloads permit up to 256 MiB (including real ZIPs larger than 32 MiB). The entire object is verified on disk before any success headers are sent. Returned streams use 64 KiB chunks. The default two-transfer spool cap bounds active spool disk at 512 MiB per service instance; source spools are released before stored readback. A shared default worker-write spool also limits worker transfers; requests fail closed when these pools are occupied. Transfer timeout is 60 seconds. Deployments must provision private temporary disk, monitor capacity and define crash-time cleanup of abandoned `uid-private-spool-*` directories only after establishing no live reader/writer owns them. No unsafe automatic stale-lock reclamation is provided.

Filesystem object storage is development/test only, private absolute directories, no-follow file opens, create-only atomic hard links and fsync. It additionally requires a loopback origin; the HTTP router must enforce a direct loopback socket and reject forwarded requests. It is not a production persistence fallback.

`SupabaseWorkspaceObjectStore` is real HTTP transport to a configured HTTPS `*.supabase.co` origin and reviewed private bucket, with redirects disabled and no public/signed route. It writes with `x-upsert:false` and has no bucket/policy creation operation. Inject either the authenticated current user's JWT plus public key, or an independently approved dedicated server role via a memory-only headers callback. Public-key mode rejects privileged role JWTs. The owner/task-prefix RLS/storage policies must be reviewed to match the hashed key convention; for example the first segment must equal the SHA256 hex of the authenticated owner ID, not an arbitrary client-provided owner. Merely setting the review flags is not a real access review. User-JWT read/write/delete behavior, revocation and cross-owner isolation must pass against the real deployment before enabling this capability.

## Verified local tests

`node --import tsx --test tests/uid-workspace-artifacts.test.ts` passes 26 tests covering real PNG bytes/readback, owner/task isolation, durable status/idempotency, MIME spoofing, incomplete data, actual count/hash mismatches, decompression limits, animated WebP rejection, concurrent claims, stale-link cleanup, unknown write reconciliation, missing ambiguous outcomes, corrupt private download, feedback scope, recoverable removal, immutable files, production/loopback restrictions, fixed Supabase HTTP requests and secret-redaction behavior.

The large-file test creates a valid 34 MiB two-entry STORE-mode ZIP as chunks, writes it through the private object adapter, independently reopens it and checks CRCs with Python's `zipfile`, then verifies complete streamed byte count and SHA256. The Node test suite therefore needs `python3` for that independent ZIP assertion. No real Supabase request or provider call is part of these tests. Production RLS, network faults, deployment filesystem limits and browser upload/cancel behavior still require deployment-level validation.

The trusted worker helper `writeVerifiedWorkspaceObject(objects, identity, bytes, context?, spool?)` verifies a bounded source stream, performs a create-only write, independently reopens the exact stored bytes and returns custody metadata only. The caller must retain the immutable identity in its durable run before submission and handle unknown outcomes through that identity. An existing immutable object is accepted only after a successful complete readback; no task artifact or QC receipt is fabricated by this helper.
