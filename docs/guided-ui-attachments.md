# Guided UID interface and attachment contract

## Scope and compatibility

This patch builds on the approval-flow patch. The Render endpoint, canonical resolver, Onepage compiler, training proposal semantics, UI resource URI (`ui://uid-brands/workflow-v2.html`), MIME, and existing tool names stay unchanged. No database migration, credentials, deployment settings, public uploads, or persistence service were added.

The visible path is Brief → Content → Assets → Đóng gói. Each view shows the current step, missing information, the primary next action, and task/version when available. The current review contract prefers complete plain-text `result_content` above the actions, plus optional accessible result links and plugin-authorized image previews; `result_summary` remains a legacy fallback. Original files and images remain attached in the conversation. See result-action-continuation.md. The additive `complete` review stage belongs to the fourth visual step and offers Sửa tiếp / Task mới. It must only be invoked after real packaging artifacts were successfully returned.

The new `ingest_uid_brands_attachment` tool, optional review field, and stage enum addition can require a ChatGPT metadata Refresh. A previously mounted/cached widget is not guaranteed to update immediately. No publication or refresh was performed by this implementation.

## Truthful state and drafts

- Actions without additional input send on one click. Feedback/Train open their editor and send only on its explicit submit.
- A pending host send is “Đang gửi…”. An accepted send is “Chờ phản hồi / Chờ kết quả mới từ ChatGPT”. Neither claims generation has started or finished.
- Per-file uploading/reading/ready/error labels correspond to actual upload, parsing, or validation promises. There are no simulated percentages, execution timers, or server-job statuses.
- Exact successful requests are suppressed locally, including attachments. Failed sends keep inputs. A downstream failure needs the existing explicit `retry_id` flow, never automatic replay.
- Brief values, review text, group feedback, selection, and ready attachment references persist through structured host state. Edits save synchronously without rebuilding the focused input. Feedback/Train and Back preserve the same review draft; new task/version scopes do not inherit stale feedback.
- Local File objects and blob/download URLs are not persisted. Interrupted uploads require explicit re-selection after reload. Local persistence remains best-effort host persistence, not an authenticated cross-device task database.

## File routes

Application limits: six files per brief/review scope; PNG/JPEG/WebP/GIF images up to 10 MiB; UTF-8 TXT/MD/CSV/JSON documents up to 1 MiB. PDF/DOCX and other formats are explicitly unsupported. Document excerpts are limited to 16,000 UTF-16 characters with a truncation marker in the UI, prompt, and model state.

1. Local images: user paste/drop/picker → `uploadFile(File)` → returned file ID → structured `setWidgetState({modelContent, privateContent, imageIds})` before the explicit follow-up. Local blob thumbnails show immediately. Readiness means uploaded and registered for model visibility, not proof the model inspected pixels.
2. Local text documents: user file → host upload for file ID → bounded local byte read → fatal UTF-8 decoding and format validation → excerpt included as untrusted evidence in model state and the explicit follow-up. No remote URL or ingestion service is needed for this path. JSON and CSV syntax are checked; disguised binary/markup/control characters are rejected. No source content is executed.
3. ChatGPT Library files: feature-detected `selectFiles()` → its authorized file ID → fresh `getFileDownloadUrl()` → `callTool('ingest_uid_brands_attachment', {file: {download_url, file_id, mime_type, file_name}})`. The server extracts supported documents or validates basic image signatures/size. Library images then use `imageIds`; signature validation is not pixel decoding or model inspection.

`sendFollowUpMessage` receives only the documented prompt field. File IDs in prose are not represented as transferred bytes. Documents never enter `imageIds`. Every subsequent state write preserves the structured envelope. Files are not automatically saved to Library, and none of these paths uses the existing public feedback image store.

The official optional file APIs, required/optional file-object fields, and image-state mechanism are documented in the [OpenAI reference](https://developers.openai.com/plugins/reference#file-apis) and [image visibility guide](https://developers.openai.com/plugins/build/chatgpt-ui#make-images-visible-to-the-model). Helpers are capability-detected; actual host integration still requires validation.

## Remote ingestion release gate

The server is deliberately disabled for remote/Library downloads by default. OpenAI's public contract does not specify a stable download-origin allowlist or a URL-signature format. An operator must independently verify the actual host-issued HTTPS download origins and obtain approval before configuring the exact comma-separated `UID_ATTACHMENT_ALLOWED_ORIGINS` value. No wildcard domains, guessed CDN list, or unreviewed environment change is included.

Until that is configured, the UI clearly explains that Library reading is unavailable and offers local file selection. Local supported images and text files do not depend on this setting.

The downloader rejects non-HTTPS URLs, IP literals, credentials, fragments, nonstandard ports, unknown origins, missing capability queries, redirects, private/reserved or mixed DNS answers, compression, oversize streams, invalid content, and timeouts. It pins the checked public IPv4 address while preserving TLS hostname verification and forwards no credentials. IPv6-only origins intentionally fail closed. Trusted-origin capability validation remains the origin's responsibility; this implementation does not claim to cryptographically verify OpenAI signatures or ownership from a file ID. Nothing is stored or looked up by an arbitrary user-supplied owner/task ID.

The tool returns no temporary URL or persistent object ID beyond the original file reference, and redacts transport failures. Documents and filenames remain untrusted source data. There is no durable task/attachment registry requiring ownership access controls. Introducing such a registry later requires authenticated identity, ownership enforcement, and a separately approved design.

## Verification and release checklist

Automated tests execute the real embedded script with a serializing host stub; cover guided steps, all action stages, duplicate/late sends, Train then packaging, exact-version drafts, empty-input preservation, file routing, thumbnails, removal/retry races, capability failure, byte/format limits, truncation, remote SSRF defenses, and live local MCP discovery/schema parity.

Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`. These checks do not prove actual ChatGPT permissions, file visibility, image generation, training, or packaging success.

Before release, validate in a real ChatGPT host:
- Refresh discovery and reopen the widget; retain old resource compatibility.
- Sustained typing keeps focus and latest text survives reload/Back/mode changes.
- Paste an image while preserving normal text paste; drop/pick mixed supported files.
- Confirm model sees the registered image and only the validated text excerpt.
- Verify Library selection, configured exact file origin, expired reference recovery, and denied capability behavior.
- Check narrow/mobile layout, thumbnails under host CSP, accessible controls, and actual host message authorization.
- Verify content revision → approval → asset review → Train → packaging → complete → Sửa tiếp / Task mới with real tools/deliverables.

Local Chromium visual validation was attempted with the installed browser, including a reviewed elevated attempt, but the environment rejects Chromium's local Unix socket. No visual/real-host pass is claimed.
