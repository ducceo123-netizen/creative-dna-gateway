UID Brands V2 public sandbox test kit

Requires Node.js 24.14 or later. No npm install or external dependency is needed.
Copy this whole directory, including fixtures. Run either script with --help.
Each output filename must be new; existing files and symlinks are refused.

The only allowed origin is:
https://uid-brands-architecture-v2-test.onrender.com
MCP endpoint: https://uid-brands-architecture-v2-test.onrender.com/api/mcp

PUBLIC MODE (default; no token or Authorization header)

node /path/test-kit/smoke.mjs --origin https://uid-brands-architecture-v2-test.onrender.com --output /path/smoke-NEW.json

The server health must explicitly report authRequired:false, publicSandbox:true,
and authMode:public-test. Public jobs, artifacts and review activity are shared
in the isolated sandbox. Use test/public data. Existing private bearer-owner jobs
remain separate; a missing token does not access those owners' jobs or assets.
An invalid or explicitly empty Authorization header is rejected rather than
silently falling back to anonymous access.

The smoke creates/resumes one isolated test job, records stage/telemetry receipts
and uploads the synthetic PNG. It checks anonymous discovery and exact public
artifact bytes. It performs no approval, packaging, generation or deployment.

Optional: append --source-commit FULL_COMMIT_SHA as a report label. This label
is not an independent deployment attestation. Each public smoke invocation gets
a fresh UUID-based idempotency key, recorded in its report and reused within
that invocation's reconnect check. Running public smoke again creates a new job;
use resume.mjs with the prior report to read the existing job. Public data is
still shared; another sandbox user's intentional revision can invalidate a
later exact-state check. Bearer smoke retains a stable key per source label.

PUBLIC RECOVERY after a separately confirmed restart or redeployment

node /path/test-kit/resume.mjs --origin https://uid-brands-architecture-v2-test.onrender.com --before /path/smoke-NEW.json --deployment dep-EXAMPLE --output /path/recovery-NEW.json

Recovery reads the prior job and exact artifact bytes. It does not deploy,
restart, create a new job, upload an artifact or change task state. Normal server
telemetry may record these reads. Keep the job unchanged between the checks.
Default jobs/artifacts expire after seven days; preserve reports before expiry.

OPTIONAL BEARER MODE (separate private identity)

Append both --auth-mode bearer --token-file /private/token.txt to either command.
No credential is included. On macOS/Linux: chmod 600 /private/token.txt.
Never paste a token into commands, reports, Git or chat. Public mode refuses a
--token-file argument, preventing accidental credential use. Bearer mode also
works on public-test servers and verifies its private artifact is unavailable
without its token (404 in a public sandbox; 401 when authentication is required).
To recover an older version-1 bearer report, explicitly select bearer mode.
Recovery refuses an auth-mode mismatch instead of changing owner scope.

Exit 0 means PASS; exit 1 means setup or a recorded check failed. Reports include
mode, health policy, timings, byte counts and hashes; no token or full canonical
packet. Free-service cold starts may delay the first request (110s timeout).
Choose a new output filename each time. A new public smoke run uses a new job;
use a passing prior smoke report with resume.mjs for recovery checks.

Coverage: 17 tools, MCP 2025/2026 envelopes, public discovery, invalid/empty
credential rejection, Origin/method rejection, 23 canonical steps, stage receipt,
full fallback, idempotent recovery, MCP image/resource bytes, REST upload/download,
MIME checks and mode-appropriate anonymous artifact access.
The current optimized endpoint also verifies compact/full state fallback,
lossless same-response coverage references, and unchanged context reads without
an additional job revision. It never omits canonical rule text across requests.
The current backend also supports 1–12 independent exact rule/evidence lookups
through paths:[...] in the existing lookup tool. The smoke verifies four exact
values, including null and arrays, returned together without changing job state.
Only the isolated endpoint is contacted; production endpoints are never called.
This kit does not establish a real GPT connection, visual inspection, complete
creative workflow, EO parity, billed token savings or all cross-owner boundaries.

Offline argument/header/health/scope tests:
node --test /path/test-kit/public-mode.test.mjs

fixtures/synthetic-transport.png is a synthetic mechanical-render QA image,
not product research, a real product photograph, or an accepted creative asset.
It is included only to verify transport, MIME handling and byte integrity.
SHA-256: dd25eab4bb911529ddd74958054eaabb73325a7a1145d8f03f21ec16a9739053
