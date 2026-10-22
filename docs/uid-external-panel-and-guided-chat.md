# Task creation panel and live Onepage feedback

## Current behavior

- `/onepage-panel.html` remains available at the same URL for bookmarked/shared links, but opens the task brief composer directly. There is no feedback tab or canonical-slot picker on this page.
- Brand/material filtering, per-route local brief drafts, validation, collapse and clipboard/manual-copy fallback remain. Closing or reloading loses the local draft. The page does not execute tasks or access the network.
- Onepage feedback belongs on the actual bound preview: select image/text/section, group feedback and copy into the same chat. Without a preview, ask in chat to reopen the correct result. Verify identity, version and actual inventory before editing.
- The live preview runtime, feedback backend/history, admin review and rule approval, content and assets are unchanged. Legacy MCP resource URLs still return their inert chat guidance; retired embedded scripts are not reactivated.
- Stage guidance no longer advertises the obsolete feedback tab or routes an existing outcome back to task creation. The launcher continues to offer the task composer URL.

## Validation

Regression coverage checks task-only entry, unchanged brand/material routes and input validation, per-route draft preservation, collapse, clipboard rejection/manual selection, no network/storage bridge and preview-specific chat guidance. Live preview feedback tests are retained unchanged.
