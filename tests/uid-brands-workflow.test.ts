import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { launcherHtml } from "../uid-brands-workflow.ts";
import { REVIEW_STEPS, REVIEW_STAGES, OUTCOME_RENDER_GUIDANCE } from "../uid-brands-actions.ts";
import { createReviewContext } from "../uid-brands-review-contract.ts";

// Execute the actual embedded script. The host bridge is deliberately mocked:
// these tests do not claim to authenticate a click or execute a ChatGPT task.
const script = launcherHtml.match(/<script>([\s\S]*?)<\/script>/)![1];
// Small deterministic DOM model, not a browser/IME implementation. Detaching
// the focused node or writing its value resets modeled selection/composition.
// These invariants catch the host-echo regression without claiming real-device QA.
type FocusDocument = { activeElement: Element | null; body: Element };
class Element {
  layoutHeight=360;
  getBoundingClientRect(){return {height:this.layoutHeight};}
  children: Element[] = []; textContent = ""; disabled = false; hidden = false; open = true;
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
function setup(data: any = output(), options: { timers?: { setTimeout: any; clearTimeout: any }; send?: (message: any) => Promise<any>; bridge?: boolean; state?: any; storage?: Map<string, string>; host?: Record<string, any>; clipboard?: { writeText: (text: string) => Promise<void> }; sizing?: { callback?: () => void; frames: Array<() => void> }; globalsEcho?: "sync" | "microtask" | "state-only" } = {}) {
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
  $("actionablePanel").append($("taskTabPanel"), $("feedbackTabPanel"), $("attachmentSection"), $("run"));
  $("taskTabPanel").append($("launchFields"),$("reviewFields"));
  $("reviewFields").append($("primaryActions"));$("primaryActions").append($("reviewChoices"));
  $("feedbackTabPanel").append($("assetFeedbackFields"),$("reviewFeedback"));
  $("assetFeedbackFields").append($("variableKeys"), $("variableItems"));
  const window = { ...(options.sizing?{ResizeObserver: class { constructor(callback:()=>void){options.sizing!.callback=callback;} observe(){} },requestAnimationFrame:(callback:()=>void)=>options.sizing!.frames.push(callback)}:{}), openai, navigator: { clipboard: options.clipboard }, sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) }, addEventListener: (name: string, fn: any) => { const previous=events[name];events[name]=(event:any)=>{previous?.(event);fn(event);}; } };
  vm.runInNewContext(script, { setTimeout: options.timers?.setTimeout || setTimeout, clearTimeout: options.timers?.clearTimeout || clearTimeout, window, document: { body: document.body, get activeElement() { return document.activeElement; }, getElementById: $, createElement: (tag: string) => new Element(tag, document) }, URL, Set, File, Blob, TextDecoder, Uint8Array });
  return { $, nodes, messages, openai, storage, document, snapshot() { events.pagehide({}); return openai.widgetState; }, globals(globals: any) { events["openai:set_globals"]({ detail: { globals } }); }, update(next: any) { openai.toolOutput = next; events["openai:set_globals"]({ detail: { globals: { toolOutput: next } } }); },
    choose(value: string) { const action = REVIEW_STEPS[openai.toolOutput.stage as typeof REVIEW_STAGES[number]].choices.findIndex(x => x.value === value); return $("reviewChoices").children[action].click(); },
    submit() { return $("run").onclick!(); } };
}
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function fileInput(ui: ReturnType<typeof setup>) { return ui.$("attachmentInput").querySelectorAll("input")[0]; }
async function flushAttachmentWork() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }

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
    const draft = ui.snapshot().privateContent.reviewDrafts[data.review_context.review_id];
    assert.equal(draft.variableItems[0].text, "abXef"); assert.equal(ui.messages.length, 0);
  });
}

test("text paste and Vietnamese composition retain the same node, selection and latest draft", async () => {
  const data = output("asset_review"); const ui = setup(data, { globalsEcho: "microtask" });
  ui.choose("feedback"); addOverallGroup(ui); await Promise.resolve();
  const area = groupArea(ui); area.focus(); let prevented = false;
  ui.$("feedbackTabPanel").dispatch("paste", { clipboardData: { files: [], items: [{ kind: "string", type: "text/plain" }] }, preventDefault() { prevented = true; } });
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
  assert.equal(ui.snapshot().privateContent.reviewDrafts[data.review_context.review_id].variableItems[0].text, area.value);
  assert.equal(ui.messages.length, 0);
});

