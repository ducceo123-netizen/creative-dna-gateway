# Durable AI sub-operations

A Onepage stage is not one provider request. Research may inspect multiple sources, authoring creates copy, generation creates selected images, and a separate reviewer judges actual evidence. `uid-workspace-operations.ts` pins each named child to the parent owner, task, run, role, model and input hash. The parent run and its immutable input remain unchanged.

The journal records a permanent child identity before invoking a transport. A confirmed reservation is bound before provider submission. The concrete transports must call the current dispatch guard after budget intent, at the actual I/O boundary. Each request still reserves from the same SQL project/member/task journal; child records do not grant spending permission.

- Duplicate/restarted calls do not resubmit. Conflicting input under one key is rejected.
- Independent author/reviewer/image requests use separate bindings and accounting receipts.
- Unknown outcomes retain their budget and stop subsequent children. An unsettled child forces the whole stage into reconciliation, even if an adapter incorrectly returns completion.
- Cancellation, lease expiry and current membership changes fence dispatch. Settled accounting is retained even when output can no longer be accepted.
- Recovery needs every child's exact identity, binding, terminal accounting and independently verified evidence. A parent-only proof cannot release an uncertain image request. Earlier settled spend cannot be rewritten as no-side-effect.
- The journal is not an authorization source, an exactly-once provider promise, a QC pass, or an artistic quality guarantee.

`uid-workspace-provider-runtime.ts` composes real injected transports with those children. Research uses logical research IDs plus the actual child operation ID; reopening checks the durable child receipt. Vision accepts only private rasters belonging to the exact task, including verified immutable source/render write intents. Image edits use actual retained bytes. Shared modality grants are separate from the legacy text grant, while caps and operation fences remain in one ledger.

`uid-workspace-quality-registry.ts` binds a retained QC report to its settled independent reviewer operation and verified private report bytes. It reopens authenticated artwork approval against the exact snapshot, content, render index and asset hashes. It does not assert that a person viewed particular screenshots.

## Release gates

Tests use synthetic provider/SQL fixtures. They do not verify current account entitlement, real billing, a live database, browser screenshots or EO improvement. Deployment still requires reviewed database/RLS and private storage, current membership/ingress configuration, secure server credentials, processor/data authorization, explicit project/member/task/request caps, verified model/pricing capabilities, actual permitted browser QA and a current-canonical blinded quality benchmark. No credentials or grants are configured by importing these modules.

## Multi-call timing and progress

The production composer supplies bounded per-stage deadlines and leases, rather than applying the generic one-minute stage timeout to eighteen sequential image operations. Research's acquisition deadline is configurable and separate from evidence reopening. The initial production defaults are failure ceilings, not predicted completion times: 15 minutes for research acquisition plus QC, 45 minutes for a full image stage, and 3 minutes for content/review/package stages. Actual latency must be benchmarked before release. Crashed long-running workers can remain fenced until their lease expires; no automatic generation retry is inferred from elapsed time.

Each child start and terminal status writes a persistent progress event with its role and model. It never implies the outcome passed QC or user approval. Uncertain artifact writes also prevent stage completion/recovery until custody has been independently reconciled. Native-source captures now use the run artifact writer in the production composition, so source rasters are authorized for later vision from verified immutable intents.
