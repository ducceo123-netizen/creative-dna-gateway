import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { launcherHtml } from "../uid-brands-workflow.ts";
import { REVIEW_STEPS, REVIEW_STAGES } from "../uid-brands-actions.ts";
import { createReviewContext } from "../uid-brands-review-contract.ts";

// Execute the actual embedded script. The host bridge is deliberately mocked:
// these tests do not claim to authenticate a click or execute a ChatGPT task.
const script = launcherHtml.match(/<script>([\s\S]*?)<\/script>/)![1];
class Element {
  children: Element[] = []; value = ""; textContent = ""; disabled = false; hidden = false;
  onclick?: () => any; oninput?: () => any; onchange?: () => any;
  attributes: Record<string, string> = {};
  classList = { toggle() {}, add() {} };
  listeners: Record<string, ((event: any) => void)[]> = {};
  files: any[] = [];
  constructor(public tag = "div") {}
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  addEventListener(name: string, fn: (event: any) => void) { (this.listeners[name] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(name: string, event: any = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  replaceChildren(...children: Element[]) { this.children = children; }
  appendChild(child: Element) { this.children.push(child); }
  append(...children: Element[]) { this.children.push(...children); }
  querySelectorAll(selector: string): Element[] {
    const tags = selector.split(",").map(x => x.trim());
    return this.children.flatMap(child => [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  click() { if (!this.disabled) return this.onclick?.(); }
}
function output(stage: typeof REVIEW_STAGES[number] = "content_approval", version = "v1", task = "task-A") {
  return { stage, assets: [{ id: "asset-1", element: "Banner", position: "desktop" }], review_context: createReviewContext({ stage, task_id: task, content_version: version }) };
}
function setup(data: any = output(), options: { send?: (message: any) => Promise<any>; bridge?: boolean; state?: any; storage?: Map<string, string>; host?: Record<string, any> } = {}) {
  const nodes = new Map<string, Element>();
  const $ = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element(id.includes("Feedback") ? "textarea" : "div")); return nodes.get(id)!; };
  const storage = options.storage || new Map<string, string>();
  const messages: any[] = []; const events: Record<string, (event: any) => void> = {};
  const openai: any = { toolOutput: data, widgetState: options.state || {}, setWidgetState(state: any) { this.widgetState = JSON.parse(JSON.stringify(state)); } };
  if (options.bridge !== false) openai.sendFollowUpMessage = async (message: any) => { messages.push(message); return options.send?.(message); };
  Object.assign(openai, options.host || {});
  $("reviewFields").append($("reviewChoices"), $("assetFeedbackFields"), $("reviewFeedback"));
  $("assetFeedbackFields").append($("variableKeys"), $("variableItems"));
  const window = { openai, sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) }, addEventListener: (name: string, fn: any) => { events[name] = fn; } };
  vm.runInNewContext(script, { window, document: { body: new Element(), getElementById: $, createElement: (tag: string) => new Element(tag) }, URL, Set, File, Blob, TextDecoder, Uint8Array });
  return { $, nodes, messages, openai, storage, update(next: any) { openai.toolOutput = next; events["openai:set_globals"]({ detail: { globals: { toolOutput: next } } }); },
    choose(value: string) { const action = REVIEW_STEPS[openai.toolOutput.stage as typeof REVIEW_STAGES[number]].choices.findIndex(x => x.value === value); return $("reviewChoices").children[action].click(); },
    submit() { return $("run").onclick!(); } };
}
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

for (const stage of REVIEW_STAGES) test(`embedded ${stage} choices match the native action contract`, () => {
  const ui = setup(output(stage));
  assert.deepEqual(ui.$("reviewChoices").children.map(x => x.textContent), REVIEW_STEPS[stage].choices.map(x => `Chọn: ${x.label}`));
  assert.equal(ui.$("run").textContent, REVIEW_STEPS[stage].choices[0].submitLabel);
});

test("selecting a choice does not submit; explicit submit sends the exact version and action", async () => {
  const data = output(); const ui = setup(data);
  ui.choose("approve"); assert.equal(ui.messages.length, 0);
  assert.notEqual(ui.$("reviewChoices").children[0].textContent, ui.$("run").textContent);
  await ui.submit(); assert.equal(ui.messages.length, 1);
  const message = ui.messages[0].prompt;
  assert.ok(message.includes('"task_id":"task-A"'));
  assert.ok(message.includes('"content_version":"v1"'));
  assert.ok(message.includes('"action":"approve"'));
  assert.ok(message.includes("not authentication"));
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
  ui.$("backToReview").onclick!(); ui.choose("package");
  assert.equal(ui.$("run").disabled, false); await ui.submit(); assert.equal(ui.messages.length, 2);
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
  ui.choose("approve"); ui.choose("revise");
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
  assert.deepEqual(ui.$("reviewChoices").children.map(x => x.textContent), ["Chọn: Sửa tiếp", "Chọn: Task mới"]);
  ui.choose("new_task"); assert.equal(ui.messages.length, 0); await ui.submit();
  assert.equal(ui.messages.length, 1); assert.match(ui.messages[0].prompt, /launch_creative_dna/);
  assert.match(ui.$("flowState").textContent, /Chờ kết quả mới/);
});

test("delivery revise opens asset feedback without requiring an invisible feedback draft", async () => {
  const ui = setup(output("complete"));
  assert.equal(ui.$("reviewFeedback").hidden, true);
  await ui.submit(); assert.equal(ui.messages.length, 1);
  assert.match(ui.messages[0].prompt, /stage=asset_review/);
});