test("equal cloned, wrapped and reordered tool outputs do not rebuild the review", () => {
  const data = { ...output("asset_review"), result_content: "Current outcome" }; const ui = setup(data);
  ui.choose("feedback"); addOverallGroup(ui); const area = groupArea(ui); area.focus(); enterAtSelection(ui, "Draft");
  const choice = ui.$("reviewChoices").children[0]; const step = ui.$("workflowSteps").children[0];
  function reverseKeys(value: any): any { return Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value; }
  ui.update({ structuredContent: reverseKeys(JSON.parse(JSON.stringify(data))) });
  assert.ok(ui.$("reviewChoices").children[0] === choice, "DOM identity/focus must stay unchanged"); assert.ok(ui.$("workflowSteps").children[0] === step, "DOM identity/focus must stay unchanged");
  ui.globals({ theme: "dark", widgetState: ui.snapshot() });
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
  const groups = ui.snapshot().privateContent.reviewDrafts[data.review_context.review_id].variableItems;
  assert.equal(groups[0].key, groups[1].key); assert.equal(groups[0].text, "Keep group two"); assert.equal(groups[1].text, "");
  ui.$("variableKeys").querySelectorAll("button").find(x => x.textContent.includes("Chọn cả nhóm"))!.click();
  assert.match(ui.$("targetCount").textContent, /Đã chọn 2 mục/); ui.$("createSharedFeedback").click();
  assert.ok(groupArea(ui) === active, "DOM identity/focus must stay unchanged"); assert.deepEqual([active.selectionStart, active.selectionEnd], [2, 6]);
  const latest = ui.snapshot().privateContent.reviewDrafts[data.review_context.review_id].variableItems;
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
  ui.update(first); assert.equal(groupArea(ui).value, "Draft for first review"); assert.equal(ui.$("run").textContent, "Tạo prompt");
  const restored = setup(first, { state: ui.snapshot(), globalsEcho: "sync" });
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

const legacyOnepageAssets = [
  { asset_id: "product-gtk_02.webp", element: "Care instructions image", label: "A very long creative headline that must never be a heading" },
  { id: "banner_desktop", element: "Banner Desktop — product story" },
  { id: "banner_mobile", section: "BANNER", element: "Mobile hero crop" },
  { id: "onepage_product-wyl_01.webp", element: "A unique benefit title" },
  { id: "opaque-benefit", section: "WHY YOU’LL LOVE IT", element: "Another benefit title", position: "02" },
  { id: "detail_01", element: "Product_Details_01" },
  { id: "occasion_story_01_mobile", section: "Product Details", element: "Main image", position: "main" },
  { id: "detail_main", section: "PD", position: "main" },
  { id: "gtk_01", element: "Good-to-know — 01" },
  { id: "opaque-gtk", section: "unknown", element: "GTK03" },
  { id: "detail_01", section: "Bad duplicate" },
];
function sectionButtons(ui: ReturnType<typeof setup>) { return ui.$("variableKeys").querySelectorAll("button").filter(x => x.textContent.includes("Chọn cả nhóm")); }

test("legacy Onepage slots and free-form elements collapse into ordered canonical sections", () => {
  const ui = setup({ ...output("asset_review"), assets: legacyOnepageAssets }); ui.choose("feedback");
  assert.deepEqual(sectionButtons(ui).map(x => x.textContent), [
    "Chọn cả nhóm: Banner (2)", "Chọn cả nhóm: Why You'll Love It (2)",
    "Chọn cả nhóm: Product Details (3)", "Chọn cả nhóm: Good To Know (3)",
  ]);
  const labels = ui.$("variableKeys").querySelectorAll("button").filter(x => !x.textContent.includes("Chọn cả nhóm")).map(x => x.textContent);
  assert.deepEqual(labels, ["Overall", "Banner · desktop", "Banner · mobile", "WYL · 01", "WYL · 02", "PD · 01", "PD · main", "PD · main", "GTK · 02", "GTK · 01", "GTK · 03"]);
  assert.ok(labels.every(x => x.length < 25));
  ui.update({ ...output("asset_review"), assets: [...legacyOnepageAssets].reverse().filter(x => x.section !== "Bad duplicate") });
  assert.deepEqual(sectionButtons(ui).map(x => x.textContent), ["Chọn cả nhóm: Banner (2)", "Chọn cả nhóm: Why You'll Love It (2)", "Chọn cả nhóm: Product Details (3)", "Chọn cả nhóm: Good To Know (3)"]);
});

test("canonical grouping keeps Occasion and FAQ distinct and unknown elements in one group", () => {
  const ui = setup({ ...output("asset_review"), assets: [
    { id: "occasion_icon_01" }, { id: "occasion_story_02" },
    { id: "faq_01" }, { id: "faq_02", section: "FAQs" },
    { id: "random-1", element: "Special creative headline" }, { id: "random-2", section: "Different unique headline" },
  ] }); ui.choose("feedback");
  assert.deepEqual(sectionButtons(ui).map(x => x.textContent), ["Chọn cả nhóm: Perfect for Every Occasion (2)", "Chọn cả nhóm: FAQ (2)", "Chọn cả nhóm: Chưa định danh (2)"]);
});

test("whole-section and mixed asset selection retain exact IDs through metadata reorder and typed host echoes", async () => {
  const data = { ...output("asset_review"), assets: legacyOnepageAssets };
  const ui = setup(data, { globalsEcho: "sync" }); ui.choose("feedback");
  sectionButtons(ui)[1].click(); // Whole WYL section.
  ui.$("variableKeys").querySelectorAll("button").find(x => x.textContent === "Banner · mobile")!.click();
  ui.update({ ...data, assets: [...legacyOnepageAssets].reverse().filter(x => x.section !== "Bad duplicate") });
  assert.match(ui.$("targetCount").textContent, /Đã chọn 3 mục/);
  ui.$("createSharedFeedback").click();
  const area = groupArea(ui); area.focus(); enterAtSelection(ui, "Sửa màu cả nhóm"); area.setSelectionRange(2, 5);
  const writes = area.valueWrites;
  sectionButtons(ui)[2].click(); sectionButtons(ui)[2].click(); // Select/unselect another whole section.
  ui.$("modeTrain").click(); ui.$("modeFeedback").click();
  assert.ok(groupArea(ui) === area); assert.ok(ui.document.activeElement === area);
  assert.equal(area.valueWrites, writes); assert.deepEqual([area.selectionStart, area.selectionEnd], [2, 5]);
  const draft = ui.snapshot().privateContent.reviewDrafts[data.review_context.review_id];
  assert.deepEqual(draft.variableItems[0].targets, ["onepage_product-wyl_01.webp", "opaque-benefit", "banner_mobile"]);
  assert.equal(draft.variableItems[0].text, "Sửa màu cả nhóm");
  await ui.submit();
  for (const id of draft.variableItems[0].targets) assert.ok(ui.$("promptText").value.includes("[asset_id=" + id + "]"));
});


for(const stage of REVIEW_STAGES)test(`all ${stage} actions only prepare text, never dispatch`,async()=>{
 for(const choice of REVIEW_STEPS[stage].choices){
  const ui=setup(output(stage),{host:{callTool:()=>{throw Error("must not call tool");}}});
  await ui.choose(choice.value);
  if("requiresFeedback" in choice){
   if(stage==="asset_review"){addOverallGroup(ui);const a=groupArea(ui);a.value="Make exact selected item clearer";a.oninput?.();}
   else{ui.$("reviewFeedback").value="Revise headline";ui.$("reviewFeedback").oninput?.();}
   await ui.submit();
  }
  assert.match(ui.$("promptText").value, /"task_id":"task-A"/);
  assert.ok(ui.$("promptText").value.includes('"action":"'+choice.value+'"'));
  assert.equal(ui.messages.length,0);assert.equal(ui.$("run").disabled,false);
 }
});
test("brief works without send bridge or persistence and copy fallback selects editable text",async()=>{
 const ui=setup({stage:"launcher"},{bridge:false,host:{setWidgetState:undefined}});
 ui.$("url").value="https://example.com/products/doll";await ui.submit();
 assert.match(ui.$("promptText").value,/Product \/ Collection: https:\/\/example.com/);
 ui.$("promptText").value+="\nMy edit";await ui.$("copyPrompt").click();
 assert.match(ui.$("copyStatus").textContent,/Chưa sao chép/);assert.equal(ui.$("promptText").selectionEnd,ui.$("promptText").value.length);assert.equal(ui.messages.length,0);
});
test("successful copy says copied only, never sent or running",async()=>{
 let copied="";const ui=setup(output(),{clipboard:{async writeText(text){copied=text;}}});await ui.choose("approve");await ui.$("copyPrompt").click();
 assert.equal(copied,ui.$("promptText").value);assert.match(ui.$("copyStatus").textContent,/Đã sao chép/);assert.doesNotMatch(ui.$("copyStatus").textContent,/Đã gửi|Đang xử lý/);assert.equal(ui.messages.length,0);
});
test("draft persistence rejection cannot prevent prompt generation or copy",async()=>{
 const ui=setup(output(),{host:{setWidgetState(){throw Error("storage unavailable");}}});await ui.choose("approve");ui.snapshot();await ui.$("copyPrompt").click();assert.match(ui.$("promptText").value,/Chốt content/);assert.equal(ui.messages.length,0);
});
test("sensitive draft and file evidence never enters model state before manual sending",async()=>{
 const ui=setup(output("asset_review"));ui.choose("feedback");addOverallGroup(ui);groupArea(ui).value="private feedback";groupArea(ui).oninput?.();await ui.submit();const state=ui.snapshot();
 assert.doesNotMatch(JSON.stringify(state.modelContent),/private feedback|asset-1|file_id/);assert.deepEqual(state.imageIds,[]);assert.equal(ui.messages.length,0);
});
test("new version cannot leave a ready prompt bound to stale result",async()=>{
 const ui=setup(output());await ui.choose("approve");ui.update(output("content_approval","v2"));assert.equal(ui.$("promptDock").hidden,true);await ui.choose("approve");assert.match(ui.$("promptText").value,/"content_version":"v2"/);
});
test("composer has compact disclosures and no model dispatch API",()=>{
 assert.doesNotMatch(script,/sendFollowUpMessage/);assert.doesNotMatch(launcherHtml,/58vh/);assert.match(launcherHtml,/id="promptText"/);assert.match(OUTCOME_RENDER_GUIDANCE,/Do not open interactive panels, embedded forms or widgets, even for asset\/group selection/);
});

test("edited prompt drafts survive exact-review remount and remain private",async()=>{
 const data=output();const ui=setup(data);await ui.choose("approve");ui.$("promptText").value="My edited instruction";ui.$("promptText").oninput?.();const state=ui.snapshot();
 const restored=setup(data,{state});assert.equal(restored.$("promptText").value,"My edited instruction");assert.equal(restored.$("promptDock").hidden,false);assert.doesNotMatch(JSON.stringify(state.modelContent),/My edited/);
 restored.update(output("content_approval","v2"));assert.equal(restored.$("promptDock").hidden,true);restored.update(data);assert.equal(restored.$("promptText").value,"My edited instruction");
});
for(const rejected of [false,true])test(`late clipboard ${rejected?"failure":"success"} cannot annotate newer prompt`,async()=>{
 const wait=deferred();const ui=setup(output(),{clipboard:{writeText:()=>wait.promise}});await ui.choose("approve");const pending=ui.$("copyPrompt").click();ui.update(output("content_approval","v2"));await ui.choose("approve");const expected=ui.$("copyStatus").textContent;rejected?wait.reject(Error("denied")):wait.resolve();await pending;assert.equal(ui.$("copyStatus").textContent,expected);assert.equal(ui.messages.length,0);
});
test("source edits invalidate the generated prompt without losing editable private draft",async()=>{
 const ui=setup(output());ui.choose("revise");ui.$("reviewFeedback").value="First";ui.$("reviewFeedback").oninput?.();await ui.submit();assert.equal(ui.$("promptDock").hidden,false);ui.$("reviewFeedback").value="Second";ui.$("reviewFeedback").oninput?.();assert.equal(ui.$("promptDock").hidden,true);await ui.submit();assert.match(ui.$("promptText").value,/Second/);assert.doesNotMatch(ui.$("promptText").value,/First/);
});
test("document excerpts are bounded and explicitly flagged; images never imply visibility",async()=>{
 const ui=setup(output("asset_review"),{host:{uploadFile:async()=>({fileId:"file-doc"})}});ui.choose("feedback");addOverallGroup(ui);groupArea(ui).value="Use reference";groupArea(ui).oninput?.();const input=fileInput(ui);input.files=[new File(["x".repeat(5000)],"reference.txt",{type:"text/plain"})];input.onchange!();await flushAttachmentWork();await ui.submit();const prompt=ui.$("promptText").value;assert.match(prompt,/"truncated":true/);assert.match(prompt,/attach original files/);assert.ok(prompt.length<8000);assert.deepEqual(ui.snapshot().imageIds,[]);
});

test("removed asset keeps draft but blocks prompt until user remaps",async()=>{
 const data=output("asset_review");const ui=setup(data);ui.choose("feedback");sectionButtons(ui)[0].click();ui.$("createSharedFeedback").click();groupArea(ui).value="Keep this feedback";groupArea(ui).oninput?.();await ui.submit();ui.update({...data,assets:[{id:"asset-new",section:"Banner"}]});assert.equal(ui.$("promptDock").hidden,true);await ui.submit();assert.equal(groupArea(ui).value,"Keep this feedback");assert.match(ui.$("error").textContent,/asset-1/);assert.equal(ui.$("promptDock").hidden,true);assert.equal(ui.messages.length,0);
});

test("clipboard writes serialize across version changes so old writes cannot overwrite a newer copy",async()=>{
 const wait=deferred();let calls=0,clipboard="";const ui=setup(output(),{clipboard:{async writeText(text){calls++;await wait.promise;clipboard=text;}}});await ui.choose("approve");const first=ui.$("copyPrompt").click();ui.update(output("content_approval","v2"));await ui.choose("approve");await ui.$("copyPrompt").onclick?.();assert.equal(calls,1);assert.equal(ui.$("copyPrompt").disabled,true);wait.resolve();await first;assert.doesNotMatch(ui.$("copyStatus").textContent,/Đã sao chép/);await ui.$("copyPrompt").click();assert.equal(calls,2);assert.equal(clipboard,ui.$("promptText").value);assert.match(clipboard,/"content_version":"v2"/);
});

test("serialized host snapshots preserve the latest unblurred brief, content and group feedback edits", () => {
  const brief = setup({ stage: "launcher" });
  brief.$("url").value = "https://example.com/latest"; brief.$("url").dispatch("input");
  brief.$("custom").value = "Latest brief keystroke"; brief.$("custom").dispatch("input");
  const briefRestored = setup({ stage: "launcher" }, { state: brief.snapshot() });
  assert.equal(briefRestored.$("url").value, "https://example.com/latest");
  assert.equal(briefRestored.$("custom").value, "Latest brief keystroke");
  const content = setup(output()); content.choose("revise"); content.$("reviewFeedback").value = "Latest content edit"; content.$("reviewFeedback").oninput!();
  assert.equal(setup(output(), { state: content.snapshot() }).$("reviewFeedback").value, "Latest content edit");
  const assets = setup(output("asset_review")); assets.choose("feedback"); assets.$("variableKeys").children[0].click(); assets.$("createSharedFeedback").click();
  const area = assets.$("variableItems").querySelectorAll("textarea")[0]; area.value = "Latest group edit"; area.oninput!();
  assert.equal(setup(output("asset_review"), { state: assets.snapshot() }).$("variableItems").querySelectorAll("textarea")[0].value, "Latest group edit");
});

test("cleared draft inputs stay empty through same-output host updates", () => {
  const data = { stage: "launcher" }; const ui = setup(data, { state: { url: "https://example.com/old", theme: "Old theme", custom: "Old requirements" } });
  for (const id of ["url", "theme", "custom"]) { ui.$(id).value = ""; ui.$(id).dispatch("input"); }
  ui.update(data);
  for (const id of ["url", "theme", "custom"]) assert.equal(ui.$(id).value, "");
});

test("feedback drafts survive Back, mode changes, remount and returning to exact review only", () => {
  const first = output("asset_review"); const ui = setup(first); ui.choose("feedback");
  ui.$("variableKeys").children[0].click(); ui.$("createSharedFeedback").click();
  const textarea = ui.$("variableItems").querySelectorAll("textarea")[0]; textarea.value = "Preserve the logo"; textarea.oninput!();
  ui.$("modeTrain").click(); ui.$("backToReview").click(); ui.choose("feedback");
  assert.equal(ui.$("variableItems").querySelectorAll("textarea")[0].value, "Preserve the logo");
  const restored = setup(first, { state: ui.snapshot() });
  assert.equal(restored.$("variableItems").querySelectorAll("textarea")[0].value, "Preserve the logo");
  ui.update(output("asset_review", "v2")); ui.choose("feedback");
  assert.equal(ui.$("variableItems").querySelectorAll("textarea").length, 0);
  ui.update(first); assert.equal(ui.$("variableItems").querySelectorAll("textarea")[0].value, "Preserve the logo");
});

test("external link denial is reported without silently bypassing the host", async () => {
  const ui = setup({ ...output(), result_links: [{ label: "Delivery", url: "https://example.com/result" }] }, { host: { openExternal: () => { throw Error("denied"); } } });
  let prevented = false;
  const anchor = ui.$("resultLinks").children[0].children[0] as any;
  anchor.onclick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.match(ui.$("error").textContent, /Host chưa mở được liên kết/);
});

test("failed route initialization retries only a route read in place and preserves the brief", async () => {
  const calls:any[]=[];const ui=setup({stage:"launcher",routes:[]},{host:{callTool:async(name:string,args:any)=>{calls.push([name,args]);return {content:[{type:"text",text:JSON.stringify({routes:[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"},{brand:"giftsoul",branch:"home-hero",title:"Hero"}]})}]};}}});
  ui.$("url").value="https://example.com/product";ui.$("custom").value="Keep this brief";
  assert.equal(ui.$("refreshRoutes").hidden,false);await ui.$("refreshRoutes").click();
  assert.equal(calls.length,1);assert.equal(calls[0][0],"list_creative_dna_routes");
  assert.equal(ui.$("url").value,"https://example.com/product");assert.equal(ui.$("custom").value,"Keep this brief");
  assert.equal(ui.$("refreshRoutes").hidden,true);assert.equal(ui.messages.length,0);
});

test("late route refresh cannot replace a newer review", async () => {
  const gate=deferred();const ui=setup({stage:"launcher",routes:[]},{host:{callTool:async()=>{await gate.promise;return {structuredContent:{routes:[{brand:"giftsoul",branch:"home-hero"}]}};}}});
  const refresh=ui.$("refreshRoutes").click();ui.update(output());gate.resolve();await refresh;
  assert.match(ui.$("stageTitle").textContent,/Duyệt content/);assert.equal(ui.$("launchFields").hidden,true);
});

test("late failed route lookup does not annotate a newer launcher response",async()=>{
 const gate=deferred();const ui=setup({stage:"launcher",routes:[]},{host:{callTool:()=>gate.promise}});
 const refresh=ui.$("refreshRoutes").click();ui.update({stage:"launcher",routes:[{brand:"giftsoul",branch:"home-hero"}]});
 gate.reject(Error("route unavailable"));await refresh;
 assert.equal(ui.$("routeStatus").textContent,"");assert.equal(ui.$("refreshRoutes").hidden,true);
});

test("clipboard fallback expands prompt disclosure before selecting text",async()=>{
 const ui=setup(output());await ui.choose("approve");ui.$("promptDetails").open=false;await ui.$("copyPrompt").click();assert.equal(ui.$("promptDetails").open,true);assert.equal(ui.$("promptText").selectionEnd,ui.$("promptText").value.length);assert.match(ui.$("copyStatus").textContent,/Chưa sao chép/);
});


test("panel intrinsic sizing follows content, deduplicates observer echoes and remains copy-only",()=>{
 const heights:number[]=[],sizing:{callback?:()=>void;frames:Array<()=>void>}={frames:[]};
 const ui=setup({routes:[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"}]},{sizing,host:{notifyIntrinsicHeight:(height:number)=>heights.push(height)}});
 assert.equal(sizing.frames.length,1);sizing.frames.shift()!();assert.deepEqual(heights,[388]);
 sizing.callback!();sizing.callback!();assert.equal(sizing.frames.length,1);sizing.frames.shift()!();assert.deepEqual(heights,[388]);
 ui.$("widgetContent").layoutHeight=520;sizing.callback!();sizing.frames.shift()!();assert.deepEqual(heights,[388,548]);
 ui.update(output("asset_review"));assert.equal(ui.$("launchFields").hidden,true);
 assert.equal(ui.messages.length,0);
});
test("height reporting is optional and host rejection does not break the composer",()=>{
 const ui=setup(undefined,{host:{notifyIntrinsicHeight:()=>{throw new Error("host unavailable");}}});
 ui.choose("approve");assert.equal(ui.$("promptDock").hidden,false);assert.equal(ui.messages.length,0);
});
test("panel form stays natural-height with compact optional controls",()=>{
 assert.doesNotMatch(launcherHtml,/#actionablePanel\{[^}]*max-height/);
 assert.match(launcherHtml,/#actionablePanel\{[^}]*overflow:visible/);
 assert.match(launcherHtml,/<details class="optional-brief" id="optionalBrief"><summary>Theme/);
 assert.equal((launcherHtml.match(/id="branches"/g)||[]).length,1);
 assert.match(launcherHtml,/window.ResizeObserver/);
});


test("restored optional brief instructions stay visible",()=>{
 const ui=setup({routes:[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"}]},{state:{theme:"Christmas",custom:"Keep product truthful"}});
 assert.equal(ui.$("optionalBrief").open,true);
});
test("clipboard denial exposes a selected, editable manual fallback",async()=>{
 const ui=setup(output(),{clipboard:{writeText:async()=>{throw new Error("NotAllowedError");}}});await ui.choose("approve");
 ui.$("promptText").value+=" Edited";await ui.$("copyPrompt").click();
 assert.match(ui.$("copyStatus").textContent,/Chưa sao chép/);assert.equal(ui.$("copyPrompt").disabled,false);
 ui.$("selectPrompt").click();assert.equal(ui.$("promptText").selectionEnd,ui.$("promptText").value.length);assert.match(ui.$("copyStatus").textContent,/Đã chọn prompt/);assert.equal(ui.messages.length,0);
});
test("stalled clipboard promptly exposes manual copying without overlapping automatic writes",async()=>{
 const pending=deferred(),timers=new Map<number,()=>void>();let id=0,calls=0;
 const ui=setup(output(),{timers:{setTimeout:(fn:()=>void,ms:number)=>{const key=++id;if(ms===1500)timers.set(key,fn);return key;},clearTimeout:(key:number)=>timers.delete(key)},clipboard:{writeText:()=>{calls++;return pending.promise;}}});
 await ui.choose("approve");const copy=ui.$("copyPrompt").click();assert.match(ui.$("copyStatus").textContent,/Đang chờ/);
 for(const fn of [...timers.values()])fn();assert.match(ui.$("copyStatus").textContent,/chưa xác nhận/);assert.equal(ui.$("selectPrompt").disabled,false);
 ui.$("selectPrompt").click();const manual=ui.$("copyStatus").textContent;await ui.$("copyPrompt").onclick?.();assert.equal(calls,1);
 pending.resolve();await copy;assert.equal(ui.$("copyStatus").textContent,manual);assert.equal(ui.$("copyPrompt").disabled,false);
});


test("whole panel collapse retains prompt and selections and persists privately",async()=>{
 const ui=setup(output());await ui.choose("approve");ui.$("promptText").value+=" Keep this edit";ui.$("promptText").oninput?.();
 const prompt=ui.$("promptText").value;ui.$("toggleComposer").click();assert.equal(ui.$("composerBody").hidden,true);assert.equal(ui.$("toggleComposer").attributes["aria-expanded"],"false");
 const state=ui.snapshot();assert.equal(state.privateContent.composerCollapsed,true);assert.equal(state.modelContent.composerCollapsed,undefined);
 const restored=setup(output(),{state});assert.equal(restored.$("composerBody").hidden,true);restored.$("toggleComposer").click();
 assert.equal(restored.$("composerBody").hidden,false);assert.equal(restored.$("promptText").value,prompt);assert.equal(restored.messages.length,0);
});
test("natural height reporting shrinks when the panel collapses",()=>{
 const heights:number[]=[],sizing:{callback?:()=>void;frames:Array<()=>void>}={frames:[]};
 const ui=setup(output(),{sizing,host:{notifyIntrinsicHeight:(height:number)=>heights.push(height)}});sizing.frames.shift()!();
 ui.$("toggleComposer").click();ui.$("widgetContent").layoutHeight=36;sizing.callback!();sizing.frames.shift()!();assert.deepEqual(heights,[388,64]);
});


test("late clipboard failure cannot reopen or focus a collapsed composer",async()=>{
 const wait=deferred();const ui=setup(output(),{clipboard:{writeText:()=>wait.promise}});await ui.choose("approve");
 const copy=ui.$("copyPrompt").click();ui.$("toggleComposer").click();const before=ui.$("copyStatus").textContent;
 wait.reject(new Error("denied"));await copy;assert.equal(ui.$("composerBody").hidden,true);assert.equal(ui.$("copyStatus").textContent,before);
});

function onepageOutput(stage: typeof REVIEW_STAGES[number] = "asset_review", version = "v1") {
 const data=output(stage,version); return {...data,review_context:{...data.review_context,branch:"onepage-system"}};
}
test("Onepage alone has two keyboard-accessible tabs; launcher Feedback is empty and never runs a brief",async()=>{
 const ui=setup({stage:"launcher"});assert.equal(ui.$("masterTabs").hidden,false);
 ui.$("url").value="https://example.com/product";ui.$("feedbackTab").click();
 assert.equal(ui.$("taskTabPanel").hidden,true);assert.equal(ui.$("feedbackEmpty").hidden,false);assert.equal(ui.$("run").disabled,true);
 await ui.submit();assert.equal(ui.$("promptDock").hidden,true);assert.equal(ui.messages.length,0);
 ui.$("feedbackTab").dispatch("keydown",{key:"Home",preventDefault(){}});
 assert.equal(ui.$("taskTab").attributes["aria-selected"],"true");assert.equal(ui.$("feedbackTab").attributes.tabindex,"-1");assert.equal(ui.$("url").value,"https://example.com/product");
 for(const branch of [undefined,"ldp-system","home-hero"]){const data=output("asset_review");const other=setup({...data,review_context:{...data.review_context,branch}});assert.equal(other.$("masterTabs").hidden,true);other.choose("feedback");assert.equal(other.$("feedbackTabPanel").hidden,false);}
});
test("Onepage group feedback consolidates real targets and preserves draft, identity and edited prompt across tabs",async()=>{
 const data={...onepageOutput(),assets:[{id:"desktop",section:"Banner",position:"desktop"},{id:"mobile",section:"Banner",position:"mobile"}]};
 const ui=setup(data,{globalsEcho:"sync"});ui.$("feedbackTab").click();
 assert.equal(ui.$("assetFeedbackFields").hidden,false);assert.equal(ui.$("modeTrain").hidden,true);
 ui.$("variableKeys").querySelectorAll("button").find(x=>x.textContent.includes("Chọn cả nhóm"))!.click();ui.$("createSharedFeedback").click();
 groupArea(ui).value="Căn giữa typo";groupArea(ui).oninput?.();await ui.submit();
 assert.match(ui.$("promptText").value,/desktop/);assert.match(ui.$("promptText").value,/mobile/);assert.match(ui.$("promptText").value,/Căn giữa typo/);assert.match(ui.$("promptText").value,/task-A/);assert.match(ui.$("promptText").value,/v1/);assert.doesNotMatch(ui.$("promptText").value,/submit_training_feedback/);
 ui.$("promptText").value+="\nGiữ màu gốc";ui.$("promptText").oninput?.();const edited=ui.$("promptText").value;
 ui.$("taskTab").click();assert.equal(ui.$("promptDock").hidden,true);ui.$("feedbackTab").click();assert.equal(groupArea(ui).value,"Căn giữa typo");assert.equal(ui.$("promptText").value,edited);assert.equal(ui.$("promptDock").hidden,false);
 const state=ui.snapshot();assert.equal(state.privateContent.reviewSelection.review_id,data.review_context.review_id);assert.equal(state.modelContent.stage,"asset_review");assert.equal(ui.messages.length,0);
 const restored=setup(data,{state});assert.equal(restored.$("feedbackTab").attributes["aria-selected"],"true");assert.equal(groupArea(restored).value,"Căn giữa typo");
});
test("Onepage version changes reset stale targets and hide earlier generated prompt",async()=>{
 const ui=setup(onepageOutput());ui.$("feedbackTab").click();addOverallGroup(ui);groupArea(ui).value="old";groupArea(ui).oninput?.();await ui.submit();
 ui.update(onepageOutput("asset_review","v2"));ui.$("feedbackTab").click();assert.equal(ui.$("variableItems").children.length,0);assert.equal(ui.$("promptDock").hidden,true);await ui.submit();assert.match(ui.$("error").textContent,/nhập feedback/);assert.equal(ui.messages.length,0);
});
test("Onepage content feedback and delivered assets reuse exact scope without switching stage",async()=>{
 const content=setup(onepageOutput("content_approval"));content.choose("revise");assert.equal(content.$("feedbackTab").attributes["aria-selected"],"true");content.$("reviewFeedback").value="Shorter title";await content.submit();assert.match(content.$("promptText").value,/Shorter title/);assert.match(content.$("promptText").value,/content_approval/);
 const delivered=setup(onepageOutput("complete"));delivered.$("feedbackTab").click();addOverallGroup(delivered);groupArea(delivered).value="Improve artwork";groupArea(delivered).oninput?.();await delivered.submit();assert.match(delivered.$("promptText").value,/Improve artwork/);assert.match(delivered.$("promptText").value,/complete/);assert.match(delivered.$("promptText").value,/"action":"feedback"/);
});
test("Onepage missing identity or actual inventory cannot invent selectable assets or generate feedback",async()=>{
 for(const data of [{...onepageOutput(),assets:[]},{...onepageOutput(),review_context:{branch:"onepage-system",review_id:"unbound"}}]){const ui=setup(data);ui.$("feedbackTab").click();assert.equal(ui.$("feedbackEmpty").hidden,false);assert.equal(ui.$("assetFeedbackFields").hidden,true);assert.equal(ui.$("run").disabled,true);await ui.submit();assert.equal(ui.$("promptDock").hidden,true);assert.equal(ui.messages.length,0);}
});
test("switching Onepage tabs cannot preserve a hidden Train action under generic feedback",async()=>{
 const ui=setup(onepageOutput());ui.choose("train");addOverallGroup(ui);groupArea(ui).value="Old training";groupArea(ui).oninput?.();
 ui.$("feedbackTab").click();groupArea(ui).value="Only revise these assets";groupArea(ui).oninput?.();await ui.submit();assert.doesNotMatch(ui.$("promptText").value,/submit_training_feedback/);
 ui.$("taskTab").click();assert.equal(ui.$("run").hidden,true);assert.equal(ui.$("feedbackTabPanel").hidden,true);assert.equal(ui.$("reviewChoices").hidden,false);
 await ui.submit();assert.doesNotMatch(ui.$("promptText").value,/submit_training_feedback/);assert.equal(ui.messages.length,0);
});
test("launcher restores selected tab once and a route refresh cannot override a newer tab choice",()=>{
 const ui=setup({stage:"launcher"},{state:{privateContent:{masterTab:"feedback",masterReviewKey:"",branch:"onepage-system"}}});assert.equal(ui.$("feedbackTab").attributes["aria-selected"],"true");ui.$("taskTab").click();ui.update({stage:"launcher",routes:[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"}]});assert.equal(ui.$("taskTab").attributes["aria-selected"],"true");
});
test("PR82 legacy saved edited prompts remain reachable after upgrading without Onepage metadata",()=>{
 function oldFingerprint(value:string){let a=2166136261,b=2246822507,c=3266489909,d=668265263;for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);a=Math.imul(a^n,16777619);b=Math.imul(b^n,2246822519);c=Math.imul(c^n,3266489917);d=Math.imul(d^n,668265263);}return "request-v2:"+[a,b,c,d].map(x=>(x>>>0).toString(16).padStart(8,"0")).join("");}
 const data=output("content_approval"),key=data.review_context.review_id;
 const request=oldFingerprint(JSON.stringify([key,"revise","Original feedback"]));
 const presentation=oldFingerprint(JSON.stringify([data.stage,key,"","",[],[],data.assets]));
 const binding=oldFingerprint(JSON.stringify([request,presentation]));
 const ui=setup(data,{state:{privateContent:{reviewDrafts:{[key]:{decision:"revise",feedback:"Original feedback",variableItems:[],selectedTargets:[]}},promptDrafts:{[binding]:"My manually edited PR82 prompt"}}}});
 assert.equal(ui.$("promptDock").hidden,false);assert.equal(ui.$("promptText").value,"My manually edited PR82 prompt");assert.equal(ui.$("masterTabs").hidden,true);
});

test("missing feedback context has truthful guidance and a copy-only recovery path",async()=>{
 const calls:any[]=[];
 const ui=setup({stage:"launcher"},{host:{callTool:(...args:any[])=>calls.push(args)}});
 ui.$("url").value="https://example.com/product";ui.$("feedbackTab").click();
 assert.match(ui.$("missingInputs").textContent,/chưa nhận được task/);
 assert.doesNotMatch(ui.$("missingInputs").textContent,/Đã đủ/);
 assert.doesNotMatch(ui.$("feedbackEmpty").textContent,/Chưa có kết quả/);
 assert.match(ui.$("taskContext").textContent,/Chưa gắn task/);assert.equal(ui.$("workflowSteps").hidden,true);
 assert.equal(ui.$("recoverFeedbackContext").hidden,false);
 ui.$("recoverFeedbackContext").click();
 assert.equal(ui.$("promptDock").hidden,false);
 assert.match(ui.$("promptText").value,/show_uid_brands_review/);
 assert.match(ui.$("promptText").value,/hỏi tôi đúng thông tin còn thiếu/);
 assert.match(ui.$("promptText").value,/Không tự tạo ID/);
 assert.match(ui.$("promptText").value,/không gửi Train/);
 assert.equal(ui.messages.length,0);assert.equal(calls.length,0);assert.equal(ui.$("run").disabled,true);
 ui.$("taskTab").click();assert.equal(ui.$("workflowSteps").hidden,false);assert.equal(ui.$("recoverFeedbackContext").hidden,true);assert.equal(ui.$("promptDock").hidden,true);
 ui.$("feedbackTab").click();assert.equal(ui.$("promptDock").hidden,false);
 ui.update(onepageOutput());ui.$("feedbackTab").click();
 assert.equal(ui.$("recoverFeedbackContext").hidden,true);assert.equal(ui.$("promptDock").hidden,true);
 assert.equal(ui.$("assetFeedbackFields").hidden,false);
});
test("partial review identity and missing inventory never display ready feedback guidance",()=>{
 for(const data of [{...onepageOutput(),assets:[]},{...onepageOutput(),review_context:{branch:"onepage-system",review_id:"unbound"}}]){
  const ui=setup(data);ui.$("feedbackTab").click();
  assert.equal(ui.$("missingInputs").textContent,ui.$("feedbackEmpty").textContent);
  assert.doesNotMatch(ui.$("missingInputs").textContent,/Đã đủ/);
  ui.$("recoverFeedbackContext").click();assert.equal(ui.$("promptDock").hidden,false);assert.equal(ui.messages.length,0);
 }
});
