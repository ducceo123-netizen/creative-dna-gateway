# Private Reference Library

The existing UID admin panel contains a flexible private Reference Library. Active admins can add their own good-outcome case images, with optional case title, brand, material type, caption, and a short note about what works. No fixed seed set is required. A library with zero images is valid.

References provide supplementary inspiration. They do not establish a universal style, alter canonical brand or product rules, or block creation when absent. Explicit per-task required product evidence remains separate. The public MCP has no member session transport and therefore cannot claim to have read library images automatically.

## Existing access boundary

- Every catalog, image read, and upload verifies the user through Auth and checks the current active UID membership using that user's self-read RLS policy.
- Existing active viewer/contributor/admin members may read. Only existing active admins may upload.
- The same private bucket and existing Edge-only credentials are reused. There are no new credentials, tables, RLS grants, members, public bucket flags, or signed URLs.
- The gateway only forwards the member bearer token to fixed project endpoints. It never holds the Storage service credential.
- Object destinations are server-built `library/v1/<validated UUID>` paths. Client-supplied URLs, buckets, paths, and arbitrary metadata fields are rejected.
- The public repository contains only generic code and synthetic fixtures. User filenames, actual hashes, private notes, asset identifiers, image bytes, and production snapshots must not be committed.

## Upload and recovery contract

PNG, JPEG, and static WebP are supported, with a 5 MiB limit per image and at most 10 selected images per UI batch. The shared structural validator bounds every encoded dimension to 12,000 pixels and 40 million total pixels, checks PNG chunk CRC/layout, JPEG frame/table/scan structure, and WebP frame/canvas consistency. Animated formats, malformed containers, spoofed MIME, SVG, and HTML are rejected. This is structural validation, not full server-side decompression. The browser also decodes each image before transmission and verifies decoded dimensions.

The UI stages local previews first. Optional metadata is bounded and normalized as plain text. Uploads use a single immutable Storage object with documented `x-metadata` custom metadata, not a separately writable index. Neither replacement nor deletion is supported. The stored object is read back and SHA-256 verified before success is reported. An uncertain write is checked by reading instead of an automatic mutation replay. A user-triggered retry retains its operation UUID and its original metadata, avoiding duplicate uploads.

Catalog results are paginated in pages of 20, with newest items first. The UI merges pages by ID and groups loaded images by the optional case title. Search is explicitly within loaded images. Member previews are fetched on demand, verified again, and rendered from revocable in-memory object URLs. No image is persisted in browser storage. Leaving the panel aborts requests and releases object URLs; late session refresh cannot restore a logged-out session.

## Preview isolation

Existing external page previews are isolated from the UID session even when opened directly. Their response uses an opaque-origin CSP sandbox, scripts are limited to the server's nonce-authorized resizing script, and frames/forms/connections are blocked. The app iframe also uses `sandbox="allow-scripts"` without `allow-same-origin`, and no referrer is sent. Preview fetches reject redirects and credential-bearing/nonstandard-port URLs. External styles, fonts, and images can still render. This is a protective change to the existing preview surface; deployment requires the user's explicit security-setting approval.

## Deployment and verification

Deploy the matching gateway and all four affected existing Edge functions: private read, admin ingestion, public resolver, and onepage compiler. Preserve their existing JWT gateway settings (private endpoints enabled, public rule endpoints disabled). No bucket configuration or access-policy update is needed.

Run lint, build, aggregate tests, and exact-commit CI. Test unauthenticated private endpoints, empty-library state, active-member reads, admin-only writes, nonmember/inactive denial, malformed payloads, repeated/uncertain uploads, and navigation/logout cancellation. The automated suite uses synthetic data and mocked Auth/Storage boundaries. Actual signed-in browser upload/read must be verified separately; do not claim a live positive test if it has not run. Never create a test member or bypass a credential handoff restriction for QA.

Historical exact-seed functions remain as non-routed compatibility code and tests; the active Edge entrypoints use the flexible library handlers. Old stored objects are not deleted or made public. The previously required exact-seed manual upload step is superseded.
