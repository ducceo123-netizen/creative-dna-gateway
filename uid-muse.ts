import type express from 'express';
import { z } from 'zod';
import { getOnepageUiTemplate } from './onepage-ui-template.ts';

// A small browser/API entry, deliberately independent of the ChatGPT MCP/widget contract.
// All data comes from the same canonical functions used by the existing gateway.
type Result = { status: number; ok: boolean; data: any };
type Dependencies = {
  origin: string;
  routes: () => Promise<Result>;
  sanitizeRoutes: (data: any) => { routes: any[] };
  resolve: (brand: string, branch: string) => Promise<Result>;
  compile: (brand: string, source_url?: string, source_type?: string, theme?: string) => Promise<Result>;
};

const brand = z.string().trim().min(1).max(100);
const resolveInput = z.object({ brand, branch: z.string().trim().min(1).max(150) }).strict();
const compileInput = z.object({
  brand,
  source_url: z.string().max(2000).url().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch { return false; }
  }).optional(),
  source_type: z.enum(['auto', 'product', 'collection']).optional(),
  theme: z.string().trim().max(120).optional(),
}).strict();
const templateInput = z.object({ version: z.string().max(100).optional() }).strict();

const jsonResponse = (description: string) => ({
  description, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
});
const parameter = (name: string, schema: object, required = false) => ({ name, in: 'query', required, schema });
const operation = (operationId: string, description: string, parameters: any[] = []) => ({
  operationId, summary: description, description,
  'x-read-only': true, security: [], parameters,
  responses: {
    '200': jsonResponse('Canonical read-only result. Inspect quality gates before proceeding; HTTP 200 does not mean production-ready.'),
    '400': jsonResponse('Invalid input; correct the parameters before retrying.'),
    '404': jsonResponse('Brand, branch, or template not found.'),
    '422': jsonResponse('Canonical compiler could not produce a valid contract.'),
    '429': { ...jsonResponse('Rate limited. Wait for Retry-After before retrying.'), headers: { 'Retry-After': { schema: { type: 'integer' } } } },
    '502': jsonResponse('Canonical upstream unavailable. No partial result is a successful compile.'),
    default: jsonResponse('Request failed; do not treat this as a canonical result.'),
  },
});

export function museOpenApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'UID Brands — read-only Muse auxiliary entry', version: '1.0.0',
      description: 'Public canonical brand rules, Onepage brief compilation, and versioned template links. No authentication or account data. No writes, image generation, private-reference access, or ChatGPT widgets. API/browser MVP; a native Muse connection has not been verified. Source URLs and themes must contain only public, non-sensitive material because GET query strings may be logged by infrastructure.',
    },
    servers: [{ url: origin }], security: [],
    paths: {
      '/api/muse/routes': { get: operation('list_creative_dna_routes', 'Discover canonical brand and branch names.') },
      '/api/muse/resolve': { get: operation('resolve_creative_dna', 'Retrieve the full canonical rules for a discovered brand and branch.', [
        parameter('brand', { type: 'string', minLength: 1, maxLength: 100 }, true),
        parameter('branch', { type: 'string', minLength: 1, maxLength: 150 }, true),
      ]) },
      '/api/muse/compile': { get: operation('compile_onepage_job', 'Compile the current Onepage task packet without creating a job, generating assets, fetching the source URL, or changing canonical data. Preserve every quality/reference gate and revision/hash.', [
        parameter('brand', { type: 'string', minLength: 1, maxLength: 100 }, true),
        parameter('source_url', { type: 'string', format: 'uri', maxLength: 2000, description: 'Optional public HTTPS product/collection URL without embedded credentials. No signed/private URLs.' }),
        parameter('source_type', { type: 'string', enum: ['auto', 'product', 'collection'] }),
        parameter('theme', { type: 'string', maxLength: 120, description: 'Optional public creative theme; no personal or confidential information.' }),
      ]) },
      '/api/muse/template': { get: operation('get_onepage_ui_template', 'Get the shared versioned template manifest with exact HTML/CSS download URLs and SHA-256 hashes. Returns links and requirements; no render or asset generation.', [
        parameter('version', { type: 'string', maxLength: 100, description: 'Omit to use the current canonical template version.' }),
      ]) },
    },
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

