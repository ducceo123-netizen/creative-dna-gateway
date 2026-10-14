# UID Brands action lifecycle (local implementation)

Base: production source 6a80cf324d5bbf6928aecbf1d0ff91f4a15d34fc, exported independently from the verified clean base. No task-checkpoint code, database migrations, storage/RLS changes, authentication changes or new runtime service are included.

## Minimal architecture

The host owns generation/research and chat rendering. The widget owns a user-visible receipt, draft and transport state; it is not a backend job runner.

1. A click receives immediate local acknowledgement while draft/attachment state is saved.
2. Existing exact task/version/action/payload identity is persisted before dispatch.
3. The transport is attempted once. Success means sent, not received/executing/completed. Timeout or rejected send remains unknown and cannot auto-replay.
4. A per-review activity area retains known transport states even if the user switches to Feedback/Train. Plain-language instructions and user feedback remain visible, saved only in private widget state; the shared session ledger still contains no prompt/feedback content.
5. A read-only reconciliation request or copyable recovery instruction identifies the action without issuing a second write. If the host bridge is absent, the panel explains reopening the original chat; it cannot reconnect or resume a host run.
6. New outcomes arrive via the existing host tool response and exact version contract. The panel does not infer completion from a newer message or invent background progress.

## Route initialization and contradictory notices

Route lookup failure remains `isError: true`, with the original gateway recovery metadata. Responses now separately identify prepared UI data, unverified host rendering and degraded routing. A fallback panel can exist despite a route error. The host must describe the failed stage, and not repeat an earlier launcher error as a current blanket form failure after a valid review response.

The existing launcher can refresh the route list in place through the read-only route tool. It does not call another launcher, does not send a task, preserves entered fields, and ignores stale success/failure after a newer host output. Repeated tool calls may still produce multiple host-rendered panels: the stateless plugin cannot authoritatively deduplicate chat UI renders or remove them. Guidance forbids blind re-opening merely to report status.

## Visible progress contract

Ordinary chat acknowledgements and verified PDP/specification, review, market/comparison and missing-source milestones should stay visible before the final artifact. Long-result deduplication applies only to duplicated creative deliverables, never action acknowledgements or progress. Planned work is distinct from verified work; no timers, percentages, synthetic heartbeat, private reasoning, raw evidence packets or credentials are shown. Host transcript collapse cannot be overridden by this plugin.

## Validation

- Automated suite, TypeScript and production build run against this independent checkout; final counts in the accompanying validation record.
- Regressions exercise feedback, approve and packaging; persistence before send; mode changes/remount; unknown delivery; disconnected bridge; read-only reconciliation; route retry preservation; stale success/failure; failed launcher followed by valid review; visible instruction privacy and persistence.
- `scripts/action-lifecycle-browser-qa.mjs` is a mocked-host desktop/mobile browser test. Browser launch was blocked by OS socket permissions, including the reviewed launch attempt. No browser or live ChatGPT validation pass is claimed.
- No production writes, push, merge, deploy, or checkpoint integration performed.

## Remaining boundaries

Durable authenticated task history and resumable work require a separately authorized backend design. Real AI execution progress must originate from actual host operations; this widget cannot observe it. Gateway already supplies failure request IDs, but this patch does not add a telemetry service or success logging.
