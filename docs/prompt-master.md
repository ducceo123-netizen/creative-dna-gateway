# UID Brands Prompt Master

Current interaction contract (14 October 2026): keep the embedded selector and existing asset/group multi-selection. The panel only prepares editable text. It does not send a follow-up, start generation, submit Train, package assets, or display live execution status.

## User flow
1. Select brand/material or choose a review action.
2. For Feedback/Train, expand the relevant sections; select individual assets or whole sections. Create a shared-feedback group and enter its feedback. Train remains a distinct explicit selection.
3. Choose **Tạo prompt**, review/edit the prepared text, then **Sao chép prompt**.
4. Paste into the conversation, attach original reference files/images if needed, and press the chat Send button.
5. Read actual results and next steps in chat. Open the panel when asset/group selection is needed or explicitly requested, not automatically after every outcome.

Copied means clipboard success only. If browser clipboard access fails, the prompt is expanded and selected for Ctrl/Cmd+C. A copied prompt is not proof of delivery or execution. The model should reconcile previously completed operations before replaying a repeated pasted command.

## Scope and safety
- Exact task/version/retry and real asset IDs stay in prepared prompts. Correlation does not authenticate or authorize a user.
- Removed asset IDs block new prompt preparation; existing feedback is kept so the user can remap it.
- New outcome/source edits invalidate stale prepared prompts. Edited prompt drafts are private, bounded to three source bindings of at most 64,000 characters, and restored only for the exact binding.
- Saving drafts is best effort and never required to copy. If the host cannot save, keep the panel open and copy text before leaving.
- No prompt/feedback/document excerpts/image IDs are published to model-visible widget state before manual sending. Uploaded reference IDs alone do not make images visible; attach original images in chat.
- Document excerpts in prepared prompts are capped at 4,000 characters per file, explicitly flagged when truncated. Never claim that an excerpt constitutes full document inspection.
- Clipboard writes are serialized across task/version changes. Late clipboard completion never labels a newer prompt as copied.
- Full creative outcomes and original files remain in chat. The compact panel has a collapsed, bounded preview; it is not a substitute for the actual outcome.

## Verification
Deterministic embedded-script tests cover multi-selection, section grouping, Vietnamese IME/focus retention, exact-scope prompts, edited-draft persistence, copy/fallback/concurrency, no-auto-send, missing-target handling, and route refresh. These are not real ChatGPT iframe acceptance tests. No claim that this change fixes ChatGPT conversation loading or streaming is supported without live host evidence.
