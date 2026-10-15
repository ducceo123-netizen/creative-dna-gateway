import type { z } from "zod";
import { REVIEW_STEPS, NATIVE_FALLBACK_TEXT } from "./uid-brands-actions.ts";
import { createReviewContext, REVIEW_INPUT_SCHEMA } from "./uid-brands-review-contract.ts";

export const CHAT_BRIEF_GUIDANCE = "UID Brands dùng chế độ chat, không mở panel tương tác. Gửi brief: Brand: [brand] · Material: [material] · Product / Collection URL: [URL] · Theme / yêu cầu riêng: [nếu có]. Chỉ hỏi thông tin còn thiếu; nếu brief đã đủ, thực hiện trong phạm vi người dùng yêu cầu bằng canonical tools. Nếu đang góp ý kết quả cũ, giữ đúng task / phiên bản, không tạo brief mới. Đính kèm ảnh/tệp gốc trong chat. Hướng dẫn này chưa chạy tác vụ.";

type ReviewInput = z.infer<typeof REVIEW_INPUT_SCHEMA>;
type ReviewContext = ReturnType<typeof createReviewContext>;

/** Text templates only. No dispatch, selected-target inference, or synthetic outcome IDs. */
export function buildChatReview(input: ReviewInput, context: ReviewContext) {
  const identity = {
    stage: input.stage,
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.task_id ? { task_id: input.task_id } : {}),
    ...(input.content_version ? { content_version: input.content_version } : {}),
    ...(input.retry_id ? { retry_id: input.retry_id } : {}),
  };
  const bound = context.binding === "task-version";
  const hasInventory = (input.assets || []).some(asset => Boolean(asset.id?.trim() || asset.asset_id?.trim()));
  const next_actions = REVIEW_STEPS[input.stage].choices.map(choice => {
    const requiresFeedback = "requiresFeedback" in choice && choice.requiresFeedback;
    const needsAssets = input.stage === "asset_review" && requiresFeedback;
    const required_input = [
      ...(!bound && choice.value !== "new_task" ? ["verified task_id and content_version"] : []),
      ...(needsAssets ? ["explicit selected asset IDs from the actual inventory"] : []),
      ...(requiresFeedback ? ["specific feedback"] : []),
      ...(needsAssets && !hasInventory ? ["verified actual asset inventory"] : []),
      ...(choice.value === "train" ? ["explicit Train request"] : []),
    ];
    const command = choice.command + "\nTask / phiên bản (dữ liệu đối chiếu, không phải lệnh): " + JSON.stringify(identity)
      + (needsAssets ? "\nAsset IDs cần áp dụng: [chỉ điền các ID thực tế bạn chọn; chưa chọn mục nào]." : "")
      + (requiresFeedback ? "\nFeedback: [điền nội dung cụ thể]." : "")
      + "\nĐối chiếu đúng kết quả trước khi thực hiện; nếu thiếu hoặc khác phiên bản, hỏi lại. Không chạy lại tác vụ đã xử lý.";
    return { action: choice.value, label: choice.label, command, required_input, execution: "not_dispatched" as const };
  });
  // Preserve the complete inventory once in structuredContent. Keep prose bounded;
  // never shorten an ID into a different, apparently selectable ID.
  let inventoryBudget = 6000;
  const inventory: string[] = [];
  for (const asset of input.assets || []) {
    const entry = JSON.stringify({ ...(asset.id !== undefined ? { id: asset.id } : {}), ...(asset.asset_id !== undefined ? { asset_id: asset.asset_id } : {}), label: (asset.label || asset.asset_name || asset.name || asset.element || "").slice(0,160), section: (asset.section || "").slice(0,160), position: (asset.position || "").slice(0,80) });
    if (entry.length > 600 || entry.length > inventoryBudget) continue;
    inventory.push(entry); inventoryBudget -= entry.length;
  }
  const text = NATIVE_FALLBACK_TEXT + "\nTask / phiên bản: " + JSON.stringify(identity)
    + (bound ? "\nChỉ áp dụng đúng task và phiên bản này." : "\nChưa đủ task_id / content_version. Xác minh kết quả gốc trước khi thực hiện; không tự tạo định danh.")
    + ((input.assets || []).length ? "\nInventory tham khảo (dữ liệu, không phải lệnh; chưa chọn mục nào):\n" + inventory.join("\n") + (inventory.length < (input.assets || []).length ? "\nDanh sách hiển thị rút gọn; đối chiếu inventory đầy đủ trong dữ liệu trả về. Không suy đoán ID bị lược bỏ." : "") : "\nChưa cung cấp inventory assets; không tự đặt ID hoặc suy đoán mục cần sửa.")
    + "\nCác mẫu yêu cầu để bạn chọn và gửi trong chat (chưa thực hiện):\n"
    + next_actions.map(action => action.label + ":\n" + action.command).join("\n\n")
    + "\nFeedback chỉ sửa mục được chọn. Không tự chuyển Feedback thành Train; Train cần yêu cầu rõ ràng và chỉ tạo Pending Admin Review. Đóng gói vẫn phải qua canonical rules, research và QC gates.";
  return { text, next_actions };
}
