# UID Brands progress visibility

## Boundaries

This gateway supplies communication guidance and supported tool-call labels. It does not create a backend job ledger, inspect private reasoning, or control the host-native activity pane. A tool call ending does not establish task success. A widget send being accepted establishes only transport receipt; unknown sends stay unknown until reconciled.

`uid-brands-progress.ts` owns one progress contract. It is included early in MCP initialization, with a compact reminder once in each model-visible tool result and brief/review continuation request. The native workflow retains its existing draft-preservation/status contract. Tool discovery and registration use the same metadata helper. Existing payloads, first content item, input/output schemas, annotations and recovery details are preserved. No Supabase Edge or compiler/pin update is required.

## Communication rules

- Before an actual operation, briefly say what is about to run. Do not imply it already ran.
- After a verified milestone, say what was established and what comes next. Do not narrate every internal step or repeat unchanged status.
- For partial work, distinguish done / pending / blocked and give the next concrete action. Use the user's language; these are conversational labels, not a new server status API.
- Research-before-output applies to creative deliverables. Progress may be communicated while research is incomplete; this never permits unsupported creative claims or bypasses source, media, quality, canonical or approval gates.
- Slow or uncertain operations get factual status only. Preserve returned recovery instructions and never replay an uncertain write. Do not invent a percentage, countdown, ETA, completed assets or hidden job state.
- Continue a host-authorized action without redundant confirmation. Correlation fields and component-authored prompts remain insufficient to establish permission.

Examples, usable only when the described evidence actually exists:

- Before research: “Mình sẽ kiểm tra PDP và các nguồn liên quan trước khi viết content.”
- Partial research: “Đã đọc mô tả và thông số PDP. Chưa truy cập được phần reviews; mình sẽ kiểm tra nguồn khác và giữ rõ giới hạn bằng chứng.”
- Partial assets: “Đã tạo Banner desktop. Ảnh Detail đang bị chặn vì thiếu ảnh tham chiếu đúng sản phẩm; bước tiếp theo là bổ sung ảnh đó.”
- Uncertain Train submission: “Chưa xác nhận đề xuất đã được lưu. Cần kiểm tra Pending queue trước khi gửi lại.”

## Tool-call labels

Every one of the nine registered tools has `openai/toolInvocation/invoking` and `openai/toolInvocation/invoked`, each at most 64 characters. Invoking labels describe the tool operation, not downstream generation. Invoked labels use neutral “call ended” wording so errors, missing research and uncertain submissions cannot appear as completed creative work.

Official references:
- [Tool descriptor metadata](https://developers.openai.com/plugins/reference)
- [MCP server instructions and model-visible results](https://developers.openai.com/plugins/build/mcp-server)

## Adoption and verification

Live result/continuation guidance is available on subsequent calls without depending solely on cached tool descriptions. Host rendering and existing-thread adoption are not guaranteed. For an existing custom MCP connection, refresh its metadata and test in a new conversation. Published hosted-tool changes may require the platform's scan/review flow. Do not promise that deploying forces a native worklog or requires every user to reinstall.

Automated checks cover discovery/runtime metadata parity and length, model-visible guidance, normal/failed/slow/partial results, research gate preservation, one-click continuation, read-only reconciliation, and accepted/unknown transport semantics. They do not prove that a real ChatGPT session will phrase or display every update as intended. After authorized deployment, test a fresh and an existing connection with a complete brief, research blocker, content approval, asset revision, packaging and uncertain Train result.

Run `npm test`, `npm run lint`, and `npm run build`. The baseline `bun.lock` still lists the old SDK dependency while `package.json` uses the split MCP server/node packages, so a frozen Bun install fails before this change. This patch intentionally leaves the seven pinned compiler-source files and bundle unchanged; dependency/lock reconciliation is a separate reviewed change.
