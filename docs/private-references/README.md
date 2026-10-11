# Private reference access

This repository contains generic code and synthetic tests only. Actual filenames, Library identifiers, storage object locations and content hashes must remain in the private deployment catalog. Do not commit that catalog or image payloads.

## Private configuration

`supabase/functions/_shared/private-reference-catalog.ts` is intentionally empty in source control and fails closed. The approved catalog is injected at this path only while packaging the private Edge deployment. Preserve the catalog's provenance outside this repository. The catalog is not a credential and does not grant access by itself.

Use the supported Library materialization flow for known approved originals. Keep the unchanged resolved identifiers and verify consumer-local bytes. Never guess a Library download URL or use public feedback storage. If a viewing derivative is necessary, retain source and derivative hashes privately and visually verify the conversion.

## Boundaries

Both Edge functions require `verify_jwt=true`, authoritative Auth user verification, and current active membership from the existing self-read RLS policy. Do not authorize from display names, supplied IDs or editable user metadata.

- Member GET: with no query, returns minimal catalog metadata only after membership validation; with an approved reference ID, returns bounded, hash-verified image bytes.
- Admin POST: accepts raw bytes only for an approved catalog ID, exact MIME, length and SHA-256. It writes a fixed private object with no upsert, then reads and verifies the stored bytes.

The bucket must remain private. Ingestion checks existing bytes for idempotency and never overwrites a conflicting object. An uncertain write is established through a read rather than replayed automatically. No anonymous bootstrap, arbitrary source URL, bucket update, account creation or general uploader exists.

Only the fixed Supabase project receives the existing server-side Storage credential. Modern secret keys stay in `apikey`; legacy service JWTs can use Authorization. User tokens and credentials never enter logs or source. The audit includes bounded request/actor/reference identifiers and result codes only.

The gateway is a fixed-target bearer-forwarding proxy. It has no private catalog or service credential, validates the authenticated catalog schema, bounds image streams, independently checks hashes, and redacts upstream errors. The admin panel obtains catalog metadata dynamically through authenticated access, validates every selected file before uploading any, aborts on unmount/logout, and revokes browser-local preview URLs.

## Public MCP limitation

The existing public MCP/resolver/compiler does not carry a member session. It must never return signed URLs, private image bytes or private asset URLs. Admin storage/read success does not establish cross-account generating access. Reference-dependent image stages remain blocked until the actual generating account has an authenticated member transport and has inspected the pixels. A future OAuth/member integration needs separate scoped security review and approval.

## Verification

Run `npm run lint`, `npm test`, and `npm run build`. Focused tests use synthetic identities, bytes and metadata. They cover denial, active-member reads, revocation, exact-hash admin ingestion, no-overwrite/idempotency, uncertain writes, bounded streams, fixed proxy targets, redaction, catalog privacy, parser ordering and logout races.

Before claiming live usability:

1. Verify current bucket privacy, Storage RLS and absence of broad granting policies.
2. Deploy reviewed functions with JWT checking and the privately injected catalog.
3. Verify unauthenticated requests fail. Do not disable auth or create users/tokens for testing.
4. Deploy the reviewed gateway; use the existing admin's supported secure browser login, never token extraction or chat credentials.
5. Select only the approved original/verified derivative files; verify every upload receipt and authenticated read/hash.
6. Verify direct unauthenticated Storage reads stay denied. Use an existing explicitly authorized nonmember session if available; otherwise disclose that live nonmember-token testing was not performed.
7. Keep the public-generation reference gate honest.

References: [Supabase authorization headers](https://supabase.com/docs/guides/functions/auth-headers), [private Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
