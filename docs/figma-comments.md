# Read-only LDP Figma comments

`read_ldp_figma_comments` accepts an explicit Figma `file_key`, optional exact pin `node_id`, and bounded local pagination (`offset`, `snapshot`). It never posts/resolves comments or edits files. Comment text is untrusted feedback and never grants action authority. Pins report actual Figma metadata; reply pin inheritance is labeled. Canvas-only comments cannot be mapped to a frame without separate evidence.

## Security and rollout

Disabled by default (`NOT_CONNECTED`). No secrets or grants are provisioned by this change. Token configuration alone is insufficient. Operator setup, separately authorized, requires:

- Server-only `UID_FIGMA_READ_TOKEN`, a Figma personal access token scoped to `file_comments:read`, entered through the hosting provider's secure secret UI. Never place it in chat, model tool arguments, a browser bundle, logs, URLs, or source control.
- `UID_FIGMA_AUTH_PUBLISHABLE_KEY` for the existing fixed UID Supabase project (publishable/anon key, never service-role). Each call verifies the HTTP Bearer session with `/auth/v1/user`, then checks active UID membership through that user's RLS policy.
- `UID_FIGMA_FILE_ACCESS_JSON`: an explicit JSON map from verified UID user UUIDs to approved Figma file keys. No wildcard, public, or all-member access. Each grant is a private-file sharing decision requiring owner approval. Existing UID membership alone does not grant Figma access.
- An authenticated client capable of supplying its own UID session through the HTTP Authorization header. The current public plugin connection does not establish this session. This patch does not provision OAuth, issue tokens, change plugin authentication settings, or ask the AI to copy a session into an argument. Until secure transport is configured, the chat tool remains `AUTHENTICATION_REQUIRED`, even if a Figma token exists.

The server binds the current HTTP request header to a fresh MCP server instance in both modern and legacy stateless transport. Never use a global user's session. Auth, membership and grants are rechecked for every page, with no comment cache. Existing public tools remain available. All MCP responses use private/no-store headers.

## Bounds and limitations

The upstream GET comments endpoint has no pagination parameter. We fetch at most 2 MiB/10,000 comments under a 12-second total timeout, then expose 25 comments per local page. Messages longer than 4,000 characters are marked truncated. Use the returned snapshot for later offsets; changed snapshots require a restart. There are at most four concurrent reader calls and a bounded Retry-After cooldown for Figma 429 responses. There is no automatic retry. Oversized, malformed, timeout and access-error responses are sanitized, never reflected verbatim. Live credential/file access is not tested by fixture-only tests.

Official sources checked 2026-10-16:
- https://developers.figma.com/docs/rest-api/comments-endpoints/
- https://developers.figma.com/docs/rest-api/comments-types/
- https://developers.figma.com/docs/rest-api/comments-property-types/
