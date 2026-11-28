# Comprehensive V2 optimization with flow and outcome gates

This pass covers repeated canonical computation, evidence byte validation, tool orchestration, storage access and delivery validation. It changes only V2. The creative model/effort, full canonical text, source freshness obligations, ordered steps, visual QC, exact templates and explicit approval gates remain authoritative.

| Layer | Implemented | Boundary retained |
|---|---|---|
| Canonical context | Bounded verified bundle cache; one immutable snapshot fingerprint per grouped advance | Fresh owner/job/expiry read before reuse; full snapshot, registry, conflicts, provenance, stage and template identity; full rule text still returned |
| Research evidence | Reuse successful byte validation by actual hash within one submission | Every source/item/reference/permission/EO mapping still checked; fresh upstream compile still runs |
| MCP orchestration | 1–12 independent exact lookups in one existing tool call, from one job snapshot | Single-path API retained; arbitrary JSON values preserved; no batched approvals or bypassed creative steps |
| Asset validation | Successful full decode receipts reused only after freshly hashing actual bytes | Current format/dimensions/slot checks run every call; changed bytes, expired entries and failures require fresh validation; no visual QC is cached |
| Artifact storage | Metadata and bytes in one read; up to 24 requested artifact hashes in one transaction | Each returned byte buffer hash checked; owner/job/expiry/RLS, CAS, history, quota locks and leases remain enforced |
| Delivery I/O | Required slot artifacts fetched together, preserving every slot and content revision | Exact GTK/FAQ template, four browser viewports, preview, ZIP reopening/CRC and package authorization unchanged |
| Telemetry | Authorize without fetching the whole canonical job document | Telemetry remains awaited and durable; no fabricated model token/cost fields |

## Compatibility

There remain 17 MCP tools. `onepage_get_rule_or_evidence` accepts exactly one of `path` (existing single lookup) or `paths` (1–12 unique paths). The batch returns `{entries:[{path,value}]}` in request order and fails as a whole if a path is invalid. Its response is limited to 2MB; split oversized requests. Other tool inputs and the full context fallback are unchanged. Refresh MCP discovery to expose the optional new field.

The context cache is process-local: at most 16 entries and 8MiB serialized content, with a five-minute TTL. Keys include owner, job ID and the entire canonical snapshot fingerprint. Only successful verified computation is cached; conflicts are still returned and rejected at gates. Returned values are copied. Expiry or a cold process recomputes normally.

The decode cache retains at most 128 technical receipts/tracked in-flight entries for five minutes, with an explicit decoder policy namespace. It retains no image bytes. Every caller supplies actual bytes, copied and hashed before asynchronous work. It never stores failed decodes, semantic judgments, approvals or evidence mapping conclusions.

No database migration, environment change or extra paid infrastructure is needed. Persistent jobs and receipts keep their schemas. The previous application commit `c83390d154b4c15d52f5c29dd7d9fec012ecf8e4` remains a test-service rollback target. Use the prior test kit after rollback because the new kit also tests optional batched lookup.

## What requires separate creative validation

Further savings may come from reviewed stage/slot rule selection, retained cross-stage context, reference ranking, finer revision dependencies or browser reuse. These are not enabled by this pass: they can change information available to creative work, evidence freshness, rendered pixels or the amount of work retried. Unknown rule scope remains visible. Compiler/package freshness is not replaced by a TTL cache. Research is not reused across jobs without a verified source/version/permission/freshness contract.

The acceptance target is a completed, EO-passing Onepage with the full workflow—not a small individual response. Keep the same model, effort, image settings, source packet, brief and reference access in comparisons. Include three brands, GTK/FAQ, human imagery, multiple artworks, revision and interrupted resume. Count every attempt, fallback and regeneration. Measure available input/output/reasoning/cached tokens, tool calls, bytes, wall time and cost, and retain null when the provider does not expose them.

Existing regression tests and local synthetic benchmarks prove technical invariants and eliminate repeated computation. They do not prove creative non-inferiority or full Onepage speed. The blinded 36-run protocol remains prepared but unexecuted; paid generation and production rollout still require their separate authorization. The previous workspace403 has not been bypassed or retried; live protocol verification is not a claim of actual GPT connection.
