> Historical lifecycle: automatic dispatch/collapse and mandatory result-panel behavior are superseded by [Prompt Master](../prompt-master.md).

# Accepted-send panel lifecycle

## Scope and verified baseline

Source tree `121412f7e5201065f3ada84ff90b3c5b38e89eb7`, matching the published PR79 tree and main release `1e4b68ad62206faa77dca2d1bd15450493365161`. This patch is local only; no push, merge or deploy.

- A successful host follow-up transport collapses the app's own fields/results/actions to a compact, factual sent/waiting status.
- A native disclosure retains the plain-language sent instruction, user feedback and manual read-only recovery controls. The user can reopen the original fields without sending anything.
- Pending, unknown and persistence-failure paths retain visible recovery. A sent receipt is never an execution, progress or completion signal.
- A subsequent genuinely new actionable presentation opens in the widget receiving that output. It does not mutate historical ChatGPT messages or use host DOM access, `requestClose`, fake progress or hidden prompt deletion.
- Presentation identity is separate from action identity. Train's verified receipt can open actions without pretending the asset revision changed or unlocking duplicate Train submissions.
- New presentation state handles an outcome arriving before the old transport acknowledgement and remounts using older saved draft state. Existing feedback text and submitted-request identities are retained.
- Opening an accepted panel manually does not prevent a later distinct accepted action from collapsing it again.

## Next-action rendering contract

The source previously described next actions but did not unambiguously require the registered review tool for each new outcome; the blanket duplicate-panel wording could be read too broadly. This is an identifiable orchestration ambiguity, **not proof of the cause of a particular missing host panel or native chat disconnect**.

The revised shared contract distinguishes one new outcome panel from unchanged-status polling:

| Verified boundary | Review stage |
| --- | --- |
| Initial/revised/regenerated content | `content_approval` |
| Generated/revised assets | `asset_review` |
| Confirmed Pending Admin Review Train receipt, original asset revision retained | `asset_review` |
| Actual returned packaging deliverables | `complete` |

The model must call `show_uid_brands_review` once in that outcome turn unless functional native controls actually rendered. A workflow-description call or text-only action list is not evidence of controls. Use exact task/revision, full actual outcome, real inventory and verified attachments. Uncertain UI-call outcomes require reconciliation, not automatic reissue. Checkpoint preparation, route reads and other intermediate tools are not completed creative outcomes. Interim factual progress/blockers remain permitted and should not wait for final output.

A concise reminder travels with UI follow-ups. No new reminder is appended to every route, template, ingestion or other tool response, avoiding unnecessary repeated instructions. No changes to state-persistence dependencies, authorization, compiler/research gates, schemas or write replay policy are included.

## Verification

- Full suite: 627 passed, no failures or skips.
- TypeScript and production build passed.
- Independent review reproduced and then verified fixes for second-send collapse, early Train outcome and stale-state remount. No remaining blocking finding.
- Regression tests cover compact/expanded receipt, review stages, new brief, revised outcome, echoes/remount, unknown and failed persistence, late send acknowledgement, Train version separation/dedupe, recovery visibility, and retained focus-connected fields. Existing draft/selection/IME model tests remain green.
- `scripts/action-lifecycle-browser-qa.mjs` includes compact receipt and new-outcome/unknown-send scenarios. Real Chromium launch remains blocked by OS socket restrictions, including after approved escalation. No screenshot, browser accessibility, real-device IME or native ChatGPT visual pass is claimed.

## Required live-host acceptance checks

1. Send brief/content approval/content feedback/asset feedback/Train/package through real ChatGPT controls. Verify the old widget compacts only after successful send and retains its accessible receipt.
2. Verify each finished creative turn actually calls the registered review tool once, with correct stage/task/version and complete outcome. Inspect tool success separately from host-visible rendering.
3. Verify the new outcome's actions visibly appear; the prior widget stays compact. Confirm new asset version differs after revision, while Train retains revision with the real proposal receipt.
4. Exercise rejected/unknown sends and missing state support: verify feedback is retained and no automatic resend, replay or fabricated completion occurs.
5. Test narrow viewport, keyboard focus, long Vietnamese feedback and actual IME. Inspect the compact disclosure and recovery accessibility.

The gateway provides UI data; only a real host session can establish ChatGPT's visible panel rendering and placement. This patch cannot force deletion/collapse of native historical tool messages or independently detect completion of ChatGPT-owned generation.
