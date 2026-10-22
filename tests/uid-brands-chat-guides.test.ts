import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatBrief, buildChatReview } from "../uid-brands-chat.ts";
import { REVIEW_INPUT_SCHEMA, createReviewContext } from "../uid-brands-review-contract.ts";
const base = { stage: "asset_review", task_id: "private-task-39", content_version: "private-revision-53", assets: [
  { id: "private-a-11", name: "Ảnh đầu trang", section: "Hero" },
  { id: "private-b-72", name: "Ảnh sản phẩm", section: "Gallery" },
] };
function guide(overrides: object = {}) {
  const input = REVIEW_INPUT_SCHEMA.parse({ ...base, ...overrides });
  return buildChatReview(input, createReviewContext(input));
}
test("brief guide is readable and never dispatches", () => {
  const result = buildChatBrief();
  assert.match(result.text, /Bước 1/);
  assert.match(result.text, /phần còn thiếu/);
  assert.ok(result.next_actions.every(a => a.execution === "not_dispatched"));
});
test("asset guidance uses a complete numbered section list without internal IDs or repeated content approval", () => {
  const result = guide();
  assert.match(result.text, /Nhóm: Hero\n1\. Ảnh đầu trang/);
  assert.match(result.text, /Nhóm: Gallery\n2\. Ảnh sản phẩm/);
  assert.doesNotMatch(result.text, /private-|task_id|content_version|asset_id|chốt content/i);
  assert.deepEqual(result.next_actions.map(a => a.action), ["feedback", "package"]);
  assert.equal(result.guide_data.review_index?.task_id, base.task_id);
  assert.ok(result.next_actions.every(a => a.execution === "not_dispatched"));
});
test("stage-specific guidance keeps approval at content and verifies packaging prerequisites", () => {
  const content = guide({ stage: "content_approval", assets: undefined });
  assert.deepEqual(content.next_actions.map(a => a.action), ["revise", "regenerate", "approve"]);
  const packaging = guide({ stage: "packaging", workflow_state: { status: "ready" } });
  assert.deepEqual(packaging.next_actions.map(a => a.action), ["package"]);
  assert.match(packaging.text, /không chứng minh research\/QC đã đạt/);
  assert.match(packaging.next_actions[0].command, /CRC.*ZIP thật/);
});
test("missing identity or inventory returns recovery rather than editable placeholders", () => {
  for (const overrides of [{ task_id: undefined }, { assets: undefined }, { assets: [{ name: "Unknown" }] }]) {
    const result = guide(overrides);
    assert.deepEqual(result.next_actions.map(a => a.action), ["recover_context"]);
    assert.match(result.next_actions[0].command, /Cho tôi xem lại kết quả/);
    assert.doesNotMatch(result.text, /Asset IDs|task_id|\[số thứ tự\]/);
  }
});
test("blocked, failed, and in-progress states never offer generation, package or retry writes", () => {
  for (const status of ["blocked", "failed", "in_progress"]) {
    const result = guide({ workflow_state: { status, message: "Thiếu ảnh gốc của mục đầu trang" } });
    assert.match(result.text, /Thiếu ảnh gốc của mục đầu trang/);
    assert.deepEqual(result.next_actions.map(a => a.action), [status === "in_progress" ? "check_status" : "inspect_blocker"]);
  }
});
test("separate feedback blocks preserve separate readable scope and full mapped instructions", () => {
  const index = guide().guide_data.review_index!;
  const result = guide({ feedback_request: { index_id: index.index_id, blocks: [
    { ordinals: [1], text: "Tăng khoảng trắng" }, { group_names: ["Gallery"], text: "Đổi nền thành màu kem" },
  ] } });
  assert.equal(result.guide_data.feedback_resolution?.ok, true);
  assert.match(result.guide_data.scope_echo!, /Góp ý 1.*1\. Ảnh đầu trang\nNội dung: Tăng khoảng trắng/);
  assert.match(result.guide_data.scope_echo!, /Góp ý 2.*2\. Ảnh sản phẩm\nNội dung: Đổi nền thành màu kem/);
  assert.doesNotMatch(result.text, /private-|feedback:/);
});
test("stale or ambiguous feedback yields clarification only", () => {
  const result = guide({ feedback_request: { index_id: "old-index", blocks: [{ ordinals: [1], text: "Đổi nền" }] } });
  assert.equal(result.guide_data.feedback_resolution?.ok, false);
  assert.deepEqual(result.next_actions.map(a => a.action), ["recover_context"]);
  assert.match(result.text, /Chưa xác định chắc chắn phạm vi/);
});
test("complete does not invent delivery and supplied images remain references", () => {
  const absent = guide({ stage: "complete" });
  assert.match(absent.text, /Chưa có tệp hoặc link bàn giao/);
  assert.equal(absent.next_actions[0].action, "recover_delivery");
  const supplied = guide({ stage: "complete", result_links: [{ label: "Bản giao", url: "https://example.com/actual.zip" }], result_images: [{ file_id: "image_123", label: "Ảnh gốc", asset_id: "private-a-11" }] });
  assert.match(supplied.text, /https:\/\/example.com\/actual.zip/);
  assert.match(supplied.text, /tham chiếu không xác nhận đã đính kèm thành công/);
  assert.doesNotMatch(supplied.text, /image_123|chốt content/i);
});
test("all 100 selectable entries are listed even with long labels", () => {
  const result = guide({ assets: Array.from({ length: 100 }, (_, i) => ({ id: `asset-${String(i).padStart(3, "0")}`, name: "Tên ".repeat(49), section: "Hero" })) });
  assert.equal(result.guide_data.review_index?.entries.length, 100);
  assert.equal(result.text.split("\n").filter(line => /^\d+\. /.test(line)).length, 100);
  assert.match(result.text, /100\. /);
});
test("mapped edits do not introduce a second apply or confirmation gate", () => {
  const index = guide().guide_data.review_index!;
  const result = guide({ feedback_request: { index_id: index.index_id, blocks: [{ ordinals: [1, 2], text: "Tăng khoảng trắng" }] } });
  assert.equal(result.guide_data.feedback_resolution?.ok, true);
  assert.deepEqual(result.next_actions, []);
  assert.equal(result.guide_data.execution_guidance?.mapping_is_authorization, false);
  assert.equal(result.guide_data.execution_guidance?.execution, "not_dispatched");
  assert.match(result.guide_data.execution_guidance!.instruction, /original authenticated user message/);
  assert.match(result.guide_data.execution_guidance!.instruction, /Do not require a new confirmation/);
  assert.doesNotMatch(result.text, /Áp dụng từng góp ý|Danh sách để góp ý \(chưa chọn mục nào\)/);
});
test("group example preserves select-many then another instruction and explicit group exclusion", () => {
  const result = guide({ assets: [
    { id: "a", name: "Đầu trang", section: "PD" },
    { id: "b", name: "Chi tiết", section: "PD" },
    { id: "c", name: "Kết trang", section: "PD" },
    { id: "d", name: "Ảnh vuông", section: "Gallery" },
  ] });
  assert.match(result.text, /Cả nhóm “PD” trừ mục 3 \(mục cuối nhóm trong danh sách này\): tăng khoảng trắng; mục 4: giảm cỡ chữ tiêu đề/);
  assert.match(result.text, /không tự phân tích hay thực hiện câu chat/);
});
test("group exclusion keeps separate instructions and echoes only final included scope", () => {
  const assets = [
    { id: "a", name: "Đầu trang", section: "PD" },
    { id: "b", name: "Chi tiết", section: "PD" },
    { id: "c", name: "Kết trang", section: "PD" },
    { id: "d", name: "Ảnh vuông", section: "Gallery" },
  ];
  const index = guide({ assets }).guide_data.review_index!;
  const result = guide({ assets, feedback_request: { index_id: index.index_id, blocks: [
    { group_names: ["PD"], exclude_ordinals: [3], text: "Tăng khoảng trắng" },
    { group_names: ["Gallery"], text: "Giảm cỡ chữ" },
  ] } });
  assert.equal(result.guide_data.feedback_resolution?.ok, true);
  if (result.guide_data.feedback_resolution?.ok) {
    assert.deepEqual(result.guide_data.feedback_resolution.blocks.map(b => b.ordinals), [[1, 2], [4]]);
  }
  assert.match(result.guide_data.scope_echo!, /Góp ý 1.*1\. Đầu trang; 2\. Chi tiết\nNội dung: Tăng khoảng trắng/);
  assert.match(result.guide_data.scope_echo!, /Góp ý 2.*4\. Ảnh vuông\nNội dung: Giảm cỡ chữ/);
  assert.doesNotMatch(result.guide_data.scope_echo!, /3\. Kết trang/);
  assert.deepEqual(result.next_actions, []);
});

