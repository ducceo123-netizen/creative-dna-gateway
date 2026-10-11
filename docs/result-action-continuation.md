# Result-first UID action flow

## Problem and supported fix

The earlier widget received only a summary. Complete results were written in a later assistant message, so the host could place the action panel before the result. CSS inside the widget cannot change its position in the host conversation.

The review tool now accepts the complete text in `result_content` (maximum 120,000 characters). The widget renders that exact text with `textContent`, followed by optional image previews and result links, then action controls. There is no nested summary scroll area or truncation within accepted text. `result_summary` is only a backward-compatible fallback; when full content is absent, the widget clearly directs the user to the complete conversation result. Never call a teaser a complete result.

When the widget holds the complete text, a brief assistant caption suffices instead of repeating that same long text below the actions. Original generated images and downloadable files must still be attached in the conversation. No original artifact is removed, replaced, or hidden by this change.

`result_links` accepts up to 40 named, HTTPS, credential-free URLs. Callers must supply real user-accessible delivery links, not guessed URLs, private Library download URLs, or sandbox paths. The widget uses text labels and safe external links, never remote HTML.

`result_images` accepts up to 24 real plugin-authorized host file IDs and labels. The widget requests fresh URLs with the feature-detected `getFileDownloadUrl` bridge. IDs must already be authorized through host upload, selection, file params or tool file references; mentioning a generated-image ID is not an access grant. URLs are kept only in image nodes, never written to widget state. Missing access, missing capability, expired/unsafe URLs and image-load failures keep a labeled fallback to the original conversation attachment. No new upload, public storage, CSP allowlist or authentication permission is introduced.

## One click and direct navigation

- Chốt content và tạo assets, Tạo phương án khác and Đóng gói submit their precise task/version-bound request on one click. They do not first select an option and expose another Send button.
- Feedback/Train open their editor. Editing and choosing targets never submits; one explicit send submits the completed feedback.
- Pending requests lock actions. Exact successfully sent requests stay consumed across supported remounts. Different actions and changed feedback remain available. A failed send retains the draft and allows an explicit retry; a verified downstream failure uses a fresh `retry_id`, without auto-replay.
- At delivery, Sửa tiếp and Task mới directly invoke the registered read-only review/launcher tools through `callTool` when supported. A denied/failed call remains a visible retryable error; it does not silently switch to a model prompt. Hosts without `callTool` keep the existing explicit follow-up fallback.
- Task mới rotates the local brief identity, allowing a new task with reused draft fields without inheriting the old successful-send lock.
- Direct navigation includes `navigation_id`, which the server echoes. This is correlation only. Navigation-marked globals events are ignored; only the guarded callTool result is applied. A late result/event cannot replace a newer review. Ordinary model-driven calls omit that field and still update normally.

## Conversational continuation and limits

Click prompts now contain the selected command and exact task/version/action, without repeated authentication warnings or an instruction to ask for confirmation. One shared initialization contract replaces duplicated, conflicting review guidance. When the host establishes the required authorization and the requested revision/inputs are available, execute the action rather than ask a conversational “Do you want me to proceed?” again.

This does not bypass host permissions. `sendFollowUpMessage` is a component-authored message, not an authenticated approval API or an execution receipt. `callTool` can call only registered tools; this gateway still has no asset-generation or packaging executor, durable job store, or new approval endpoint. Deterministic server-owned generation would require a separately designed, authenticated execution service. Do not infer such execution from sent status.

The source of these bridge/file boundaries is the [OpenAI UI reference](https://developers.openai.com/plugins/reference) and [UI integration guide](https://developers.openai.com/plugins/build/chatgpt-ui).

## Compatibility and release checks

The existing tool names, resource URI, Render service, quality contract, private reference library, database and credentials remain unchanged. New fields are optional, and old tool callers remain valid. The launcher now explicitly returns `stage: "launcher"`. Launcher and review tools advertise documented app visibility plus the compatible `openai/widgetAccessible` flag for their existing read-only handlers. Cached schemas/widgets may require a host metadata refresh and reopening; deployment alone does not prove those caches changed.

Run `npm test`, `npm run lint`, `npm run build` and `git diff --check`. Tests execute the real widget script with a stub DOM/bridge and exercise local HTTP MCP schema/metadata/results. They cover complete-result order, exact text/XSS safety, safe links, missing images, signed-URL non-persistence, single-click actions, feedback, double clicks, remounts, failures, fresh tasks and both late navigation promises and globals events.

Real-host acceptance must separately verify:

1. Refresh metadata and open a new review with complete content; confirm visible result-before-actions at desktop and mobile widths.
2. Click Chốt once with a sufficient approved brief; verify actual generation rather than a conversational re-confirmation.
3. Revise content/assets, submit Train, package, then use Sửa tiếp and Task mới.
4. Verify original attachments, authorized previews under the actual CSP, safe links and genuine host permission behavior.
5. Check old cached/legacy review behavior, rejected calls, retry and a newer revision arriving during a pending action.

Local Chromium was attempted with the installed browser, including a reviewed elevated run; this environment denied Chromium's local Unix socket. No browser-layout or real-ChatGPT pass is claimed from that attempt.
