import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ONEPAGE_DELIVERY_ROLES } from "../supabase/functions/_shared/onepage-packaging.ts";

const source = (ext: string) => readFileSync(new URL(`../public/onepage-panel.${ext}`, import.meta.url), "utf8");

test("standalone panel uses exactly the canonical production inventory rather than template aliases", () => {
  const js = source("js");
  const slots = [...js.matchAll(/["']((?:banner_(?:desktop|mobile)|wyl_\d+|detail_(?:main|\d+)|occasion_(?:\d+|icon_\d+|story_\d+(?:_mobile)?)|gtk_\d+))["']/g)].map(match => match[1]);
  assert.equal(Object.keys(ONEPAGE_DELIVERY_ROLES).length, 18);
  assert.deepEqual([...new Set(slots)].sort(), Object.keys(ONEPAGE_DELIVERY_ROLES).sort());
  assert.doesNotMatch(js, /occasion_story_01_mobile|occasion_story_01|occasion_story_02/);
  assert.doesNotThrow(() => new Script(js), "Browser script is valid standalone JavaScript");
});

test("public panel has no embedded app, network bridge, storage or private context hydration", () => {
  const html = source("html"), js = source("js"), css = source("css");
  assert.doesNotMatch(html, /<(?:iframe|form|img|video|audio|object|embed)\b|\bon\w+\s*=/i);
  assert.doesNotMatch(js, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|postMessage|open)\s*\(|window\.openai|window\.(?:parent|top|opener)|\b(?:localStorage|sessionStorage|indexedDB|serviceWorker)\b|document\.cookie|\b(?:location|URLSearchParams)\b|\b(?:setInterval|setTimeout)\s*\(/);
  assert.doesNotMatch(js, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b/);
  assert.doesNotMatch(css, /@import\b|url\s*\(/i);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
  assert.deepEqual(scripts.map(match => match[1]), ["/onepage-panel.js"]);
  assert.match(html, /Chỉ áp dụng cho các mục có trong kết quả Onepage đang xem/);
  assert.match(html, /không gửi (?:yêu cầu sửa, tạo hàng đợi hay Train)|không gửi, không chạy sửa, không tạo hàng đợi hay Train/);
});

test("copy-only composer provides accessible manual fallback and bounded separate feedback fields", () => {
  const html = source("html"), js = source("js");
  for (const id of ["slot-groups", "instruction", "save-block", "blocks", "overall", "prompt-output", "copy-prompt", "select-prompt", "cancel-edit", "status"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="prompt-output"[^>]*readonly/);
  assert.match(html, /id="instruction"[^>]*maxlength="4000"/);
  assert.match(html, /id="overall"[^>]*maxlength="4000"/);
  assert.match(html, /id="status"[^>]*aria-live="polite"/);
  assert.match(js, /clipboard/);
  assert.match(js, /\.writeText\(/);
  assert.match(js, /\.select\(/);
  assert.match(js, /catch\b/);
  assert.match(html, /Tải lại hoặc đóng trang sẽ mất/);
  assert.match(html, /phạm vi riêng/);
});

// Minimal DOM event harness: exercises the shipped script, not a rewritten model.
// This deliberately does not claim browser rendering or clipboard permission coverage.
function panelHarness(clipboard?: { writeText: (text: string) => Promise<void> }) {
  const ids = new Map<string, Element>();
  class Element {
    tag: string; children: Element[] = []; dataset: Record<string, string> = {}; events: Record<string, ((event: any) => any)[]> = {}; parentElement?: Element;
    textContent = ""; className = ""; type = ""; value = ""; checked = false; disabled = false; hidden = false; title = "";
    selectionStart = 0; selectionEnd = 0; open = false;
    constructor(tag: string) { this.tag = tag; }
    set id(value: string) { ids.set(value, this); }
    append(...nodes: Element[]) { for (const node of nodes) node.parentElement = this; this.children.push(...nodes); }
    replaceChildren(...nodes: Element[]) { this.children = nodes; }
    addEventListener(event: string, handler: (event: any) => any) { (this.events[event] ||= []).push(handler); }
    attributes: Record<string, string> = {};
    classList = {
      toggle: (name: string, force?: boolean) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        const add = force ?? !classes.has(name); add ? classes.add(name) : classes.delete(name);
        this.className = [...classes].join(" "); return add;
      },
      contains: (name: string) => this.className.split(/\s+/).includes(name),
    };
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    getAttribute(key: string) { return this.attributes[key] ?? null; }
    focus() {}
    select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
    querySelectorAll(selector: string): Element[] {
      const nodes = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
      if (selector === "*") return nodes;
      if (selector === "input[type=checkbox]") return nodes.filter(node => node.tag === "input" && node.type === "checkbox");
      const data = selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
      if (data) { const key = data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return nodes.filter(node => Object.hasOwn(node.dataset, key) && (data[2] === undefined || node.dataset[key] === data[2])); }
      throw Error("Unsupported harness selector: " + selector);
    }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0]; }
    async fire(event: string, data: Record<string, unknown> = {}) { for (const handler of this.events[event] ?? []) await handler({ preventDefault() {}, ...data }); }
    async click() { if (this.disabled) return; if (this.type === "checkbox") { this.checked = !this.checked; await this.fire("change"); } else await this.fire("click"); }
  }
  for (const match of source("html").matchAll(/<(\w+)\b[^>]*id="([^"]+)"[^>]*>/g)) { const element = new Element(match[1]); element.id = match[2];
    for (const attribute of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(attribute[1], attribute[2]);
    element.hidden = /\shidden(?:\s|>)/.test(match[0]); element.disabled = /\sdisabled(?:\s|>)/.test(match[0]);
    element.className = element.getAttribute("class") ?? ""; }
  const document = { body: new Element("body"), getElementById: (id: string) => ids.get(id), createElement: (tag: string) => new Element(tag) };
  new Script(source("js")).runInNewContext({ document, navigator: { clipboard }, URL });
  const $ = (id: string) => { assert.ok(ids.has(id), id); return ids.get(id)!; };
  return { $, document, fill: async (id: string, value: string) => { $(id).value = value; await $(id).fire("input"); }, group: (id: string) => $("slot-groups").querySelector(`[data-group-select="${id}"]`), blocks: () => $("blocks").children };
}

test("shipped composer preserves multiple groups, deselected exclusions, edits and overlap prevention", async () => {
  const h = panelHarness();
  assert.equal(h.$("slot-groups").querySelectorAll("input[type=checkbox]").length, 18);
  assert.equal(h.$("copy-prompt").disabled, true);
  await h.group("banner").click(); await h.$("slot-banner_mobile").click();
  await h.fill("instruction", "Increase whitespace"); await h.$("save-block").click();
  assert.equal(h.blocks().length, 1); assert.equal(h.$("slot-banner_desktop").disabled, true);
  await h.group("wyl").click(); await h.$("slot-wyl_03").click(); await h.fill("instruction", "Reduce title size");
  assert.equal(h.$("copy-prompt").disabled, true); assert.equal(h.$("prompt-output").value, "");
  await h.$("save-block").click(); await h.fill("overall", "Unify writing style");
  const prompt = h.$("prompt-output").value;
  assert.match(prompt, /banner_desktop/); assert.doesNotMatch(prompt, /banner_mobile|wyl_03/);
  assert.match(prompt, /wyl_01/); assert.match(prompt, /wyl_02/);
  assert.match(prompt, /Increase whitespace/); assert.match(prompt, /Reduce title size/);
  assert.match(prompt, /Góp ý tổng thể[^]*Unify writing style/);
  assert.match(prompt, /không chuyển thành thao tác chọn tất cả assets/);
  await h.blocks()[0].querySelector("[data-edit-block]").click();
  assert.equal(h.$("slot-banner_desktop").disabled, false); assert.equal(h.$("slot-wyl_01").disabled, true);
  await h.fill("instruction", "Revised instruction"); await h.$("save-block").click();
  assert.match(h.$("prompt-output").value, /Revised instruction/); assert.doesNotMatch(h.$("prompt-output").value, /Increase whitespace/);
  await h.blocks()[0].querySelector("[data-remove-block]").click();
  assert.equal(h.blocks().length, 1); assert.equal(h.$("slot-banner_desktop").disabled, false);
  assert.doesNotMatch(h.$("prompt-output").value, /banner_desktop/);
});

test("clipboard rejection selects exact prompt for manual copy without claiming delivery or edits", async () => {
  const h = panelHarness({ writeText: async () => { throw Error("Clipboard denied"); } });
  await h.$("slot-detail_01").click(); await h.fill("instruction", "Keep product exact"); await h.$("save-block").click();
  await h.$("copy-prompt").click();
  assert.match(h.$("status").textContent, /copy thủ công/);
  assert.doesNotMatch(h.$("status").textContent, /Đã sao chép prompt/);
  assert.equal(h.$("prompt-output").selectionEnd - h.$("prompt-output").selectionStart, h.$("prompt-output").value.length);
  await h.$("slot-detail_02").click();
  assert.equal(h.$("copy-prompt").disabled, true); assert.equal(h.$("select-prompt").disabled, true);
  await h.$("cancel-edit").click(); assert.equal(h.$("copy-prompt").disabled, false);
  const fresh = panelHarness(); assert.equal(fresh.blocks().length, 0); assert.equal(fresh.$("prompt-output").value, "");
});

test("composer caps feedback at ten blocks but permits editing and removing at the limit", async () => {
  const h = panelHarness();
  const inputs = h.$("slot-groups").querySelectorAll("input[type=checkbox]");
  for (let i = 0; i < 10; i++) { await inputs[i].click(); await h.fill("instruction", `Feedback ${i + 1}`); await h.$("save-block").click(); }
  assert.equal(h.blocks().length, 10);
  await inputs[10].click(); await h.fill("instruction", "Eleventh");
  assert.equal(h.$("save-block").disabled, true);
  await h.$("save-block").fire("click"); assert.equal(h.blocks().length, 10, "Event handler enforces limit too");
  await h.$("cancel-edit").click(); await h.blocks()[0].querySelector("[data-edit-block]").click();
  await h.fill("instruction", "Updated first"); assert.equal(h.$("save-block").disabled, false); await h.$("save-block").click();
  assert.equal(h.blocks().length, 10); assert.match(h.$("prompt-output").value, /Updated first/);
  await h.blocks()[0].querySelector("[data-remove-block]").click(); assert.equal(h.blocks().length, 9);
});

test("standalone visual source retains the old PromptMaster palette, compact width and pill controls", () => {
  const old = readFileSync(new URL("../uid-brands-workflow.ts", import.meta.url), "utf8");
  const css = source("css"), html = source("html");
  for (const token of ["fg", "muted", "bg", "surface", "input", "border", "active", "accent", "placeholder", "focus"]) {
    const pattern = new RegExp(`--${token}:([^;}]+)`);
    const expected = old.match(pattern)?.[1].trim();
    assert.ok(expected, `Old PromptMaster defines ${token}`);
    assert.equal(css.match(pattern)?.[1].trim(), expected, `Light palette preserves --${token}`);
  }
  assert.match(css, /\.wrap\s*\{[^}]*max-width:\s*600px/);
  assert.match(css, /\.mode-tabs\s*\{[^}]*border-radius:\s*9999px/);
  assert.match(css, /\.mode-tab(?:\s*\{[^}]*border-radius:\s*9999px|[^}]*\{)/);
  assert.match(css, /\.variable-key[^}]*border-radius:\s*9999px/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(html, /Tạo tác vụ/); assert.match(html, /Feedback/);
  assert.doesNotMatch(html, /FEEDBACK WORKSPACE|Chọn đúng phần\.|Góp ý rõ ý\./);
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(0,1fr\)\s+\d+px|position:\s*sticky/);
});

test("PromptMaster tabs and collapse preserve independent local feedback and brief drafts", async () => {
  const h = panelHarness();
  assert.equal(h.$("feedbackTab").getAttribute("aria-selected"), "true");
  await h.group("banner").click(); await h.$("slot-banner_mobile").click();
  assert.equal(h.$("slot-banner_desktop").parentElement!.classList.contains("selected"), true);
  assert.equal(h.$("slot-banner_mobile").parentElement!.classList.contains("selected"), false);
  await h.$("createSharedFeedback").click(); assert.equal(h.$("draft-card").hidden, false);
  await h.fill("instruction", "Unfinished feedback survives navigation");
  assert.equal(h.$("copy-prompt").disabled, true);
  await h.$("taskTab").click();
  assert.equal(h.$("taskTab").getAttribute("aria-selected"), "true");
  assert.equal(h.$("feedbackTabPanel").hidden, true);
  await h.fill("brand", "GiftSoul"); await h.fill("url", "https://example.com/products/verified");
  await h.fill("theme", "Minimal"); await h.fill("custom", "Keep product details exact");
  const brief = h.$("prompt-output").value;
  assert.match(brief, /GiftSoul/); assert.match(brief, /https:\/\/example.com\/products\/verified/);
  assert.match(brief, /Minimal/); assert.match(brief, /Keep product details exact/);
  assert.doesNotMatch(brief, /Unfinished feedback survives navigation/);
  await h.$("toggleComposer").click();
  assert.equal(h.$("composerBody").hidden, true);
  assert.equal(h.$("toggleComposer").getAttribute("aria-expanded"), "false");
  await h.$("toggleComposer").click();
  assert.equal(h.$("composerBody").hidden, false); assert.equal(h.$("prompt-output").value, brief);
  await h.$("feedbackTab").click();
  assert.equal(h.$("instruction").value, "Unfinished feedback survives navigation");
  assert.equal(h.$("slot-banner_desktop").checked, true); assert.equal(h.$("slot-banner_mobile").checked, false);
  assert.equal(h.$("copy-prompt").disabled, true); assert.equal(h.$("prompt-output").value, "");
  await h.$("save-block").click();
  const feedback = h.$("prompt-output").value;
  await h.$("taskTab").click(); assert.equal(h.$("prompt-output").value, brief);
  await h.$("feedbackTab").click(); assert.equal(h.$("prompt-output").value, feedback);
  assert.doesNotMatch(feedback, /GiftSoul|Keep product details exact/);
});

test("optional task brief only copies its text and validates required inputs without autoexecution", async () => {
  const copied: string[] = [];
  const h = panelHarness({ writeText: async text => { copied.push(text); } });
  await h.$("taskTab").click();
  assert.equal(h.$("copy-prompt").disabled, true);
  await h.fill("brand", "PawfectHouse");
  assert.equal(h.$("copy-prompt").disabled, true);
  for (const url of ["javascript:alert(1)", "data:text/plain,brief", "https://user:secret@example.com/private", "not a URL"]) {
    await h.fill("url", url); assert.equal(h.$("copy-prompt").disabled, true); assert.equal(h.$("prompt-output").value, "");
  }
  await h.fill("url", "https://example.com/collections/verified");
  assert.equal(h.$("copy-prompt").disabled, false);
  assert.equal(copied.length, 0, "Completing a brief must not send or copy it automatically");
  await h.$("copy-prompt").click();
  assert.deepEqual(copied, [h.$("prompt-output").value]);
  assert.match(copied[0], /PawfectHouse/); assert.match(copied[0], /Onepage/i);
  assert.match(h.$("status").textContent, /[Dd]án|chat/);
  assert.equal(h.blocks().length, 0, "Brief does not become an asset feedback block");
  await h.$("feedbackTab").click(); assert.equal(h.$("prompt-output").value, "");
  await h.$("taskTab").click(); assert.equal(h.$("prompt-output").value, copied[0]);
});

 test("tab keyboard navigation retains accessible selection and feedback draft", async () => {
  const h = panelHarness();
  await h.$("slot-wyl_01").click(); await h.fill("instruction", "Keyboard draft");
  await h.$("feedbackTab").fire("keydown", { key: "Home" });
  assert.equal(h.$("taskTab").getAttribute("aria-selected"), "true");
  await h.$("taskTab").fire("keydown", { key: "End" });
  assert.equal(h.$("feedbackTab").getAttribute("aria-selected"), "true");
  assert.equal(h.$("instruction").value, "Keyboard draft"); assert.equal(h.$("slot-wyl_01").checked, true);
});

test("task catalog matches the verified public snapshot and filters all 22 brand routes", async () => {
  const snapshot = JSON.parse(readFileSync(new URL('../docs/panel-route-snapshot.json', import.meta.url), 'utf8'));
  assert.equal(snapshot.routes.length, 22);
  const h = panelHarness();
  for (const brand of ['PawfectHouse','GiftSoul','SoulPrise']) {
    await h.fill('brand', brand);
    const actual = h.$('branches').children.map(o => o.value).sort();
    assert.deepEqual(actual, snapshot.routes.filter((r: any) => r.brand === brand.toLowerCase()).map((r: any) => r.branch).sort());
  }
  assert.equal(h.$('branches').children.some(o => o.value === 'ugc-image' || o.value === 'ldp-system'), false);
  await h.fill('branches', 'ugc-image');
  assert.equal(h.$('branches').value, 'onepage-system', 'unsupported brand route cannot be selected');
  assert.match(source('html'), /Feedback Onepage/);
});

test("each catalog route exposes its actual schema fields and requires current route revalidation", async () => {
  const snapshot = JSON.parse(readFileSync(new URL('../docs/panel-route-snapshot.json', import.meta.url), 'utf8'));
  for (const route of snapshot.routes) {
    const h = panelHarness(); await h.$('taskTab').click(); await h.fill('brand', route.brand); await h.fill('branches', route.branch);
    await h.fill('url', 'https://example.com/verified-source'); await h.fill('theme', 'Verified campaign');
    for (const key of Object.keys(route.fields)) {
      if (['theme','typo_auto_generate','generation_mode','language'].includes(key)) continue;
      const field = h.$('task-' + key);
      assert.ok(field, route.brand + '/' + route.branch + '/' + key);
      await h.fill('task-' + key, key === 'quantity' ? '3' : ['ratio','custom_ratio'].includes(key) ? '4:5' : ['dimensions','custom_dimensions'].includes(key) ? '800 x 1000' : 'Verified ' + key);
    }
    const prompt = h.$('prompt-output').value;
    assert.ok(prompt, route.brand + '/' + route.branch);
    assert.match(prompt, /Đối chiếu route và canonical hiện hành/);
    assert.match(prompt, /không chứng minh route đang hoạt động/);
    if (route.branch !== 'onepage-system') assert.doesNotMatch(prompt, /chuẩn bị content Onepage|CRC|Onepage/);
  }
});

test("UGC quantity and dimensions validate, then preserve per-route draft without leaking into other tasks", async () => {
  const h = panelHarness(); await h.$('taskTab').click(); await h.fill('brand','GiftSoul'); await h.fill('branches','ugc-image');
  await h.fill('url','https://example.com/product'); await h.fill('task-ratio','4:5');
  for (const qty of ['0','-1','1.5','many']) { await h.fill('task-quantity',qty); assert.equal(h.$('prompt-output').value,''); }
  await h.fill('task-quantity','3');
  for (const dims of ['0 x 800','-1 x 800','800','800 x 1.5']) { await h.fill('task-dimensions',dims); assert.equal(h.$('prompt-output').value,''); }
  await h.fill('task-dimensions','800 x 1000');
  assert.match(h.$('prompt-output').value,/Số lượng ảnh: 3/); assert.match(h.$('prompt-output').value,/800 x 1000/);
  await h.fill('task-ratio','0:5'); assert.equal(h.$('prompt-output').value,''); await h.fill('task-ratio','4:5');
  await h.fill('branches','onepage-system'); assert.doesNotMatch(h.$('prompt-output').value,/Số lượng ảnh|800 x 1000/);
  await h.fill('branches','ugc-image'); assert.equal(h.$('task-quantity').value,'3'); assert.equal(h.$('task-dimensions').value,'800 x 1000');
});

test("recipient briefs do not require a product URL, brand-specific dimensions stay distinct and LDP readiness is qualified", async () => {
  const h = panelHarness(); await h.$('taskTab').click(); await h.fill('brand','SoulPrise'); await h.fill('branches','recipient-image');
  assert.equal(h.$('prompt-output').value,''); await h.fill('task-recipient','Grandparents');
  assert.match(h.$('prompt-output').value,/Recipient Image/); assert.match(h.$('task-format').textContent,/800 × 800/);
  await h.fill('branches','seasonal-banner'); assert.match(h.$('task-format').textContent,/2400 × 800/); assert.match(h.$('task-format').textContent,/720 × 494/);
  await h.fill('brand','GiftSoul'); assert.match(h.$('task-format').textContent,/1600 × 800/); assert.doesNotMatch(h.$('task-format').textContent,/2400/);
  await h.fill('branches','ldp-system'); assert.match(h.$('task-format').textContent,/không chứng minh luồng Figma end-to-end đã sẵn sàng/);
  await h.fill('task-context','Seasonal campaign'); assert.match(h.$('prompt-output').value,/Xác minh khả năng thực thi/);
});

test("conflicted PawfectHouse dimensions never surface obsolete schema values as current output standards", async () => {
  const h = panelHarness(); await h.$('taskTab').click(); await h.fill('brand','PawfectHouse');
  for (const branch of ['ldp-hero','seasonal-banner']) {
    await h.fill('branches',branch);
    assert.match(h.$('task-format').textContent,/chưa đồng bộ/);
    assert.doesNotMatch(h.$('task-format').textContent,/21:9|1250|350/);
    assert.match(h.$('prompt-output').value,/schema kích thước cũ đang mâu thuẫn/);
    assert.doesNotMatch(h.$('prompt-output').value,/21:9|1250|350/);
  }
});

test("inferable creative fields do not block copy and source/theme/custom drafts stay scoped per brand and task", async () => {
  const h = panelHarness(); await h.$('taskTab').click(); await h.fill('brand','PawfectHouse'); await h.fill('branches','home-hero');
  await h.fill('url','https://example.com/product-a'); await h.fill('theme','Campaign A'); await h.fill('custom','Direction A');
  assert.ok(h.$('prompt-output').value, 'idea/campaign may be inferred from source instead of forcing placeholder entry');
  await h.fill('brand','GiftSoul');
  for (const id of ['url','theme','custom']) assert.equal(h.$(id).value,'');
  assert.doesNotMatch(h.$('prompt-output').value,/product-a|Campaign A|Direction A/);
  await h.fill('brand','PawfectHouse');
  assert.equal(h.$('url').value,'https://example.com/product-a'); assert.equal(h.$('theme').value,'Campaign A'); assert.equal(h.$('custom').value,'Direction A');
});

test("compact task defaults keep only Brand, Material, source and conditional essential recipient/niches outside optional details", async () => {
  const html = source('html');
  assert.match(html, /<details[^>]*id="optionalBrief"[^>]*><summary>Tuỳ chọn thêm/);
  assert.doesNotMatch(html, /<details[^>]*id="(?:optionalBrief|taskInfo)"[^>]*\bopen\b/);
  assert.match(html, /id="taskInfo"[^]*id="task-format"[^]*<\/details>/);
  const snapshot = JSON.parse(readFileSync(new URL('../docs/panel-route-snapshot.json', import.meta.url), 'utf8'));
  for (const route of snapshot.routes) {
    const h = panelHarness(); await h.$('taskTab').click(); await h.fill('brand',route.brand); await h.fill('branches',route.branch);
    const core = h.$('task-fields').children.filter(x => x.tag === 'textarea');
    assert.ok(core.length <= 1, route.brand + '/' + route.branch);
    for (const child of core) assert.ok(['Người nhận / mối quan hệ','Các niche (mỗi dòng một niche)'].includes(child.getAttribute('aria-label')!));
    for (const key of ['quantity','ratio','dimensions','custom_dimensions','custom_ratio','idea','context','product']) {
      if (!Object.hasOwn(route.fields,key)) continue;
      assert.equal(h.$('task-' + key).parentElement,h.$('task-advanced-fields'),key);
    }
    await h.fill('url','https://example.com/product');
    if (route.fields.recipient) await h.fill('task-recipient','Grandparents');
    if (route.fields.niches) await h.fill('task-niches','Gardening');
    assert.ok(h.$('prompt-output').value,'No hidden required-field dead end: ' + route.brand + '/' + route.branch);
  }
});

test("technical descriptions are not rendered as input hints and feedback remains picker/group/copy", async () => {
  const h = panelHarness(); await h.fill('brand','GiftSoul'); await h.fill('branches','ugc-image');
  assert.equal(h.$('task-fields').children.length,0);
  assert.equal(h.$('task-advanced-fields').children.filter(x=>x.tag==='small').length,0);
  assert.doesNotMatch(source('html'), /18 vị trí canonical|Chọn variables/);
  assert.match(source('html'), /Chọn mục → thêm góp ý chung → copy về chat/);
  await h.$('slot-banner_desktop').click(); await h.fill('instruction','More whitespace'); await h.$('save-block').click();
  assert.match(h.$('prompt-output').value,/More whitespace/);
  assert.doesNotMatch(h.$('prompt-output').value,/Số lượng ảnh|Kích thước px/);
});


test("invalid optional values reveal the collapsed section instead of blocking copy invisibly", async () => {
  const h = panelHarness(); await h.$('taskTab').click(); await h.fill('brand','GiftSoul'); await h.fill('branches','ugc-image');
  assert.equal(h.$('optionalBrief').open,false);
  await h.fill('url','https://example.com/product'); assert.ok(h.$('prompt-output').value);
  await h.fill('task-quantity','-1');
  assert.equal(h.$('optionalBrief').open,true); assert.equal(h.$('prompt-output').value,'');
  assert.match(h.$('brief-status').textContent,/Số lượng/);
  await h.fill('task-quantity','2'); assert.ok(h.$('prompt-output').value);
  await h.fill('branches','onepage-system'); assert.equal(h.$('optionalBrief').open,false);
});
