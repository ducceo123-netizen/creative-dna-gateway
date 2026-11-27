# Onepage Lean V2 — isolated experiment

No production entrypoint imports these files. No deployment, MCP registration, database, or canonical rule change is required. Run offline on authorized compiler response JSON; do not commit private research snapshots or credentials.

## Test locally
```sh
npm ci
node --import tsx --test experiments/onepage-lean/lean-packet.test.ts
node --import tsx experiments/onepage-lean/benchmark.ts /path/to/compiled-job.json
```
Capture compiler packets using the existing authorized read-only compiler, save locally, and run the benchmark. It reports UTF-8 bytes, not tokens; actual model usage must be measured at the inference boundary.

## Observed live-packet structural benchmark (2026-11-27)
Equivalent deduplication algorithm tested against read-only initialization packets in ChatGPT; repository TypeScript test execution is not yet attested.
| Brand | JSON chars original | compact | reduction |
|---|---:|---:|---:|
| PawfectHouse | 332848 | 205465 | 38.27% |
| GiftSoul | 325695 | 198312 | 39.11% |
| SoulPrise | 326230 | 198847 | 39.05% |

All three restored structurally identical; 23 execution steps, 19 asset slot definitions, 12 hard gates preserved. This is not creative parity or inference-token proof.

## Next gate
Keep the legacy compiler unchanged. Add a read-only stage retrieval adapter with pinned revision and full-packet fallback before testing model behavior. Do not send restored full packets to the model and claim savings. Verify aliases are understood or fetched, retain unknown/conflicting rules, and test real PDP/collection inputs plus research resubmission. Only then perform blinded A/B creative review and compare actual input/output tokens and tool calls. No merge or deployment without owner approval.
