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
  assert.match(html, /không phải ảnh xem trước/);
  assert.match(html, /không gửi, không chạy sửa, không tạo hàng đợi hay Train/);
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
    tag: string; children: Element[] = []; dataset: Record<string, string> = {}; events: Record<string, (() => any)[]> = {};
    textContent = ""; className = ""; type = ""; value = ""; checked = false; disabled = false; hidden = false; title = "";
    selectionStart = 0; selectionEnd = 0;
    constructor(tag: string) { this.tag = tag; }
    set id(value: string) { ids.set(value, this); }
    append(...nodes: Element[]) { this.children.push(...nodes); }
    replaceChildren(...nodes: Element[]) { this.children = nodes; }
    addEventListener(event: string, handler: () => any) { (this.events[event] ||= []).push(handler); }
    setAttribute(_key: string, _value: string) {}
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
    async fire(event: string) { for (const handler of this.events[event] ?? []) await handler(); }
    async click() { if (this.disabled) return; if (this.type === "checkbox") { this.checked = !this.checked; await this.fire("change"); } else await this.fire("click"); }
  }
  for (const match of source("html").matchAll(/<(\w+)\b[^>]*id="([^"]+)"[^>]*>/g)) { const element = new Element(match[1]); element.id = match[2]; }
  const document = { getElementById: (id: string) => ids.get(id), createElement: (tag: string) => new Element(tag) };
  new Script(source("js")).runInNewContext({ document, navigator: { clipboard } });
  const $ = (id: string) => { assert.ok(ids.has(id), id); return ids.get(id)!; };
  return { $, fill: async (id: string, value: string) => { $(id).value = value; await $(id).fire("input"); }, group: (id: string) => $("slot-groups").querySelector(`[data-group-select="${id}"]`), blocks: () => $("blocks").children };
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
