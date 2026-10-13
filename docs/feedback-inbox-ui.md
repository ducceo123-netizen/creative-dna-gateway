# Compact feedback inbox

## Design

- Source-brand groups with local status, brand, material and accent-insensitive search filters. Unknown brands remain explicitly unknown. Grouping is read-only; it never derives or widens the approval scope.
- Two-line task rows show summary, submitter, material, status, date and evidence count. Full payloads, evidence, governance and guarded actions render only after selecting a row.
- Native modal detail drawer provides platform focus containment, Escape handling, a named close button and focus restoration. The main page is inert while open. Mutation guards lock close synchronously; the selected proposal is pinned during a mutation so polling cannot remount an in-flight review.
- Admin access, Branch Visual Guide, Reference Library and Knowledge Governance are four independent, closed-by-default sections below the inbox, matching the user’s inspected follow-up screenshot. Rejected-history deletion explicitly remains global, regardless of filters.
- Direct rule, queued review and covered-resolution requests retain existing server-derived scope, hashes, checks and receipts. No new auto-approval or backend behavior is introduced.

Primary-source design references inspected on 2026-10-13:

- [Linear display options](https://linear.app/docs/display-options): grouping, list properties and group counts.
- [Linear filters](https://linear.app/docs/filters): scoped status/property filters and search.
- [Asana navigation](https://help.asana.com/s/article/navigating-asana): compact main task list with selection-driven details pane.

## Verification

Run `npm run lint`, `npm test`, `npm run build` and `git diff --check`.

The component-state tests cover delayed reads, logout/session changes, stale responses, row-to-detail selection, search/group collapse, guarded close, changed/terminal proposal polling during mutation, and per-proposal success notices. Pure tests verify source-brand grouping never widens shared scope and filters compose without changing the source.

Optional real-browser QA uses synthetic proposals and intercepts every `/api/` request; it does not use production credentials or submit real actions. Start `npm run preview -- --host 127.0.0.1 --port 4180`, then run:

```
BASE_URL=http://127.0.0.1:4180 \
CHROMIUM_PATH=/usr/bin/chromium \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
node scripts/feedback-inbox-browser-qa.mjs
```

It checks desktop/mobile row opening, Escape, restored focus, overflow, console errors and absence of mutation requests, and writes screenshots under `/tmp/uid-feedback-inbox-qa` (override `QA_OUTDIR`). The repository does not add Playwright to production dependencies.

### Current verification limit

Automated component tests, typecheck and production build pass. Real browser visual QA has not completed in the authoring sandbox: local Chromium fails at `socket() failed: Operation not permitted`, including an approved escalated launch. The supported cloud browser cannot reach the separate host's loopback preview, and its URL policy rejects data-URL previews. No security settings were changed or bypassed. Run the browser harness in an authorized browser-capable environment or HTTP preview before calling the visual review complete.