export function museBootstrap(origin: string) {
  const base = escapeHtml(origin);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UID Brands · Muse MVP</title></head><body>
<main><h1>UID Brands · Muse MVP</h1>
<p>Cổng phụ đọc Creative DNA và biên dịch brief Onepage từ cùng nguồn canonical đang dùng trên ChatGPT. Không cần tài khoản hoặc API key cho bốn thao tác bên dưới.</p>
<h2>Thử ngay</h2>
<ol><li><a href="${base}/api/muse/routes">Xem brand và branch hiện có</a></li>
<li><a href="${base}/api/muse/resolve?brand=PawfectHouse&amp;branch=Onepage">Đọc rules PawfectHouse / Onepage</a></li>
<li><a href="${base}/api/muse/compile?brand=PawfectHouse">Biên dịch brief PawfectHouse / Onepage</a></li>
<li><a href="${base}/api/muse/template">Lấy template HTML/CSS và mã SHA-256</a></li></ol>
<h2>Dán vào Muse để thử</h2>
<p>Đọc ${base}/muse và dùng các API GET được mô tả tại ${base}/api/muse/openapi.json. Liệt kê brand/branch, rồi compile brief PawfectHouse / Onepage. Trả lại tóm tắt các yêu cầu, revision/hash, quality/reference gates còn thiếu và link template HTML/CSS. Chỉ đọc và lập brief; chưa tạo ảnh, chưa gửi feedback hay thay đổi dữ liệu. Nếu không gọi được API, báo rõ bước bị chặn, không tự đoán rules.</p>
<h2>API và phạm vi</h2>
<p><a href="${base}/api/muse/openapi.json">OpenAPI 3.1 cho bốn thao tác read-only</a>. Tất cả dùng GET, trả JSON, không cần credential. URL ví dụ là request thực tế; có thể mở bằng trình duyệt hoặc công cụ HTTP. Nếu Muse hỗ trợ tạo Custom Connector từ OpenAPI, dùng schema này và tự xác nhận quyền khi Muse hỏi.</p>
<ul><li>GET /api/muse/routes: không có tham số.</li>
<li>GET /api/muse/resolve: brand, branch bắt buộc.</li>
<li>GET /api/muse/compile: brand bắt buộc; source_url, source_type (auto/product/collection), theme tùy chọn. URL-encode từng giá trị. source_url chỉ là đầu vào brief, không được tự tải bởi endpoint.</li>
<li>GET /api/muse/template: version tùy chọn, mặc định phiên bản hiện hành.</li></ul>
<h2>Điều cần biết</h2>
<ul><li>Đây là bản API/browser MVP. Chưa xác minh kết nối công cụ trực tiếp trong tài khoản Muse của bạn; không phải connector được Meta phê duyệt. Không cần tạo kết nối thường trực để thử các link trên.</li>
<li>HTTP 200 có thể chứa gate BLOCKED. Giữ nguyên mọi hard gate, revision/hash, quality_execution_guard, template_policy_compatibility và yêu cầu kiểm tra reference. Reference riêng tư không được cấp qua cổng này; nếu bắt buộc thì dừng bước liên quan và báo thiếu quyền.</li>
<li>Không có training write, upload, admin, private-reference image, tạo ảnh hay chi phí sinh ảnh. Không dùng ChatGPT launcher hoặc window.openai.</li>
<li>Chỉ gửi URL sản phẩm công khai và chủ đề không nhạy cảm. Tham số GET có thể xuất hiện trong lịch sử/log hạ tầng; không gửi signed URL, token, dữ liệu cá nhân hay nội dung mật.</li>
<li>Giới hạn dùng chung của gateway: 120 request/phút/IP. Khi gặp 429, đợi theo Retry-After. Lỗi 400 cần sửa input; 404 là route/template không có; 422/5xx cần báo lỗi, không tự tạo kết quả thay thế.</li></ul>
<p><a href="https://www.meta.com/help/artificial-intelligence/1687253048996149/">Hướng dẫn Custom Connector của Meta</a> · <a href="https://muse.ai/platform/docs">Muse Connector guidelines</a></p>
</main></body></html>`;
}

export function registerMuseRoutes(app: express.Application, dependencies: Dependencies) {
  const { origin } = dependencies;
  app.get('/muse', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    return res.type('html').send(museBootstrap(origin));
  });
  app.use('/api/muse', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.get('/api/muse/openapi.json', (_req, res) => res.json(museOpenApi(origin)));
  app.get('/api/muse/routes', async (req, res) => {
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'This operation takes no parameters' });
    try {
      const result = await dependencies.routes();
      if (!result.ok) return res.status(result.status).json({ error: 'Unable to list Creative DNA routes' });
      return res.status(result.status).json({ mode: 'canonical_read_only', routes: dependencies.sanitizeRoutes(result.data).routes });
    } catch { return res.status(502).json({ error: 'Unable to list Creative DNA routes' }); }
  });
  app.get('/api/muse/resolve', async (req, res) => {
    const input = resolveInput.safeParse(req.query);
    if (!input.success) return res.status(400).json({ error: 'Provide brand (1–100 characters) and branch (1–150 characters) only' });
    try {
      const result = await dependencies.resolve(input.data.brand, input.data.branch);
      return res.status(result.status).json(result.ok ? result.data : { error: 'Unable to resolve Creative DNA' });
    } catch { return res.status(502).json({ error: 'Unable to resolve Creative DNA' }); }
  });
  app.get('/api/muse/compile', async (req, res) => {
    const input = compileInput.safeParse(req.query);
    if (!input.success) return res.status(400).json({ error: 'Invalid compile parameters; see the Muse OpenAPI schema' });
    try {
      const { brand, source_url, source_type, theme } = input.data;
      const result = await dependencies.compile(brand, source_url, source_type, theme);
      return res.status(result.status).json(result.ok ? result.data : { error: 'Unable to compile Onepage job' });
    } catch { return res.status(502).json({ error: 'Unable to compile Onepage job' }); }
  });
  app.get('/api/muse/template', (req, res) => {
    const input = templateInput.safeParse(req.query);
    if (!input.success) return res.status(400).json({ error: 'Only an optional template version is supported' });
    try { return res.json(getOnepageUiTemplate(input.data.version)); }
    catch { return res.status(404).json({ error: 'Unknown Onepage UI template version' }); }
  });
  // No forwarding/proxy escape hatch: only the four advertised reads exist here.
  app.all(['/api/muse/routes', '/api/muse/resolve', '/api/muse/compile', '/api/muse/template', '/api/muse/openapi.json'], (_req, res) => {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return res.status(405).json({ error: 'This auxiliary entry supports read-only GET requests' });
  });
}
