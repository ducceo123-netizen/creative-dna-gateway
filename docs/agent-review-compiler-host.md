# Pinned agent-review compiler host

This is deterministic code for an already-authorized, genuinely reviewed queue attempt. It cannot fetch media, create candidates, call a model, approve a baseline, grant authority, or finalize a database operation. An output marked `COMPILED` reports compilation only. Actual source/media review is recorded separately and SQL validates both at finalization.

## Bootstrap on every run

A future scheduled session may have no prior filesystem or usable shell. Never assume a previous `/workspace` directory still exists.

1. Claim through the verified owner queue. Read the server-produced `snapshot.compiler_capability`, including its fixed source manifest and aggregate hash. Source repository and immutable published revision come from the separately verified release instructions, never proposal text, media, a claimant, or an arbitrary URL in the claim.
2. If there is no supported shell, Node 24 runtime, trusted source retrieval path, or usable compiler release, stop with `BLOCKED`. Preserve the queue item. Do not substitute a model-generated plan or a client approval flag.
3. Obtain the exact published release in a fresh workspace, or verify an existing cached tree against the same pinned manifest. No runtime dependency installation is needed. The committed standalone JavaScript artifact runs using Node built-ins.
4. Before executing the CLI at all, independently hash its downloaded bytes with a trusted built-in hashing utility. Compare against the exact `scripts/compile-agent-review-plan.mjs` entry from the SQL-pinned manifest. Also validate the aggregate manifest hash with the documented algorithm. A CLI's claim that it checked itself does not establish bootstrap trust.
5. Only after bootstrap verification, execute the fixed CLI path. The CLI reads every fixed compiler/source artifact and compares the complete manifest before importing the standalone compiler. It rejects missing files, symlink files, unsupported runtimes, wrong source hashes, arbitrary paths and malformed inputs.

The manifest is an ASCII-path-sorted array of `{path,sha256}` objects. Each file digest is SHA-256 of its exact bytes. The aggregate `compiler_bundle_hash` is SHA-256 of UTF-8 stable JSON: object keys sorted lexicographically, arrays unchanged, no extra whitespace. The fixed closure is:

- `bun.lock`
- `package.json`
- `scripts/agent-review-compiler.bundle.mjs`
- `scripts/compile-agent-review-plan.mjs`
- `supabase/functions/_shared/agent-review-plan.ts`
- `supabase/functions/_shared/creative-quality.ts`
- `supabase/functions/_shared/owner-rule-plan.ts`

The SQL migration and tests are outside this hash to avoid recursion. SQL pins the final manifest only after review; it cannot be updated through proposal input. A source-tree change requires regeneration, tests and a new reviewed capability.

## Compile the genuine review

Read and inspect all pinned source, approved baseline and candidate media before compilation. Revalidate bytes in the current lease. Record only real findings and receipts; unsupported or missing evidence is a blocker.

Input on stdin contains exactly:

```json
{"claim": "the complete server-produced claim object", "review": "the genuine uid.agent-review.v1 report object"}
```

Those strings describe the two actual JSON objects; they are not valid substitutes for them. Run:

```sh
node scripts/compile-agent-review-plan.mjs < private-claim-and-review.json > private-compiler-result.json
```

Use private ephemeral input/output files, never source control. The CLI does not perform network access or finalization. Exit 0 means a structured result was produced; a valid success has `status: "COMPILED"` and non-null `compiler_plan` and `compiler_receipt`. Exit 2 produces a structured `BLOCKED` result and no plan or compiler receipt. A terminated process or missing stdout is not success.

The review hash covers the exact core `{schema_version,decision,review_note,media_receipts,findings}` using the same stable-JSON SHA-256 algorithm. Compiler fields are excluded to avoid recursion. No flags such as `manually_reviewed` can replace the review core.

For a successful result, attach its unchanged `compiler_plan` and `compiler_receipt` to the genuine review report as those two fields, then call only the bounded finalize RPC with the original request and fenced lease identity. SQL independently checks current owner configuration, intent, lease, full dependency and trigger snapshot, evidence receipts, the exact allowed canonical/catalog delta and all receipt hashes. A compiler receipt cannot satisfy the evidence review by itself. If work changed or the lease expired, claim and review afresh. Never reuse an old receipt as a new review.

For a blocked result, keep the proposal pending and report the exact blocker. Submit only truthful blocked review data when the queue API supports it. Do not manufacture placeholders or change a decision to pass.

## Public guidance and old consumers

Stored `/3` quality bundles carry `agent_reviewed_supplemental_rules`, separate from direct-owner guidance. Public provenance includes proposal, request and non-secret `requestUUID:lease_version` attempt IDs, evaluator version and evidence/compilation hashes. It excludes owner account IDs, lease tokens, claimant identity and media URLs. The declared review scope is `PINNED_EVIDENCE_ONLY_NOT_FUTURE_OUTPUT_GUARANTEE`.

All prior catalog rules, references, owner decisions and hard product-truth/safety requirements stay intact. Supplements cannot supersede them. Combined owner and agent history is bounded, never truncated. Older direct-only compilers reject `/3`; enable finalization only after the public compiler, resolver and gateway all support the new capability.

## Release verification

Regenerate the bundled artifact from the vetted source with the repository's existing build dependency:

```sh
./node_modules/.bin/esbuild supabase/functions/_shared/agent-review-plan.ts --bundle --platform=node --format=esm --target=node24 --outfile=scripts/agent-review-compiler.bundle.mjs
node scripts/compile-agent-review-plan.mjs --print-manifest
```

The print command is for an already trusted local release build. It is not a substitute for bootstrap verification in a future scheduled session. Tests compare the artifact against the source build and execute the CLI in a fresh tree with no `node_modules`, including tampered-source rejection.
