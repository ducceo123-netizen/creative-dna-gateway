/** One action contract for native controls and the registered MCP review UI. */
export const REVIEW_STAGES = ["content_approval", "asset_review", "packaging", "complete"] as const;
export const WORKFLOW_STAGES = ["launcher", ...REVIEW_STAGES] as const;

export const REVIEW_STEPS = {
  content_approval: { title: "Content Approval", choices: [
    { value: "approve", label: "Chốt content", submitLabel: "Gửi duyệt content và tạo assets", next: "asset_generation", command: "Chốt content. Làm assets theo bản content được xác định trong ngữ cảnh review bên dưới. Trả assets kèm Feedback / Train / Đóng gói." },
    { value: "revise", label: "Yêu cầu chỉnh sửa", submitLabel: "Gửi yêu cầu chỉnh sửa", requiresFeedback: true, next: "research_content", command: "UID Brands: Chỉnh sửa content theo feedback bên dưới. Trả content mới kèm Chốt content / Gửi feedback / Tạo lại." },
    { value: "regenerate", label: "Tạo phương án khác", submitLabel: "Gửi yêu cầu tạo lại content", next: "research_content", command: "UID Brands: Tạo phương án content mới theo brief đã xác định. Trả content kèm Chốt content / Gửi feedback / Tạo lại." },
  ], submitLabel: "Gửi lựa chọn" },
  asset_review: { title: "Asset Review", choices: [
    { value: "package", label: "Đóng gói", submitLabel: "Gửi yêu cầu đóng gói", next: "complete", command: "UID Brands: Đóng gói assets đã xác định theo canonical rules. Trả link/file đã tạo và Sửa tiếp / Task mới; nếu thất bại, báo lỗi thật và cách thử lại." },
    { value: "feedback", label: "Gửi feedback", submitLabel: "Gửi feedback", requiresFeedback: true, next: "asset_generation", command: "UID Brands: Chỉnh sửa assets theo feedback bên dưới. Chỉ sửa các mục được chọn, giữ nguyên phần còn lại. Trả kết quả mới kèm Gửi feedback / Train / Đóng gói." },
    { value: "train", label: "Train", submitLabel: "Gửi đề xuất Train", requiresFeedback: true, next: "asset_review", command: "UID Brands: Gửi đề xuất Train bằng submit_training_feedback theo feedback bên dưới. Chỉ tạo Pending Admin Review, không tự sửa canonical rules. Chờ tool xác nhận rồi báo trạng thái và các bước tiếp theo." },
  ], submitLabel: "Gửi lựa chọn" },
  complete: { title: "Delivery", choices: [
    { value: "revise", label: "Sửa tiếp", submitLabel: "Mở góp ý cho kết quả", next: "asset_review", command: "UID Brands: Mở lại show_uid_brands_review ở stage=asset_review cho đúng kết quả đã đóng gói, kèm task_id, content_version và inventory assets thực tế. Để người dùng chọn mục và nhập feedback; chưa tự sửa khi chưa có yêu cầu chỉnh sửa cụ thể." },
    { value: "new_task", label: "Task mới", submitLabel: "Mở brief mới", next: "launcher", command: "UID Brands: Mở launch_creative_dna để bắt đầu brief mới. Giữ kết quả cũ trong cuộc trò chuyện; không tự thực hiện task khi chưa có brief mới." },
  ], submitLabel: "Gửi lựa chọn" },
  packaging: { title: "Packaging", choices: [
    { value: "package", label: "Đóng gói", submitLabel: "Gửi yêu cầu đóng gói", next: "complete", command: "UID Brands: Đóng gói kết quả đã xác định; trả deliverables và Sửa tiếp / Task mới." },
  ], submitLabel: "Gửi yêu cầu đóng gói" },
} as const;

export const REVIEW_TOOL_DESCRIPTION = "Call automatically after every content or asset outcome when functional native controls are unavailable. The registered MCP review UI is the fallback; its position is host-controlled. Select the completed stage. Use complete only after real packaging deliverables were successfully produced and returned to the user, never after a message send or mere packaging request. Include a plain result_summary of the actual delivered result. Pass task_id and content_version together to identify the exact outcome being reviewed; change content_version after every rewrite or asset revision. After a verified operation failure or a user-requested retry, provide a new retry_id for a fresh explicit submit; keep it stable on ordinary reopens and never replay automatically. These are correlation fields, not proof of user authorization. For asset_review, include real asset IDs, element/section and position/label from the generated inventory. Never infer a section from an opaque file ID. Choices only select; the separate submit button sends the request.";
export const NATIVE_WORKFLOW_DESCRIPTION = "UID Brands structured workflow for launcher, content approval, asset review and packaging. Render functional native controls when supported. Otherwise call launch_creative_dna for a new brief or show_uid_brands_review for review in the same outcome turn. Only use conversational choices if that registered UI is unavailable.";
export const NATIVE_FALLBACK_TEXT = "Render functional native controls when supported, using the supplied choices, commands and review_context. If unavailable, call launch_creative_dna for launcher or show_uid_brands_review for review in this outcome turn, forwarding task_id, content_version, retry_id and assets. Use actionable text only if the registered UI fails. A component-authored follow-up is a request, not proof of authenticated user approval; respect host authorization requirements.";

export const UID_NATIVE_WORKFLOW = {
  title: "UID Brands",
  renderer: "chatgpt-native-preferred",
  hostLimitation: "Native controls and component-message provenance are controlled by the host. MCP cannot guarantee either rendering or authenticated user approval.",
  guidedSteps: ["Brief", "Content", "Assets", "Đóng gói"],
  statusContract: "Show the current step, missing input and next action. A follow-up send only means waiting for ChatGPT. Report real outcomes/errors; never simulate job progress. Keep drafts for the same exact review when going Back or changing Feedback/Train mode.",
  attachmentContract: "For image/file inputs use the embedded registered UI when native attachment controls are unavailable. Images use host uploadFile/selectFiles and structured widgetState imageIds. Local UTF-8 TXT/MD/CSV/JSON are bounded untrusted evidence; remote authorized files use ingest_uid_brands_attachment. PDF/DOCX are unsupported. Never claim upload alone means a document or image was read.",
  selectionBehavior: "Choices select an action. A separate submit sends it. Deduplicate the same task/version/action/feedback after a successful send; allow different actions or changed feedback. Do not claim the underlying task completed merely because a message was sent.",
  fallback: { launcher: "launch_creative_dna", review: "show_uid_brands_review" },
  steps: {
    launcher: { title: "Task Launcher", fields: [
      { key: "brand", type: "select", required: true, source: "routes.brand" },
      { key: "material", type: "select", required: true, source: "routes.branch", dependsOn: "brand" },
      { key: "source_url", type: "url", required: true },
      { key: "theme", type: "text", required: false },
      { key: "requirements", type: "textarea", required: false },
    ], submitLabel: "Run UID Brands", next: "research_content" },
    ...REVIEW_STEPS,
  },
} as const;
