# UID flow conflict audit

## Verified scope

Read-only GitHub main verification on 2026-10-14 returned PR80 merge `c402e52f21df3c012935ccc484633a5861feb803`. The starting local tree is byte-equivalent `6f0ba77f92263684499a15ffac0bfe26b5655686`. Changes are confined to gateway retry classification, widget navigation and orchestration wording. No checkpoint activation, account, policy, database or provider changes.

## Reproduced and repaired

1. **Quality rejection retried as an outage.** A valid HTTP 200 payload containing `ok:false` or `error` became status 502, triggering a second read request. The regression failed with two calls before this patch. Retry eligibility now requires an actual non-success HTTP response. Semantic failure remains failure, and quality/research/readiness/issues diagnostics are preserved. Transient 429/502/503/504 reads still have the existing bounded retry budget; writes remain at most once.
2. **Usable degraded launcher rejected by navigation.** Task mới rejected `isError:true` even when the server explicitly supplied a prepared launcher and only route lookup failed. The widget now accepts only the narrow prepared/degraded launcher response with route operation and route array; it shows fallback choices and the route warning. Generic errors, denied calls and malformed responses still preserve the prior outcome and report failure. The server's true error flag is unchanged.
3. **Late navigation overwrote a newer presentation.** Task and version checks alone did not protect a new result/receipt under the same review identity. Both navigation success and failure now require the original presentation fingerprint to remain current. A newer visible outcome is preserved.
4. **Stale route choices appeared current.** An explicit empty route response after earlier healthy routes retained those choices without a fallback warning. Explicit route arrays now replace the list with valid entries or the labeled Onepage fallback and reset route status consistently.
5. **Renderer/fallback wording conflict.** Initialization required direct launcher use while native-workflow guidance encouraged a native-preferred probe and generalized any tool failure into fallback. The compatibility tool now states it does not render controls or establish host capability; ordinary flows call the registered UI directly. Route degradation alone is explicitly not evidence of rendering failure. Existing native-capable host compatibility remains available.

## Verification

- Before fixes: all three newly added behavioral reproduction tests failed against the live-equivalent baseline.
- Full final suite: 635 tests passed, no failed/skipped tests.
- TypeScript check and production build passed.
- All nine discovered descriptor tool names, input/output schemas and annotations match the baseline.
- Independent reviewer: no blocking findings; three additional UI edge cases and ten HTTP/read-write combinations passed. Stale-route warning feedback was fixed and rechecked.
- `git diff --check` passed.

## Limits and live acceptance

These are verified gateway/UI bugs that can cause redundant work, misleading failure messages or replaced panels. They are not proof of the cause of a ChatGPT-native disconnection, inability to load a conversation, or a host stream interruption. The existing stateless MCP handler and bounded deadlines remain unchanged. Full research/quality gates, unknown-outcome dedupe, original feedback drafts and artifact handling are preserved.

Actual ChatGPT rendering, original native worklog placement, browser/IME and a live member click sequence are not verified by deterministic DOM tests. Native Chromium launch is blocked by the environment; no bypass was attempted. After deployment, verify exact deployed commit/tool contracts/widget bytes, then check a fresh ChatGPT panel through content approval, feedback, packaging and Task mới. Do not replay a write whose outcome is unknown. Retain scoped route warnings and confirm new result actions visibly render.
