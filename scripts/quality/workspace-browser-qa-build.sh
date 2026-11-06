#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-${TMPDIR:-/tmp}/uid-browser-qa-bundle}"
mkdir -p "$OUT/ui" "$OUT/fixtures"
OUT="$(cd "$OUT" && pwd)"
npm run build
# Only static UI assets, never the production gateway server, maps, secrets or node_modules.
cp dist/index.html "$OUT/ui/"
cp -R dist/assets "$OUT/ui/"
cp public/uid-brands-logo.svg "$OUT/ui/"
node scripts/quality/workspace-browser-qa-assets.mjs "$OUT/fixtures"
node_modules/.bin/esbuild scripts/quality/workspace-browser-qa-server.ts --bundle --platform=node --format=cjs --outfile="$OUT/server.cjs"
cat > "$OUT/README.txt" <<'EOF'
LOCAL QA SYNTHETIC ONLY

Run from this extracted directory: node server.cjs
Then open: http://127.0.0.1:4318/workspace?task=qa-preview-current
Node 20+ recommended. No npm install. Ctrl+C stops the server.

This bundles the actual UID UI and actual workspace API, development filesystem
store, deterministic synthetic PNG assets, and canonical buildWorkspacePreview.
No model/provider, production integration, real account, or real product is used.
The fixed local session is a test sentinel, not an auth credential. Never deploy.
Only the official public Shopify Polaris CDN may load as external UI code.
CSP blocks outgoing fetches; fixture data stays on localhost.

Fixture scenarios:
- /workspace: dashboard and create/save brief (execution deliberately unavailable).
- ?task=qa-preview-current: current preview, element/section selection, desktop/
  mobile viewport, zoom, history/current vs before, image gallery and real downloads.
- ?task=qa-content-review: content slots and current text hashes.
- ?task=qa-recovery-unknown: unknown/reconciliation blocker. No provider submitted.
- ?task=qa-draft: persisted draft with unavailable execution.

The actual API supplies config/session, owner-scoped task list/cursor/detail,
events, preview, immutable revisions, real bytes with checksum, and recovery.
Exact state-version/approval/feedback checks are the real API implementation.
Because AI is disabled, approvals/feedback that require execution are blocked.
The UI must not imply that synthetic fixtures demonstrate real AI or EO success.

The first run seeds ./qa-state. Refreshes/restarts preserve local state.
For a new test use a fresh extraction. Do not upload real or private files here.
No production server or environment files are included.
EOF
printf 'Portable QA directory: %s\nNo Python is needed. Run: cd "%s" && node server.cjs\n' "$OUT" "$OUT"
