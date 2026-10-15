/** The host caches widget HTML by URI. Bump this when publishing a new UI bundle. */
export const LAUNCHER_URI = "ui://uid-brands/workflow-v4.html";

/** Keep old tool descriptors readable while host metadata refreshes. */
export const LEGACY_LAUNCHER_URI = "ui://uid-brands/workflow-v2.html";

/** Preserve descriptors issued by the previous cache refresh. */
export const PREVIOUS_LAUNCHER_URI = "ui://uid-brands/workflow-v3.html";

/** Inert compatibility response for cached descriptors. Never serve the retired script. */
export const LAUNCHER_MIME = "text/html;profile=mcp-app";
export const SAFE_CHAT_RESOURCE_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UID Brands · Chat</title></head><body><main><h1>UID Brands dùng chế độ chat</h1><p>Panel tương tác đã được ngừng phục vụ để giảm lỗi giao diện. Gửi yêu cầu trực tiếp trong cuộc trò chuyện.</p><p>Task mới: nêu Brand, Material, Product / Collection URL và yêu cầu riêng.</p><p>Feedback: nêu đúng task, phiên bản, asset IDs cần sửa và nội dung góp ý. Nếu chưa rõ ID, hỏi để đối chiếu kết quả hiện có.</p><p>Đính kèm ảnh/tệp gốc trong chat. Hướng dẫn này không chạy tác vụ, gửi feedback hoặc tạo đề xuất Train.</p><p>Nếu panel cũ vẫn hiện, giữ lại bản nháp cần thiết và tiếp tục bằng chat; không bấm gửi lại tác vụ chưa rõ kết quả.</p></main></body></html>`;
