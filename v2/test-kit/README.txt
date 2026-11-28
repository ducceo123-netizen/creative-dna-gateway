UID Brands V2 endpoint test kit

Requires Node.js 24.14 or later. No npm install or external dependency is needed.
Copy this whole directory, including fixtures. Commands work from any directory
when the script, token and report paths are supplied explicitly.
Run either script with --help for its required arguments.

The only allowed origin is:
https://uid-brands-architecture-v2-test.onrender.com
MCP endpoint: https://uid-brands-architecture-v2-test.onrender.com/api/mcp

Use the separately supplied V2 opaque credential in a private text file.
No credential is included in this kit. On macOS/Linux: chmod 600 /path/token.txt
Do not paste the token into a command, a report, Git, or a chat message.
Each output filename must be new; existing files and symlinks are refused.

Full smoke (creates/resumes one isolated test job and uploads synthetic bytes):

node /path/test-kit/smoke.mjs --origin https://uid-brands-architecture-v2-test.onrender.com --token-file /path/token.txt --output /path/smoke.json

Optional: append --source-commit FULL_COMMIT_SHA as a report label. The script
does not independently verify the deployed commit. Reusing the same label
resumes the same smoke idempotency key; no approval or packaging is performed.

Recovery after the operator independently confirms a restart or redeployment:

node /path/test-kit/resume.mjs --origin https://uid-brands-architecture-v2-test.onrender.com --token-file /path/token.txt --before /path/smoke.json --deployment dep-EXAMPLE --output /path/recovery.json

The recovery script reads the prior job and exact artifact bytes. It does not
deploy, restart, create a new job, upload an artifact or change task state.
Normal server telemetry may record these reads. Leave the test job unchanged
between the two checks; an intentional revision invalidates exact comparison.

Exit 0 means PASS. Exit 1 means setup failed or a recorded check failed.
Reports contain status, timings, byte counts and hashes; no token or full
canonical packet is exported. The first request may wait for a Free cold start.

Coverage: 17 tools, MCP 2025/2026 protocol envelopes, missing/invalid credentials,
Origin and method rejection, 23 canonical steps, stage receipt and full fallback,
idempotent recovery, MCP image/resource bytes, REST upload/download, MIME checks.
Only the isolated endpoint is contacted; production endpoints are never called.
This kit does not establish a real GPT connection, visual inspection, complete
creative workflow, EO parity, billed token savings or cross-owner authentication.

fixtures/synthetic-transport.png is a synthetic mechanical-render QA image,
not product research, a real product photograph, or an accepted creative asset.
It is included only to verify transport, MIME handling and byte integrity.
SHA-256: dd25eab4bb911529ddd74958054eaabb73325a7a1145d8f03f21ec16a9739053
