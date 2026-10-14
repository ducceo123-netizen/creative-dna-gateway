> Historical contract: automatic dispatch and mandatory result-panel rules below are superseded by [Prompt Master](prompt-master.md). Retain only unrelated validation, attachment safety and canonical governance requirements.

# UID Brands review contract

## Actions and fallback

`uid-brands-actions.ts` supplies the same choices, labels and commands to the native workflow and embedded review UI. Actions without additional input send on one click. Feedback/Train open their editor and send only on its explicit submit. Asset review supports packaging, task feedback and Pending Admin Review training. The guided-interface extension adds a complete delivery stage with Sửa tiếp / Task mới; invoke it only after actual packaging deliverables exist. See guided-ui-attachments.md for attachment routing and release gates.

Prefer functional host-native controls. If unavailable, call the registered `show_uid_brands_review` during the same outcome turn. Use actionable text only if that UI fails. A new incomplete brief uses `launch_creative_dna`.

The existing tool names, resource URI `ui://uid-brands/workflow-v2.html`, MIME `text/html;profile=mcp-app` and both resource metadata keys remain unchanged. Review/native schemas add optional fields below. Existing callers remain valid, but hosts may need a metadata refresh to discover additions; this does not promise zero refresh.

## Outcome identity and retries

- Supply a stable `task_id` and exact `content_version` together. Change the version after every content rewrite or asset revision. A content hash can be used as the version.
- The response's `review_context` carries those values and a deterministic review ID. Both native and embedded requests must carry this context and the selected action.
- Legacy callers without both fields get a unique unbound review. They remain supported, but cannot provide exact revision binding. If the intended outcome is ambiguous or changed, clarify before acting.
- Successful message sends are deduplicated by review ID, action and feedback payload. Reopening the same outcome does not resubmit it; choosing another action or changing feedback remains possible. A pending send blocks simultaneous actions in that panel.
- A rejected bridge send retains the current feedback and allows retry. If the bridge accepted the message but the actual operation later failed, issue a fresh review with a new `retry_id`. A user-requested retry can also use this field. Keep it stable when merely reopening that retry. The new panel still requires an explicit submit; never replay automatically.

## Guarantees and limits

The gateway does not execute assets/packaging and has no authoritative registry of the current task content. Version binding is correlation for the caller to check, not backend enforcement. These fields and component-authored messages do not authenticate user approval or override the host's confirmation rules. A successful bridge call means only that a request was accepted, not that the operation completed.

Deduplication persists through host widget state and same-tab session storage when those surfaces are available. It is not server-side exactly-once execution, cross-device deduplication or a transaction guarantee. Host persistence failure, separate concurrent panels and downstream execution uncertainty still need the host's normal safeguards.

## Verification

Run `npm test`, `npm run lint` and `npm run build`. CI runs the full test set under Bun. Behavioral tests execute the actual embedded script with a stub DOM/host bridge. MCP integration tests use the local HTTP transport and compare discovery/runtime schemas, resource metadata, actions and context.

Before release, verify in a real ChatGPT host:

1. Initial content and every rewrite expose a functional approval path.
2. Chốt content / Tạo lại / Đóng gói send once on one click, with the exact outcome context. Feedback/Train selection only opens the editor; its submit sends once.
3. Native-unavailable fallback opens the registered panel in the same outcome turn.
4. Feedback, Train, packaging after Train and a failed-operation retry all work with real host authorization.
5. Reload/dismiss/reopen, a new task, and later revisions do not revive stale approvals or leave controls disabled.

See result-action-continuation.md for the complete result-in-widget contract and read-only navigation. Local tests cannot establish ChatGPT outer-message rendering placement, message provenance, approval policy, or actual image generation/training/packaging success.
