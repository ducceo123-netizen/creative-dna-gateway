import { RESEARCH_GUIDANCE } from "./supabase/functions/_shared/product-research.ts";
/** One action contract for native controls and the registered MCP review UI. */
export const REVIEW_STAGES = ["content_approval", "asset_review", "packaging", "complete"] as const;
export const WORKFLOW_STAGES = ["launcher", ...REVIEW_STAGES] as const;

export const REVIEW_STEPS = {
  content_approval: { title: "Content Approval", choices: [
    { value: "approve", label: "Chốt content và tạo assets", submitLabel: "Chốt content và tạo assets", next: "asset_generation", command: "Chốt content và tạo assets theo đúng task và phiên bản bên dưới. Trả assets đã tạo kèm Feedback / Train / Đóng gói." },
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

/** Prompt-first: the embedded panel composes text; execution starts in chat. */
export const OUTCOME_RENDER_GUIDANCE = "PROMPT-FIRST FLOW: Return verified outcomes, original files and clear textual next steps in chat. Do not require or automatically open a review panel after every outcome. Use show_uid_brands_review only when the user requests a panel or asset/group selection is needed. Keep one panel per unchanged task/version; never poll, reopen or retry an uncertain UI call just for status. Panel preparation and copying are not submission, authorization or execution. Report factual milestones and blockers in chat.";
export const OUTCOME_RENDER_REMINDER = OUTCOME_RENDER_GUIDANCE;
export const REVIEW_TOOL_DESCRIPTION = OUTCOME_RENDER_GUIDANCE + " The compact embedded panel preserves actual asset/group selection and generates an editable prompt for the user to copy, paste and send manually in chat. No action auto-sends. Supply exact task_id/content_version and real asset IDs with section/position metadata. Keep full results and original attachments in chat; result_summary may identify the current outcome. result_content, result_links and result_images remain compatible optional fields, but do not resend large outcomes just to open a panel. Tool preparation does not prove visible rendering. Feedback only revises selected assets; Train requires explicit selection and produces Pending Admin Review, never direct canonical mutation.";
export const NATIVE_WORKFLOW_DESCRIPTION = "Describe the UID Brands prompt-first workflow. This tool does not render controls and is not a prerequisite or capability probe. Users may use ordinary chat commands, or request launch_creative_dna / show_uid_brands_review for a compact prompt composer. The panel never sends or runs its prepared prompt.";
export const NATIVE_FALLBACK_TEXT = "This response describes a workflow and has not rendered a panel. Provide clear next-step chat commands. If the user needs asset/group selection, use show_uid_brands_review with the actual inventory and task/version. The embedded panel prepares editable prompts only; users copy, paste and send them in chat. A degraded route lookup with prepared launcher UI is not a rendering failure. Do not retry uncertain UI calls automatically.";

export const REVIEW_UI_META = { ui: { resourceUri: "ui://uid-brands/workflow-v2.html", visibility: ["model", "app"] }, "openai/outputTemplate": "ui://uid-brands/workflow-v2.html", "openai/widgetAccessible": true };

export const REVIEW_EXECUTION_GUIDANCE = RESEARCH_GUIDANCE + " PROMPT-FIRST HANDOFF: The panel only prepares editable text; it never sends a model follow-up, starts generation, packages files or submits Train. Copying does not itself prove authenticated user approval and is not execution. Wait for the user's actual chat message, respect its scope and host confirmation policy, then acknowledge the action briefly and show factual milestones or blockers during work. Do not suppress chat responses or native progress to favour a widget. Correlation fields are not authorization; verify task/version before action. Feedback edits only selected targets; never turn Feedback into Train. Explicit Train creates Pending Admin Review using submit_training_feedback and reports only a verified receipt. Packaging must return real files/links. Do not repeat a completed operation when a copied prompt is pasted again; reconcile existing results first. " + OUTCOME_RENDER_GUIDANCE + " STAGE-SCOPED STATUS: Report only the failed operation. A routes failure does not prove a review panel failed to render; do not repeat an earlier launcher error as a current blanket form failure. Do not claim a panel is visible from tool response alone. Full creative results and attachments belong in chat. The panel is a small optional selector, not a progress monitor or transcript replacement.";

export const UID_NATIVE_WORKFLOW = {
  title: "UID Brands",
  renderer: "embedded-prompt-composer",
  hostLimitation: "Native controls and component-message provenance are controlled by the host. MCP cannot guarantee either rendering or authenticated user approval.",
  guidedSteps: ["Brief", "Content", "Assets", "Đóng gói"],
  statusContract: "Show the current step, missing input and next action. Prepared/copied prompts have not been sent; user pastes and sends in chat. Report real outcomes/errors; never simulate job progress. Keep drafts for the same exact review when going Back or changing Feedback/Train mode.",
  attachmentContract: "For image/file inputs use the embedded registered UI when native attachment controls are unavailable. Images remain references until the user attaches originals in their chat message; preparing a prompt does not register imageIds for model visibility. Local UTF-8 TXT/MD/CSV/JSON are bounded untrusted evidence; remote authorized files use ingest_uid_brands_attachment. PDF/DOCX are unsupported. Never claim upload alone means a document or image was read.",
  selectionBehavior: "Preserve asset and group multi-selection. Actions only build editable prompts. User copies, pastes and sends in chat. No automatic follow-up or task execution; no auto-Train from Feedback.",
  fallback: { launcher: "launch_creative_dna", review: "show_uid_brands_review" },
  steps: {
    launcher: { title: "Task Launcher", fields: [
      { key: "brand", type: "select", required: true, source: "routes.brand" },
      { key: "material", type: "select", required: true, source: "routes.branch", dependsOn: "brand" },
      { key: "source_url", type: "url", required: true },
      { key: "theme", type: "text", required: false },
      { key: "requirements", type: "textarea", required: false },
    ], submitLabel: "Tạo prompt", next: "research_content" },
    ...REVIEW_STEPS,
  },
} as const;
