# UID Brands chat-first safety mode

This release chooses a smaller client surface over embedded interaction. It does not claim to establish the cause of a reported ChatGPT conversation failure.

## Behavior

- Public tool names, input schemas, authorization boundaries and canonical backend logic stay unchanged.
- Launcher and review tool descriptors no longer associate an output template or UI resource.
- Briefs, task/version context, actual asset inventory and stage-specific next actions are returned as text and structured data.
- Feedback requires the user's explicit selected asset IDs (or an unambiguous name resolved against the actual inventory) and requested changes. Missing identity/inventory must be verified, never invented.
- Ordinary feedback never automatically becomes Train. Explicit Train still creates only a Pending Admin Review proposal through the existing tool, subject to authorization.
- Research, quality gates and actual ZIP/CRC verification remain required for packaging. Displaying guidance does not execute an action.
- Original files and images are attached in chat. Embedded upload controls, interactive tabs, grouped picker, draft persistence and resize/state synchronization are no longer served.

## Compatibility and limitations

The v2/v3/v4 resource URIs remain readable to avoid a hard error for previously issued descriptors, but now return a static notice with no scripts, event handlers, forms, frames or network assets. The old widget source and behavioral tests are retained for historical regression coverage; the server no longer imports or serves that bundle.

A server update cannot purge HTML or descriptors already cached by ChatGPT. Existing open panels can still contain older code. Preserve any unsent draft, continue with ordinary chat, and do not repeat a request whose execution outcome is unknown. New tool discovery receives no widget binding. No sandbox permissions, browser storage policies or login settings are loosened.

Helper prose is bounded and never truncates an asset ID into a different selectable ID. Existing structured output fields retain their compatibility limits, including historically unbounded asset strings; this release does not expand their size or introduce external transmission.

Some preserved schema descriptions and historical action labels still use panel terminology. The runtime descriptors, server instructions and returned chat status explicitly disable interactive rendering; schema cleanup is a separate compatibility change.

## Verification

- Node full suite: 622 tests passed, none skipped.
- TypeScript check and production build passed.
- Independent review: no blocking production regression.
- Live-local MCP tests cover exact context, inventory, all review stages, no dispatch/upstream reads for review, no UI-template metadata and inert compatibility resources.
- Existing public input-schema hashes, research/attachment source pins and historical widget tests retained.

A real ChatGPT host end-to-end smoke test and fresh-discovery/cache behavior remain to be verified after an authorized release. Local tests do not prove that unrelated host thread failures are resolved. Bun CI remains the runtime-specific check; Bun is not installed in this local execution environment.