test("Onepage outcome directs feedback to live preview, never the retired tab", () => {
  const url = "https://uid-brands-gateway-preview.onrender.com/onepage-panel.html";
  for (const stage of ["content_approval", "asset_review", "packaging", "complete"] as const) {
    const result = guide({ stage, branch: "onepage-system" });
    assert.ok(!result.text.includes(url));
    assert.match(result.text, /preview thực tế.*chọn ảnh.*sao chép prompt.*dán và gửi vào chính cuộc trò chuyện này/);
    assert.match(result.text, /góp ý trực tiếp trong chat/);
    assert.doesNotMatch(result.text, /vercel\.app/);
    assert.equal("external_panel" in result.guide_data, false);
    assert.doesNotMatch(result.text, /tab Feedback|Góp ý tổng thể/);
  }
  const content = guide({ stage: "content_approval", branch: "onepage-system", assets: undefined });
  assert.match(content.text, /góp ý câu chữ trực tiếp/);
  assert.match(content.text, /Chỉ chọn vị trí ảnh khi ảnh đó thực sự đã được tạo/);
  assert.match(guide({stage:"packaging", branch:"onepage-system"}).text, /không kiểm tra QC hay ZIP/);
  const brief=buildChatBrief();
  assert.match(brief.text,/Chọn Brand và Material/);
  assert.match(brief.text,/chính chat này/);
  assert.ok(brief.text.includes(url));
});
