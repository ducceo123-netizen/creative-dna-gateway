# Workspace UI implementation

The additive route is `/workspace`. Every other route still renders the existing `App.tsx`. No existing ChatGPT prompt panel, old rule UI or compiler is replaced.

## Current interface

- Authenticated own-task navigation, real brief creation, same-origin login/logout and configured execution readiness. No local user, API-key field, token entry, mock outputs or automatic mutation replay.
- Automatic progression is server-owned. The UI creates the brief then requests `start` once when execution is actually ready. Content and artwork approvals are explicit revision-bound actions below the outcome. A transport acknowledgment is not described as completed work.
- Content review renders server-provided canonical text slots before any images exist. Separate feedback groups bind exact UTF-8 text hashes.
- Visual review displays the server's exact bound canonical HTML in an `allow-scripts`-only iframe. Message source, nonce, render hash, review index and element IDs are validated. The iframe never receives same-origin privileges. Desktop/mobile changes do not remount the feedback form.
- Groups retain their distinct instructions and 1–10 limit. Section descendants and responsive aliases are resolved to logical targets. A stale render keeps the draft but requires explicit reselect; it cannot silently target changed assets. Grouped revision requests and human visual acceptance use exact current task/content/state/manifest bindings.
- Files reflect actual server metadata. Download links are enabled only for verified artifacts and exact same-task authenticated artifact routes. No fake links or public uploads.
- Polling is read-only, every eight seconds while a task is open. Events use a cursor, drain at most five pages per poll, deduplicate sequence numbers and retain the newest 200. Mutation uncertainty is not automatically retried; known action receipts can reconcile an uncertain request.

Unsent brief and grouped feedback inputs are restored from bounded local browser storage only after the server verifies the same owner ID. The envelope expires for restoration after seven days and expired entries are removed when read. Only allowlisted input fields and exact draft bindings are persisted: no cookies, tokens, login state, approval flags, execution receipts or server task outcomes. Storage failures are disclosed in the brief footer. Upload bytes and staged files remain tab-local. Logout, failed authorization and a verified identity change clear in-memory private caches; request generation checks prevent late responses from a prior session restoring data. The server remains the only authority for execution, approval and completion.

Private reference intake now supports paste, drop and file selection, local thumbnails, filenames, role, progress, known-failure retry and unknown-outcome reconciliation. It is disabled unless the real server advertises configured private upload storage. PNG/JPEG/WebP bytes are SHA-256 bound and sent as raw bytes through authenticated task-only routes. The new-brief flow saves the task, uploads staged references sequentially with refreshed state versions, then starts once only after all references are linked. No public URL or client-selected storage location is accepted. Lost upload responses do not trigger another PUT. Lost reservation responses are looked up by the original idempotency key. Soft removal uses the server's current revision preconditions and does not delete immutable bytes. Successful full decode means technical validation, never pixel inspection or EO approval.

For feedback, uploaded references are explicitly selected per visual group or for a content-feedback batch; attaching a file does not silently include it in every request. Mixed text/image target groups retain their exact instructions. Rebase clears both prior targets and prior reference selections.

The result view loads actual server revision metadata and private historical preview HTML. Earlier revisions and before/after comparison are read-only; approval and feedback actions cannot run against a historical render. Returning to the current version preserves unsent instructions and requires explicit scope reselect when stale. Desktop/mobile width, preview zoom and the verified-raster gallery are presentation controls, not new approval evidence. Gallery and download links remain authenticated and same-task.

The task navigation now follows owner-bound server cursors beyond the first 100 tasks, merges by task ID without downgrading an observed state version, and labels search/filter scope while more pages remain. Recovery controls appear only from server-provided capability data; provider reconciliation does not let the browser assert that an unknown attempt is safe to rerun.

No real provider, membership service, credentials or deployment is configured by this UI change.

## Official Shopify library and verified shell reference

The UI loads the current official Polaris 2 Web Components from `https://cdn.shopify.com/shopifycloud/polaris-2.js`, only on the workspace route. It uses the official `@shopify/polaris-types` 2.0.0 package (declared compatible range `^2.0.0`). No App Bridge, Shopify OAuth, Shopify API key, archived Polaris React or `@shopify/ui-extensions` dependency is included. Components include Page, Section, Banner, Button, Select, URL Field, Text Field, Text Area, Email Field and Password Field.

The major-track CDN URL is not immutable: Shopify can update the library within the supported major. It grants the loaded script ordinary page-script privileges and makes a request to Shopify CDN. The request sets `referrerPolicy=no-referrer`; no task content or credentials are put into its URL. A failed library load shows a retry gate rather than an uninitialized form. A future release should review a stricter version/integrity strategy and CSP alongside current official distribution support.

The shell was measured read-only in the user's signed-in refreshed Shopify Admin on 6 November 2026: 220px dark sidebar, outer canvas `#0a0a0a`, main panel inset 4px with 16px radius, sidebar search, bottom account area, and a subtle raised selected-navigation pill. UID keeps its own logo, task navigation and workflow. There are no copied commerce metrics or Shopify account controls.

Official references:

- https://shopify.dev/docs/apps/build/app-home/polaris2
- https://shopify.dev/docs/api/app-home/latest/web-components
- https://shopify.dev/docs/api/app-home/latest/web-components/versioning
- https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/page

Polaris components are not the whole Shopify Admin shell. Current CDN standalone usage is documented; the archived React custom license must not be assumed to be the CDN license. No statement of unrestricted MIT licensing or pixel-identical Shopify cloning is made. Standalone redistribution/license terms still merit release review.

## Verification limits

The 27 focused UI contract tests cover spoofed frame messages, stale selection, alias overlap, exact content hashes, group bounds, authenticated downloads, uncertain mutation handling, login destination, cursor pagination beyond 100 rows, owner-isolated expiring input storage, historical preview bindings, verified-only galleries, raw upload bytes/hash/CAS sequencing, unknown PUT no-retry, explicit reference rebase and additive route isolation. TypeScript and Vite/server production build have passed locally. Browser rendering and Vietnamese IME are not certified: local Chromium startup was blocked by the execution sandbox and no visual/browser pass is claimed. A real authenticated end-to-end run, actual provider output, pixel comparison and production deployment remain separate acceptance gates.
