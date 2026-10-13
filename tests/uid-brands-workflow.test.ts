import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { launcherHtml } from "../uid-brands-workflow.ts";
import { REVIEW_STEPS, REVIEW_STAGES } from "../uid-brands-actions.ts";
import { createReviewContext } from "../uid-brands-review-contract.ts";

// Execute the actual embedded script. The host bridge is deliberately mocked:
// these tests do not claim to authenticate a click or execute a ChatGPT task.
const script = launcherHtml.match(/<script>([\s\S]*?)<\/script>/)![1];
// Small deterministic DOM model, not a browser/IME implementation. Detaching
// the focused node or writing its value resets modeled selection/composition.
// These invariants catch the host-echo regression without claiming real-device QA.
type FocusDocument = { activeElement: Element | null; body: Element };
class Element {
  children: Element[] = []; textContent = ""; disabled = false; hidden = false;
  private currentValue = ""; valueWrites = 0; selectionStart = 0; selectionEnd = 0; composing = false;
  parentNode: Element | null = null;
  onclick?: () => any; oninput?: (event?: any) => any; onchange?: () => any;
  attributes: Record<string, string> = {};
  classList = { toggle() {}, add() {} };
  listeners: Record<string, ((event: any) => void)[]> = {};
  files: any[] = [];
  constructor(public tag = "div", private document?: FocusDocument) {}
  get value() { return this.currentValue; }
  set value(value: string) { this.currentValue = value; this.valueWrites++; this.selectionStart = this.selectionEnd = value.length; this.composing = false; }
  get isConnected(): boolean { return this.document?.body === this || !!this.parentNode?.isConnected; }
  contains(node: Element): boolean { return this === node || this.children.some(child => child.contains(node)); }
  focus() { if (this.document && this.isConnected) this.document.activeElement = this; }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  remove() {
    const focused = this.document?.activeElement;
    if (focused && this.contains(focused)) { focused.composing = false; this.document!.activeElement = null; }
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  addEventListener(name: string, fn: (event: any) => void) { (this.listeners[name] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(name: string, event: any = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  replaceChildren(...children: Element[]) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  appendChild(child: Element) { child.remove(); child.parentNode = this; this.children.push(child); }
  append(...children: Element[]) { for (const child of children) this.appendChild(child); }
  querySelectorAll(selector: string): Element[] {
    const tags = selector.split(",").map(x => x.trim());
    return this.children.flatMap(child => [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  click() { if (!this.disabled) return this.onclick?.(); }
}
function output(stage: typeof REVIEW_STAGES[number] = "content_approval", version = "v1", task = "task-A") {
  return { stage, assets: [{ id: "asset-1", element: "Banner", position: "desktop" }], review_context: createReviewContext({ stage, task_id: task, content_version: version }) };
}
function setup(data: any = output(), options: { send?: (message: any) => Promise<any>; bridge?: boolean; state?: any; storage?: Map<string, string>; host?: Record<string, any>; globalsEcho?: "sync" | "microtask" | "state-only" } = {}) {
  const document = { activeElement: null } as FocusDocument;
  document.body = new Element("body", document);
  const nodes = new Map<string, Element>();
  const $ = (id: string) => {
    if (!nodes.has(id)) { const node = new Element(id.includes("Feedback") ? "textarea" : "div", document); nodes.set(id, node); document.body.appendChild(node); }
    return nodes.get(id)!;
  };
  const storage = options.storage || new Map<string, string>();
  const messages: any[] = []; const events: Record<string, (event: any) => void> = {};
  const openai: any = { toolOutput: data, widgetState: options.state || {}, setWidgetState(state: any) {
    this.widgetState = JSON.parse(JSON.stringify(state));
    if (!options.globalsEcho) return;
    const globals = { widgetState: this.widgetState, ...(options.globalsEcho === "state-only" ? {} : { toolOutput: JSON.parse(JSON.stringify(this.toolOutput)) }) };
    const emit = () => events["openai:set_globals"]?.({ detail: { globals } });
    if (options.globalsEcho === "microtask") queueMicrotask(emit); else emit();
  } };
  if (options.bridge !== false) openai.sendFollowUpMessage = async (message: any) => { messages.push(message); return options.send?.(message); };
  Object.assign(openai, options.host || {});
  $("reviewFields").append($("reviewChoices"), $("assetFeedbackFields"), $("reviewFeedback"));
  $("assetFeedbackFields").append($("variableKeys"), $("variableItems"));
  const window = { openai, sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) }, addEventListener: (name: string, fn: any) => { events[name] = fn; } };
  vm.runInNewContext(script, { window, document: { body: document.body, get activeElement() { return document.activeElement; }, getElementById: $, createElement: (tag: string) => new Element(tag, document) }, URL, Set, File, Blob, TextDecoder, Uint8Array });
  return { $, nodes, messages, openai, storage, document, globals(globals: any) { events["openai:set_globals"]({ detail: { globals } }); }, update(next: any) { openai.toolOutput = next; events["openai:set_globals"]({ detail: { globals: { toolOutput: next } } }); },
    choose(value: string) { const action = REVIEW_STEPS[openai.toolOutput.stage as typeof REVIEW_STAGES[number]].choices.findIndex(x => x.value === value); return $("reviewChoices").children[action].click(); },
    submit() { return $("run").onclick!(); } };
}
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

for (const stage of REVIEW_STAGES) test(`embedded ${stage} choices match the native action contract`, () => {
  const ui = setup(output(stage));
  assert.deepEqual(ui.$("reviewChoices").children.map(x => x.textContent), REVIEW_STEPS[stage].choices.map(x => x.label));
  assert.equal(ui.$("run").textContent, REVIEW_STEPS[stage].choices[0].submitLabel);
});

test("a non-feedback action sends on one click with the exact version and action", async () => {
  const data = output(); const ui = setup(data);
  assert.equal(ui.$("run").hidden, true);
  await ui.choose("approve"); assert.equal(ui.messages.length, 1);
  const message = ui.messages[0].prompt;
  assert.ok(message.includes('"task_id":"task-A"'));
  assert.ok(message.includes('"content_version":"v1"'));
  assert.ok(message.includes('"action":"approve"'));
  assert.doesNotMatch(message, /authentication|Tuân thủ yêu cầu xác nhận|REAL USER ACTION|WIDGET ACTION IS AUTHORITATIVE/);
  assert.equal(ui.$("run").disabled, true);
  assert.match(ui.$("flowState").textContent, /Chờ kết quả mới/);
});

test("pending double-clicks, successful re-clicks and same-output host rerenders send once", async () => {
  const wait = deferred(); const data = output(); const ui = setup(data, { send: () => wait.promise });
  const first = ui.submit(); await ui.submit(); assert.equal(ui.messages.length, 1);
  ui.update(data); await ui.submit(); assert.equal(ui.messages.length, 1);
  wait.resolve(); await first; await ui.submit(); assert.equal(ui.messages.length, 1);
  ui.update({ structuredContent: data }); await ui.submit(); assert.equal(ui.messages.length, 1);
});

test("successful submits survive remount through widget state and session storage independently", async () => {
  const data = output(); const ui = setup(data); await ui.submit();
  const fromState = setup(data, { state: ui.openai.widgetState }); await fromState.submit();
  const fromStorage = setup(data, { storage: ui.storage }); await fromStorage.submit();
  assert.equal(fromState.messages.length, 0); assert.equal(fromStorage.messages.length, 0);
  assert.equal(fromState.$("run").disabled, true); assert.equal(fromStorage.$("run").disabled, true);
});

test("a rejected send remains retryable, retains feedback and clears the prior error on retry", async () => {
  let fail = true; const ui = setup(output(), { send: async () => { if (fail) throw Error("host unavailable"); } });
  ui.choose("revise"); ui.$("reviewFeedback").value = "Keep the product color";
  await ui.submit(); assert.equal(ui.$("run").disabled, false); assert.match(ui.$("error").textContent, /Gửi thất bại/);
  assert.equal(ui.$("reviewFeedback").value, "Keep the product color");
  fail = false; await ui.submit(); assert.equal(ui.messages.length, 2);
  assert.equal(ui.$("error").textContent, ""); assert.equal(ui.$("run").disabled, true);
});

test("missing bridge fails honestly without persisting success and can recover", async () => {
  const ui = setup(output(), { bridge: false }); await ui.submit();
  assert.match(ui.$("error").textContent, /chưa được gửi/); assert.equal(ui.$("run").disabled, false);
  let sent = 0; ui.openai.sendFollowUpMessage = async () => { sent++; };
  await ui.submit(); assert.equal(sent, 1); assert.equal(ui.$("run").disabled, true);
});

test("new revision and different task reset old approval without carrying stale feedback", async () => {
  const ui = setup(output()); ui.choose("revise"); ui.$("reviewFeedback").value = "Old revision feedback"; await ui.submit();
  ui.update(output("content_approval", "v2"));
  assert.equal(ui.$("run").disabled, false); assert.equal(ui.$("reviewFeedback").value, "");
  await ui.submit(); assert.equal(ui.messages.length, 2);
  ui.update(output("content_approval", "v2", "task-B")); await ui.submit(); assert.equal(ui.messages.length, 3);
});

test("a late completion for an old outcome cannot lock or alter a newer review", async () => {
  const wait = deferred(); const ui = setup(output(), { send: () => wait.promise }); const old = ui.submit();
  ui.update(output("content_approval", "v2")); assert.equal(ui.$("run").disabled, false);
  wait.resolve(); await old; assert.equal(ui.$("run").disabled, false);
  assert.doesNotMatch(ui.$("flowState").textContent, /Đã gửi/);
  await ui.submit(); assert.equal(ui.messages.length, 2);
});

test("revise requires feedback; Train is an explicit action and mode changes update submit wording", async () => {
  const content = setup(output()); content.choose("revise"); await content.submit(); assert.equal(content.messages.length, 0);
  const ui = setup(output("asset_review")); ui.choose("train");
  assert.equal(ui.$("run").textContent, "Gửi đề xuất Train");
  await ui.submit(); assert.equal(ui.messages.length, 0);
  ui.$("variableKeys").children[0].click(); ui.$("createSharedFeedback").onclick!();
  const textarea = ui.$("variableItems").querySelectorAll("textarea")[0]; textarea.value = "Use clean product edges"; textarea.oninput!();
  ui.$("modeFeedback").onclick!(); assert.equal(ui.$("run").textContent, "Gửi feedback");
  ui.$("modeTrain").onclick!(); assert.equal(ui.$("run").textContent, "Gửi đề xuất Train");
  await ui.submit(); assert.equal(ui.messages.length, 1);
  assert.match(ui.messages[0].prompt, /submit_training_feedback/); assert.match(ui.messages[0].prompt, /"action":"train"/);
});

test("Train deduplicates its exact payload without blocking later packaging or changed feedback", async () => {
  const ui = setup(output("asset_review")); ui.choose("train");
  ui.$("variableKeys").children[0].click(); ui.$("createSharedFeedback").onclick!();
  let textarea = ui.$("variableItems").querySelectorAll("textarea")[0]; textarea.value = "Clean edges"; textarea.oninput!();
  await ui.submit(); await ui.submit(); assert.equal(ui.messages.length, 1);
  ui.$("backToReview").onclick!(); await ui.choose("package");
  assert.equal(ui.messages.length, 2); assert.equal(ui.$("reviewChoices").children[0].disabled, true);
  ui.choose("train"); assert.equal(ui.$("run").disabled, true); await ui.submit(); assert.equal(ui.messages.length, 2);
  textarea = ui.$("variableItems").querySelectorAll("textarea")[0]; textarea.value = "Use softer lighting"; textarea.oninput!();
  assert.equal(ui.$("run").disabled, false); await ui.submit(); assert.equal(ui.messages.length, 3);
});

test("successful or pending review can return to an enabled new-task launcher", async () => {
  for (const pending of [false, true]) {
    const wait = deferred(); const ui = setup(output(), { send: pending ? () => wait.promise : undefined });
    const sent = ui.submit(); if (!pending) await sent;
    ui.update({ stage: "launcher" });
    assert.equal(ui.$("run").disabled, false); assert.equal(ui.$("run").textContent, "Bắt đầu");
    wait.resolve(); await sent; assert.equal(ui.$("run").disabled, false);
  }
});

test("legacy widgets get unique fallback identities and still deduplicate their own remount", async () => {
  const legacy = { stage: "content_approval" }; const storage = new Map<string, string>();
  const first = setup(legacy, { storage }); await first.submit();
  const second = setup(legacy, { storage }); assert.equal(second.$("run").disabled, false); await second.submit();
  assert.notEqual(first.openai.widgetState.privateContent.legacyReviewId, second.openai.widgetState.privateContent.legacyReviewId);
  const remount = setup(legacy, { state: first.openai.widgetState, storage }); await remount.submit(); assert.equal(remount.messages.length, 0);
});

test("host state persistence failure does not turn an accepted send into a retry", async () => {
  const ui = setup(output()); ui.openai.setWidgetState = () => { throw Error("state unavailable"); };
  await ui.submit(); await ui.submit(); assert.equal(ui.messages.length, 1); assert.equal(ui.$("run").disabled, true);
  const remount = setup(output(), { storage: ui.storage }); await remount.submit(); assert.equal(remount.messages.length, 0);
});

test("an explicit downstream-failure retry enables a fresh submit without automatically replaying", async () => {
  const data = output(); const ui = setup(data); await ui.submit();
  ui.update(data); await ui.submit(); assert.equal(ui.messages.length, 1);
  const retry = { ...data, review_context: createReviewContext({ stage: "content_approval", task_id: "task-A", content_version: "v1", retry_id: "generation-failed-attempt-2" }) };
  ui.update(retry); assert.equal(ui.$("run").disabled, false); assert.equal(ui.messages.length, 1);
  await ui.submit(); assert.equal(ui.messages.length, 2);
  assert.match(ui.messages[1].prompt, /"retry_id":"generation-failed-attempt-2"/);
  ui.update(retry); await ui.submit(); assert.equal(ui.messages.length, 2);
});

test("guided view identifies current step, missing input and next action without inventing execution", async () => {
  const ui = setup({ stage: "launcher" });
  assert.deepEqual(ui.$("workflowSteps").children.map(x => x.textContent), ["1. Brief", "2. Content", "3. Assets", "4. Đóng gói"]);
  assert.equal(ui.$("workflowSteps").children[0].attributes["aria-current"], "step");
  assert.match(ui.$("missingInputs").textContent, /Còn thiếu: URL/);
  ui.$("url").value = "https://example.com/products/test"; ui.$("url").dispatch("input");
  assert.match(ui.$("nextAction").textContent, /Bắt đầu/);
  await ui.submit(); await ui.submit();
  assert.equal(ui.messages.length, 1);
  assert.match(ui.$("flowState").textContent, /Chờ phản hồi/);
  assert.doesNotMatch(ui.$("flowState").textContent, /đang tạo|đã hoàn tất|đang xử lý/i);
  assert.equal(ui.$("newBrief").hidden, false);
  ui.$("newBrief").click(); assert.equal(ui.$("run").disabled, false);
  await ui.submit(); assert.equal(ui.messages.length, 2);
});

test("brief draft keeps edits when refreshed routes arrive and successful duplicate survives remount", async () => {
  const routes = [{ brand: "pawfecthouse", branch: "onepage-system" }, { brand: "giftsoul", branch: "ldp-system" }];
  const ui = setup({ stage: "launcher", routes });
  ui.$("brand").value = "giftsoul"; ui.$("brand").onchange!();
  ui.$("url").value = "https://example.com/products/gift";
  ui.$("custom").value = "Warm lighting"; ui.$("custom").dispatch("blur");
  ui.update({ stage: "launcher", routes }); assert.equal(ui.$("brand").value, "giftsoul");
  assert.equal(ui.$("custom").value, "Warm lighting"); await ui.submit();
  const restored = setup({ stage: "launcher", routes }, { state: ui.openai.widgetState, storage: ui.storage });
  assert.equal(restored.$("url").value, "https://example.com/products/gift");
  await restored.submit(); assert.equal(restored.messages.length, 0);
});

test("feedback drafts survive Back, mode changes, remount and returning to exact review only", () => {
  const first = output("asset_review"); const ui = setup(first); ui.choose("feedback");
  ui.$("variableKeys").children[0].click(); ui.$("createSharedFeedback").click();
  const textarea = ui.$("variableItems").querySelectorAll("textarea")[0]; textarea.value = "Preserve the logo"; textarea.oninput!();
  ui.$("modeTrain").click(); ui.$("backToReview").click(); ui.choose("feedback");
  assert.equal(ui.$("variableItems").querySelectorAll("textarea")[0].value, "Preserve the logo");
  const restored = setup(first, { state: ui.openai.widgetState });
  assert.equal(restored.$("variableItems").querySelectorAll("textarea")[0].value, "Preserve the logo");
  ui.update(output("asset_review", "v2")); ui.choose("feedback");
  assert.equal(ui.$("variableItems").querySelectorAll("textarea").length, 0);
  ui.update(first); assert.equal(ui.$("variableItems").querySelectorAll("textarea")[0].value, "Preserve the logo");
});

test("legacy successful request keys remain consumed after attachment upgrade", async () => {
  const data = output();
  const key = JSON.stringify([data.review_context.review_id, "approve", ""]);
  const ui = setup(data, { state: { submittedRequests: [key] } });
  await ui.submit(); assert.equal(ui.messages.length, 0); assert.equal(ui.$("run").disabled, true);
});

test("an outcome summary is plain text and removed for a different revision", () => {
  const ui = setup({ ...output(), result_summary: "<script>do not run</script>\nContent draft ready" });
  assert.equal(ui.$("resultSummary").hidden, false);
  assert.match(ui.$("resultSummary").textContent, /<script>/);
  ui.update(output("content_approval", "v2")); assert.equal(ui.$("resultSummary").hidden, true);
});

function fileInput(ui: ReturnType<typeof setup>) { return ui.$("attachmentInput").querySelectorAll("input")[0]; }
async function flushAttachmentWork() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }

test("image evidence uses documented structured state before a prompt-only follow-up, including after mode edits", async () => {
  const events: string[] = []; const ui = setup(output(), { host: {
    uploadFile: async () => ({ fileId: "file-image-1" }),
    setWidgetState(state: any) { this.widgetState = state; if (state.imageIds?.length) events.push("image-state"); },
    sendFollowUpMessage: async (message: any) => { assert.deepEqual(Object.keys(message), ["prompt"]); events.push("send"); },
  } });
  ui.choose("revise"); ui.$("reviewFeedback").value = "Match this reference"; ui.$("reviewFeedback").oninput!();
  const input = fileInput(ui); input.files = [new File([new Uint8Array([137,80,78,71,13,10,26,10])], "reference.png", { type: "image/png" })]; input.onchange!();
  await flushAttachmentWork(); await ui.submit();
  assert.ok(events.includes("send")); assert.ok(events.indexOf("image-state") < events.indexOf("send"));
  assert.deepEqual(Array.from(ui.openai.widgetState.imageIds), ["file-image-1"]);
  assert.match(ui.openai.widgetState.modelContent.instruction, /untrusted/);
  await ui.choose("approve"); ui.choose("revise");
  assert.deepEqual(Array.from(ui.openai.widgetState.imageIds), ["file-image-1"]);
});

test("pending or failed attachments prevent an accidental text-only submit; remove recovers", async () => {
  const wait = deferred(); const ui = setup(output(), { host: { uploadFile: async () => { await wait.promise; return { fileId: "file-late" }; } } });
  ui.choose("revise"); ui.$("reviewFeedback").value = "Use the reference";
  const input = fileInput(ui); input.files = [new File(["image"], "reference.png", { type: "image/png" })]; input.onchange!();
  await ui.submit(); assert.equal(ui.messages.length, 0); assert.match(ui.$("error").textContent, /tệp|ảnh/i);
  const remove = ui.$("attachmentInput").querySelectorAll("button").find(x => x.textContent === "Xóa")!; remove.click();
  await ui.submit(); assert.equal(ui.messages.length, 1);
  wait.resolve(); await flushAttachmentWork();
  assert.equal(ui.$("attachmentInput").querySelectorAll("button").some(x => x.textContent === "Xóa"), false);
});

test("local document extracted content and truncation reach prompt and model state without remote ingestion", async () => {
  let remoteCalls = 0;
  const ui = setup({ stage: "launcher" }, { host: {
    uploadFile: async () => ({ fileId: "file-doc-local" }),
    callTool: async () => { remoteCalls++; throw Error("must not fetch local text"); },
  } });
  ui.$("url").value = "https://example.com/product";
  const input = fileInput(ui); input.files = [new File(["source fact ".repeat(2000)], "brief.txt", { type: "text/plain" })]; input.onchange!();
  await flushAttachmentWork(); await ui.submit();
  assert.equal(remoteCalls, 0); assert.equal(ui.messages.length, 1);
  assert.match(ui.messages[0].prompt, /"extracted_text":"source fact/);
  assert.match(ui.messages[0].prompt, /"truncated":true/);
  assert.match(ui.messages[0].prompt, /untrusted reference data/);
  assert.equal(ui.openai.widgetState.modelContent.attachments[0].truncated, true);
  assert.deepEqual(Array.from(ui.openai.widgetState.imageIds), []);
});

test("serialized host snapshots preserve the latest unblurred brief, content and group feedback edits", () => {
  const brief = setup({ stage: "launcher" });
  brief.$("url").value = "https://example.com/latest"; brief.$("url").dispatch("input");
  brief.$("custom").value = "Latest brief keystroke"; brief.$("custom").dispatch("input");
  const briefRestored = setup({ stage: "launcher" }, { state: brief.openai.widgetState });
  assert.equal(briefRestored.$("url").value, "https://example.com/latest");
  assert.equal(briefRestored.$("custom").value, "Latest brief keystroke");
  const content = setup(output()); content.choose("revise"); content.$("reviewFeedback").value = "Latest content edit"; content.$("reviewFeedback").oninput!();
  assert.equal(setup(output(), { state: content.openai.widgetState }).$("reviewFeedback").value, "Latest content edit");
  const assets = setup(output("asset_review")); assets.choose("feedback"); assets.$("variableKeys").children[0].click(); assets.$("createSharedFeedback").click();
  const area = assets.$("variableItems").querySelectorAll("textarea")[0]; area.value = "Latest group edit"; area.oninput!();
  assert.equal(setup(output("asset_review"), { state: assets.openai.widgetState }).$("variableItems").querySelectorAll("textarea")[0].value, "Latest group edit");
});

test("cleared draft inputs stay empty through same-output host updates", () => {
  const data = { stage: "launcher" }; const ui = setup(data, { state: { url: "https://example.com/old", theme: "Old theme", custom: "Old requirements" } });
  for (const id of ["url", "theme", "custom"]) { ui.$(id).value = ""; ui.$(id).dispatch("input"); }
  ui.update(data);
  for (const id of ["url", "theme", "custom"]) assert.equal(ui.$(id).value, "");
});

test("asset groups use exact metadata safely even for prototype-like section names", () => {
  const data = { ...output("asset_review"), assets: [{ id: "prototype-1", element: "__proto__", position: "desktop" }, { id: "prototype-2", element: "constructor" }] };
  const ui = setup(data); ui.choose("feedback");
  const buttons = ui.$("variableKeys").querySelectorAll("button").map(x => x.textContent);
  assert.ok(buttons.some(x => x.includes("__proto__"))); assert.ok(buttons.some(x => x.includes("constructor")));
});

test("confirmed delivery keeps the fourth step and exposes revise/new-task without repackaging", async () => {
  const ui = setup({ ...output("complete"), result_summary: "Delivered assets.zip in the conversation" });
  assert.equal(ui.$("workflowSteps").children[3].attributes["aria-current"], "step");
  assert.match(ui.$("stageHint").textContent, /file\/link/);
  assert.deepEqual(ui.$("reviewChoices").children.map(x => x.textContent), ["Sửa tiếp", "Task mới"]);
  await ui.choose("new_task");
  assert.equal(ui.messages.length, 1); assert.match(ui.messages[0].prompt, /launch_creative_dna/);
  assert.match(ui.$("flowState").textContent, /Chờ kết quả mới/);
});

test("delivery revise opens asset feedback without requiring an invisible feedback draft", async () => {
  const ui = setup(output("complete"));
  assert.equal(ui.$("reviewFeedback").hidden, true);
  await ui.submit(); assert.equal(ui.messages.length, 1);
  assert.match(ui.messages[0].prompt, /stage=asset_review/);
});

test("the complete outcome is before actions, is never interpreted as HTML, and clears on revision", () => {
  const content = "Full content section\n<script>alert('untrusted')</script>\n".repeat(400);
  const ui = setup({ ...output(), result_content: content, result_summary: "Short summary", result_links: [
    { label: "Actual delivery", url: "https://example.com/result" }, { label: "Unsafe", url: "javascript:alert(1)" }, { label: "Credentials", url: "https://user:secret@example.com/result" },
  ] });
  assert.ok(launcherHtml.indexOf('id="resultContent"') < launcherHtml.indexOf('id="reviewFields"'));
  assert.equal(ui.$("resultContent").textContent, content);
  assert.equal(ui.$("resultContent").children.length, 0);
  assert.equal(ui.$("resultSummary").hidden, true);
  assert.equal(ui.$("resultLinks").children.length, 1);
  const anchor = ui.$("resultLinks").children[0].children[0] as any;
  assert.equal(anchor.href, "https://example.com/result"); assert.equal(anchor.rel, "noopener noreferrer");
  ui.update(output("content_approval", "v2"));
  assert.equal(ui.$("resultContent").textContent, ""); assert.equal(ui.$("resultLinks").children.length, 0);
  assert.match(ui.$("outcomeNote").textContent, /chưa nhận được toàn bộ/);
  ui.update({ stage: "launcher" }); assert.equal(ui.$("reviewOutcome").hidden, true);
});

test("real action-button double clicks and remounts send once; feedback selection does not submit", async () => {
  const wait = deferred(); const data = output(); const ui = setup(data, { send: () => wait.promise });
  const first = ui.choose("approve"); await ui.choose("approve");
  assert.equal(ui.$("reviewChoices").children.every(x => x.disabled), true);
  await Promise.resolve(); assert.equal(ui.messages.length, 1);
  wait.resolve(); await first;
  assert.equal(ui.$("reviewChoices").children[0].disabled, true);
  assert.match(ui.$("reviewChoices").children[0].textContent, /Đã gửi/);
  ui.choose("revise"); assert.equal(ui.messages.length, 1); assert.equal(ui.$("run").hidden, false);
  assert.equal(ui.$("reviewChoices").children[0].disabled, true);
  const restored = setup(data, { state: ui.openai.widgetState }); await restored.choose("approve"); assert.equal(restored.messages.length, 0);
});

test("one-click failed send remains retryable without claiming execution", async () => {
  let fail = true; const ui = setup(output(), { send: async () => { if (fail) throw Error("host denied"); } });
  await ui.choose("approve"); assert.equal(ui.$("reviewChoices").children[0].disabled, false);
  assert.match(ui.$("error").textContent, /host denied/); assert.doesNotMatch(ui.$("flowState").textContent, /hoàn tất|đang tạo/i);
  fail = false; await ui.choose("approve"); assert.equal(ui.messages.length, 2);
  assert.equal(ui.$("reviewChoices").children[0].disabled, true);
});

test("delivery navigation directly calls registered read-only tools and preserves the outcome", async () => {
  for (const action of ["revise", "new_task"]) {
    const calls: any[] = [];
    const result = { ...output("complete"), result_content: "Complete outcome", result_links: [{ label: "Delivery", url: "https://example.com/result" }], result_images: [{ file_id: "file-image-1", label: "Banner" }] };
    const ui = setup(result, { host: { callTool: async (name: string, args: any) => {
      calls.push({ name, args }); return { structuredContent: name === "launch_creative_dna" ? { stage: "launcher", routes: [] } : { ...args, review_context: createReviewContext(args) } };
    } } });
    await ui.choose(action); assert.equal(calls.length, 1); assert.equal(ui.messages.length, 0);
    if (action === "revise") {
      assert.equal(calls[0].name, "show_uid_brands_review"); assert.equal(calls[0].args.stage, "asset_review");
      assert.equal(calls[0].args.task_id, "task-A"); assert.equal(calls[0].args.content_version, "v1");
      assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args.result_images)), result.result_images);
      assert.equal(ui.$("resultContent").textContent, result.result_content); assert.equal(ui.$("resultLinks").children.length, 1);
    } else {
      assert.equal(calls[0].name, "launch_creative_dna"); assert.deepEqual(Object.keys(calls[0].args), ["navigation_id"]); assert.match(calls[0].args.navigation_id, /^navigation-/);
      assert.equal(ui.$("reviewOutcome").hidden, true); assert.equal(ui.$("run").textContent, "Bắt đầu");
    }
  }
});

test("direct navigation is pending-deduplicated; late results cannot replace a newer outcome", async () => {
  const wait = deferred(); let calls = 0;
  const ui = setup(output("complete"), { host: { callTool: async () => { calls++; await wait.promise; return { structuredContent: { stage: "launcher" } }; } } });
  const first = ui.choose("new_task"); await ui.choose("new_task"); assert.equal(calls, 1);
  ui.update({ ...output("asset_review", "v2"), result_content: "Newer outcome" });
  wait.resolve(); await first;
  assert.equal(ui.$("resultContent").textContent, "Newer outcome"); assert.equal(ui.$("reviewOutcome").hidden, false);
  assert.equal(ui.messages.length, 0);
});

test("denied or malformed direct navigation preserves outcome and never falls back to a model prompt", async () => {
  for (const callTool of [async () => { throw Error("permission denied"); }, async () => ({ isError: true }), async () => ({ structuredContent: {} })]) {
    const ui = setup({ ...output("complete"), result_content: "Keep this outcome" }, { host: { callTool } });
    await ui.choose("new_task"); assert.equal(ui.messages.length, 0);
    assert.equal(ui.$("resultContent").textContent, "Keep this outcome"); assert.equal(ui.$("reviewChoices").children[1].disabled, false);
    assert.match(ui.$("error").textContent, /Chưa mở được/);
  }
});

test("image previews use fresh host URLs, never persist signed URLs, and ignore late stale previews", async () => {
  const wait = deferred(); const calls: any[] = [];
  const signedUrl = "https://cdn.example.com/image.png?signature=ephemeral";
  const data = { ...output("asset_review"), result_images: [{ file_id: "file-image-1", label: "Banner" }] };
  const ui = setup(data, { host: { getFileDownloadUrl: async (args: any) => { calls.push(args); await wait.promise; return { downloadUrl: signedUrl }; } } });
  await Promise.resolve(); assert.equal(calls.length, 1); assert.equal(calls[0].fileId, "file-image-1");
  ui.update(output("asset_review", "v2")); wait.resolve(); await flushAttachmentWork();
  assert.equal(ui.$("resultImages").children.length, 0);
  assert.doesNotMatch(JSON.stringify(ui.openai.widgetState), /signature=ephemeral/);
  const loaded = setup(data, { host: { getFileDownloadUrl: async () => ({ downloadUrl: signedUrl }) } });
  await flushAttachmentWork(); const img = loaded.$("resultImages").children[0].children[0] as any;
  assert.equal(img.tag, "img"); assert.equal(img.src, signedUrl); assert.equal(img.referrerPolicy, "no-referrer");
  loaded.choose("feedback"); assert.doesNotMatch(JSON.stringify(loaded.openai.widgetState), /signature=ephemeral/);
});

test("unavailable or unsafe image previews retain attachment labels and never add arbitrary image URLs", async () => {
  const data = { ...output("asset_review"), result_images: [{ file_id: "file-image-1", label: "Banner" }] };
  for (const host of [{}, { getFileDownloadUrl: async () => ({ downloadUrl: "javascript:alert(1)" }) }, { getFileDownloadUrl: async () => { throw Error("unavailable"); } }]) {
    const ui = setup(data, { host }); await flushAttachmentWork();
    const figure = ui.$("resultImages").children[0]; assert.equal(figure.children.length, 1);
    assert.equal(figure.children[0].tag, "figcaption"); assert.match(figure.children[0].textContent, /ảnh gốc/);
  }
});

test("Task mới starts a fresh brief after an earlier brief was submitted in the same widget", async () => {
  const ui = setup({ stage: "launcher" }, { host: { callTool: async () => ({ structuredContent: { stage: "launcher" } }) } });
  ui.$("url").value = "https://example.com/product"; await ui.submit();
  const oldBriefId = ui.openai.widgetState.privateContent.briefId;
  assert.equal(ui.$("run").disabled, true);
  ui.update(output("complete")); await ui.choose("new_task");
  assert.notEqual(ui.openai.widgetState.privateContent.briefId, oldBriefId);
  assert.equal(ui.$("url").value, "https://example.com/product");
  assert.equal(ui.$("run").disabled, false); assert.equal(ui.$("run").textContent, "Bắt đầu");
  await ui.submit(); assert.equal(ui.messages.length, 2);
});

test("late app-navigation globals events cannot replace a newer review before or after the promise", async () => {
  const wait = deferred(); let navigationId = "";
  const ui = setup(output("complete"), { host: { callTool: async (_name: string, args: any) => { navigationId = args.navigation_id; await wait.promise; return { structuredContent: { stage: "launcher", navigation_id: navigationId } }; } } });
  const request = ui.choose("new_task");
  ui.update({ ...output("asset_review", "v2"), result_content: "Newer outcome" });
  ui.update({ stage: "launcher", navigation_id: navigationId });
  assert.equal(ui.$("resultContent").textContent, "Newer outcome");
  wait.resolve(); await request;
  ui.update({ stage: "launcher", navigation_id: navigationId });
  assert.equal(ui.$("resultContent").textContent, "Newer outcome"); assert.equal(ui.$("reviewOutcome").hidden, false);
  // Normal model-driven tool outputs still navigate.
  ui.update({ stage: "launcher" }); assert.equal(ui.$("reviewOutcome").hidden, true);
});

test("external link denial is reported without silently bypassing the host", async () => {
  const ui = setup({ ...output(), result_links: [{ label: "Delivery", url: "https://example.com/result" }] }, { host: { openExternal: () => { throw Error("denied"); } } });
  let prevented = false;
  const anchor = ui.$("resultLinks").children[0].children[0] as any;
  anchor.onclick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.match(ui.$("error").textContent, /Host chưa mở được liên kết/);
});

function groupArea(ui: ReturnType<typeof setup>, index = 0) { return ui.$("variableItems").querySelectorAll("textarea")[index]; }
function addOverallGroup(ui: ReturnType<typeof setup>) { ui.$("variableKeys").children[0].click(); ui.$("createSharedFeedback").click(); }
function enterAtSelection(ui: ReturnType<typeof setup>, text: string, composing = false) {
  const area = ui.document.activeElement;
  assert.ok(area?.isConnected && area.tag === "textarea", "typing requires the original connected, focused textarea");
  const start = area.selectionStart;
  area.value = area.value.slice(0, start) + text + area.value.slice(area.selectionEnd);
  area.setSelectionRange(start + text.length, start + text.length); area.composing = composing;
  area.oninput?.({ target: area, isComposing: composing });
}

for (const mode of ["feedback", "train"]) for (const echo of ["sync", "microtask", "state-only"] as const) {
  test(`${mode} keeps its focused textarea and caret across ${echo} widget-state echoes`, async () => {
    const data = output("asset_review"); const ui = setup(data, { globalsEcho: echo });
    ui.choose(mode); addOverallGroup(ui); await Promise.resolve();
    const area = groupArea(ui); area.focus();
    for (const char of "abcdef") {
      enterAtSelection(ui, char); await Promise.resolve();
      assert.ok(groupArea(ui) === area, "DOM identity/focus must stay unchanged"); assert.ok(ui.document.activeElement === area, "DOM identity/focus must stay unchanged");
      assert.equal(area.selectionStart, area.value.length); assert.equal(area.selectionEnd, area.value.length);
    }
    assert.equal(area.value, "abcdef");
    area.setSelectionRange(2, 4); enterAtSelection(ui, "XY"); await Promise.resolve();
    assert.equal(area.value, "abXYef"); assert.deepEqual([area.selectionStart, area.selectionEnd], [4, 4]);
    // A selection deletion models Backspace without refocusing the control.
    area.setSelectionRange(3, 4); enterAtSelection(ui, ""); await Promise.resolve();
    assert.equal(area.value, "abXef"); assert.equal(area.selectionStart, 3);
    const draft = ui.openai.widgetState.privateContent.reviewDrafts[data.review_context.review_id];
    assert.equal(draft.variableItems[0].text, "abXef"); assert.equal(ui.messages.length, 0);
  });
}

test("text paste and Vietnamese composition retain the same node, selection and latest draft", async () => {
  const data = output("asset_review"); const ui = setup(data, { globalsEcho: "microtask" });
  ui.choose("feedback"); addOverallGroup(ui); await Promise.resolve();
  const area = groupArea(ui); area.focus(); let prevented = false;
  ui.$("reviewFields").dispatch("paste", { clipboardData: { files: [], items: [{ kind: "string", type: "text/plain" }] }, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, "ordinary text paste must not be consumed by attachment handling");
  enterAtSelection(ui, "Góp ý tiếng Việt\nGiữ đúng màu sắc."); await Promise.resolve();
  assert.equal(area.value, "Góp ý tiếng Việt\nGiữ đúng màu sắc."); assert.ok(ui.document.activeElement === area, "DOM identity/focus must stay unchanged");
  area.setSelectionRange(0, 3); enterAtSelection(ui, "Gó", true); await Promise.resolve();
  const writes = area.valueWrites;
  ui.update({ ...data, result_content: "Updated outcome context during composition" });
  assert.ok(groupArea(ui) === area, "DOM identity/focus must stay unchanged"); assert.equal(area.valueWrites, writes);
  assert.equal(area.composing, true); assert.deepEqual([area.selectionStart, area.selectionEnd], [2, 2]);
  area.setSelectionRange(0, 2); enterAtSelection(ui, "Góp", false); await Promise.resolve();
  assert.equal(area.value, "Góp ý tiếng Việt\nGiữ đúng màu sắc."); assert.ok(ui.document.activeElement === area, "DOM identity/focus must stay unchanged");
  assert.equal(ui.openai.widgetState.privateContent.reviewDrafts[data.review_context.review_id].variableItems[0].text, area.value);
  assert.equal(ui.messages.length, 0);
});

test("equal cloned, wrapped and reordered tool outputs do not rebuild the review", () => {
  const data = { ...output("asset_review"), result_content: "Current outcome" }; const ui = setup(data);
  ui.choose("feedback"); addOverallGroup(ui); const area = groupArea(ui); area.focus(); enterAtSelection(ui, "Draft");
  const choice = ui.$("reviewChoices").children[0]; const step = ui.$("workflowSteps").children[0];
  function reverseKeys(value: any): any { return Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value; }
  ui.update({ structuredContent: reverseKeys(JSON.parse(JSON.stringify(data))) });
  assert.ok(ui.$("reviewChoices").children[0] === choice, "DOM identity/focus must stay unchanged"); assert.ok(ui.$("workflowSteps").children[0] === step, "DOM identity/focus must stay unchanged");
  ui.globals({ theme: "dark", widgetState: ui.openai.widgetState });
  assert.ok(groupArea(ui) === area, "DOM identity/focus must stay unchanged"); assert.ok(ui.document.activeElement === area, "DOM identity/focus must stay unchanged"); assert.equal(ui.messages.length, 0);
});

test("genuine same-review metadata and ordered asset changes update without rewriting an active group", () => {
  const data = output("asset_review"); const ui = setup(data, { globalsEcho: "sync" });
  ui.choose("feedback"); addOverallGroup(ui); const area = groupArea(ui); area.focus(); enterAtSelection(ui, "Original draft");
  area.setSelectionRange(2, 5); const writes = area.valueWrites;
  const assets = [{ id: "asset-1", element: "Banner", position: "mobile" }, { id: "asset-2", element: "Banner", position: "desktop" }];
  ui.update({ ...data, assets, result_content: "Genuinely updated outcome", result_links: [{ label: "New result", url: "https://example.com/new-result" }] });
  assert.equal(ui.$("resultContent").textContent, "Genuinely updated outcome");
  assert.equal(ui.$("resultLinks").children[0].children[0].textContent, "New result");
  assert.match(ui.$("variableKeys").querySelectorAll("button").map(x => x.textContent).join("|"), /mobile/);
  assert.ok(groupArea(ui) === area, "DOM identity/focus must stay unchanged"); assert.equal(area.valueWrites, writes); assert.ok(ui.document.activeElement === area, "DOM identity/focus must stay unchanged");
  assert.deepEqual([area.selectionStart, area.selectionEnd], [2, 5]);
  ui.update({ ...data, assets: [...assets].reverse() });
  const labels = ui.$("variableKeys").querySelectorAll("button").map(x => x.textContent);
  assert.ok(labels.findIndex(x => x.includes("desktop")) < labels.findIndex(x => x.includes("mobile")), "array reordering is a real output update");
  assert.ok(groupArea(ui) === area, "DOM identity/focus must stay unchanged"); assert.equal(area.valueWrites, writes); assert.equal(ui.messages.length, 0);
});

test("multi-select and removing or adding other groups preserve the active textarea despite legacy ID collisions", () => {
  const data = { ...output("asset_review"), assets: [{ id: "asset-1", element: "Banner", position: "desktop" }, { id: "asset-2", element: "Banner", position: "mobile" }] };
  const ui = setup(data, { globalsEcho: "sync" }); ui.choose("feedback"); addOverallGroup(ui); addOverallGroup(ui);
  const active = groupArea(ui, 1); active.focus(); enterAtSelection(ui, "Keep group two"); active.setSelectionRange(2, 6);
  ui.$("variableItems").querySelectorAll("button")[0].click();
  assert.ok(groupArea(ui) === active, "DOM identity/focus must stay unchanged"); assert.ok(ui.document.activeElement === active, "DOM identity/focus must stay unchanged");
  // group-1 already survives; adding now produces the same persisted key.
  addOverallGroup(ui); assert.ok(groupArea(ui) === active, "DOM identity/focus must stay unchanged"); assert.notEqual(groupArea(ui, 1), active);
  const groups = ui.openai.widgetState.privateContent.reviewDrafts[data.review_context.review_id].variableItems;
  assert.equal(groups[0].key, groups[1].key); assert.equal(groups[0].text, "Keep group two"); assert.equal(groups[1].text, "");
  ui.$("variableKeys").querySelectorAll("button").find(x => x.textContent.includes("Chọn cả nhóm"))!.click();
  assert.match(ui.$("targetCount").textContent, /Đã chọn 2 mục/); ui.$("createSharedFeedback").click();
  assert.ok(groupArea(ui) === active, "DOM identity/focus must stay unchanged"); assert.deepEqual([active.selectionStart, active.selectionEnd], [2, 6]);
  const latest = ui.openai.widgetState.privateContent.reviewDrafts[data.review_context.review_id].variableItems;
  assert.deepEqual(Array.from(latest[2].targets), ["asset-1", "asset-2"]);
  ui.$("variableItems").querySelectorAll("button")[1].click();
  assert.ok(groupArea(ui) === active, "DOM identity/focus must stay unchanged"); assert.equal(active.value, "Keep group two");
  ui.$("modeTrain").click(); ui.$("modeFeedback").click(); ui.$("backToReview").click(); ui.choose("feedback");
  assert.ok(groupArea(ui) === active, "DOM identity/focus must stay unchanged"); assert.equal(active.value, "Keep group two"); assert.equal(ui.messages.length, 0);
});

test("real task, version and retry transitions isolate drafts, then restore only the exact earlier review", () => {
  const first = output("asset_review"); const ui = setup(first, { globalsEcho: "sync" });
  ui.choose("train"); addOverallGroup(ui); groupArea(ui).focus(); enterAtSelection(ui, "Draft for first review");
  for (const next of [output("asset_review", "v2"), output("asset_review", "v1", "task-B"), { ...first, review_context: createReviewContext({ stage: "asset_review", task_id: "task-A", content_version: "v1", retry_id: "attempt-2" }) }]) {
    ui.update(next); ui.choose("feedback"); assert.equal(ui.$("variableItems").querySelectorAll("textarea").length, 0);
    assert.equal(ui.$("run").disabled, false); assert.equal(ui.messages.length, 0);
  }
  ui.update(first); assert.equal(groupArea(ui).value, "Draft for first review"); assert.equal(ui.$("run").textContent, "Gửi đề xuất Train");
  const restored = setup(first, { state: ui.openai.widgetState, globalsEcho: "sync" });
  assert.equal(groupArea(restored).value, "Draft for first review"); assert.equal(restored.messages.length, 0);
});

test("pending and failed attachments with globals echoes never replace a focused feedback draft or submit it", async () => {
  const upload = deferred(); const ui = setup(output("asset_review"), { globalsEcho: "microtask", host: { uploadFile: async () => { await upload.promise; throw Error("Synthetic upload failure"); } } });
  ui.choose("feedback"); addOverallGroup(ui); await Promise.resolve(); const area = groupArea(ui); area.focus(); enterAtSelection(ui, "Keep this draft");
  const input = fileInput(ui); input.files = [new File(["image"], "synthetic.png", { type: "image/png" })]; input.onchange!();
  await flushAttachmentWork(); assert.ok(groupArea(ui) === area, "DOM identity/focus must stay unchanged"); assert.ok(ui.document.activeElement === area, "DOM identity/focus must stay unchanged");
  await ui.submit(); assert.equal(ui.messages.length, 0);
  upload.resolve(); await flushAttachmentWork(); assert.ok(groupArea(ui) === area, "DOM identity/focus must stay unchanged"); assert.equal(area.value, "Keep this draft");
  // Submitting may temporarily disable and blur an input in a real browser.
  // After that attempt, assert retained node/text rather than modeled focus.
  await ui.submit(); assert.equal(ui.messages.length, 0);
});
