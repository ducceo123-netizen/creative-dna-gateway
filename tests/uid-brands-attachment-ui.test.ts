import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ATTACHMENT_UI_SCRIPT, ATTACHMENT_UI_STYLES } from "../uid-brands-attachment-ui.ts";

// Run the actual embedded code with a minimal DOM and the documented host bridge.
// These tests verify our contract and races, not real host authorization/rendering.
class Element {
  children: Element[] = []; textContent = ""; className = ""; value = ""; hidden = false; disabled = false;
  files: any[] = []; attributes: Record<string, string> = {}; events: Record<string, (event: any) => any> = {};
  onclick?: () => any; onchange?: () => any;
  classList = { add() {} };
  constructor(public tag = "div") {}
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  append(...children: Element[]) { this.children.push(...children); }
  appendChild(child: Element) { this.children.push(child); return child; }
  replaceChildren(...children: Element[]) { this.children = children; }
  addEventListener(name: string, fn: (event: any) => any) { this.events[name] = fn; }
  removeEventListener(name: string) { delete this.events[name]; }
  click() { if (!this.disabled) return this.onclick?.(); }
  query(tag: string): Element[] { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.query(tag)]); }
}
function deferred<T = any>() { let resolve!: (value?: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a as any; reject = b; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const plain = (value: any) => JSON.parse(JSON.stringify(value));
function file(name = "reference.png", type = "image/png", size = 200) { return { name, type, size, lastModified: 1, arrayBuffer: async () => new TextEncoder().encode("Product color is blue.").buffer }; }
class TestClock {
  now = 0; next = 0; timers = new Map<number, { at: number; run: () => void }>();
  setTimeout = (run: () => void, delay: number) => { const id = ++this.next; this.timers.set(id, { at: this.now + delay, run }); return id; };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  async tick(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.now = due[1].at; this.timers.delete(due[0]); due[1].run(); await flush();
    }
    this.now = end; await flush();
  }
}
function setup(overrides: any = {}) {
  const clock = new TestClock();
  const root = new Element(); const uploads: any[] = []; const calls: any[] = []; const urls: any[] = []; const states: any[] = []; const changes: any[] = []; const revoked: string[] = [];
  const openai: any = {
    uploadFile: async (selected: any) => { uploads.push(selected); return { fileId: "file-" + uploads.length }; },
    getFileDownloadUrl: async (args: any) => { urls.push(args); return { downloadUrl: "https://files.example.test/" + args.fileId + "?temporary=secret" }; },
    callTool: async (name: string, args: any) => { calls.push({ name, args }); return { structuredContent: { ok: true, file_id: args.file.file_id, file_name: args.file.file_name, mime_type: args.file.mime_type, size_bytes: 200, text: "Product color is blue.", truncated: false } }; },
    setWidgetState: (state: any) => { states.push(state); },
    ...overrides,
  };
  class TestURL extends URL {
    static createObjectURL() { return "blob:local-preview-" + uploads.length; }
    static revokeObjectURL(url: string) { revoked.push(url); }
  }
  const context: any = { window: { openai }, document: { createElement: (tag: string) => new Element(tag) }, URL: TestURL, TextDecoder, console, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  vm.runInNewContext(ATTACHMENT_UI_SCRIPT + "\nglobalThis.createController=createAttachmentController;", context);
  const controller = context.createController({ root, idPrefix: "test", onChange: (state: any) => changes.push(plain(state)) });
  const items = () => controller.snapshot().scopes[controller.snapshot().scope];
  const button = (text: string) => root.query("button").find(node => node.textContent === text)!;
  return { clock, controller, root, openai, uploads, calls, urls, states, changes, revoked, items, button };
}

test("exports script and compact responsive attachment styles without external upload route", () => {
  assert.match(ATTACHMENT_UI_STYLES, /uid-attachment-preview/);
  assert.doesNotMatch(ATTACHMENT_UI_SCRIPT, /innerHTML|sendFollowUpMessage|\/api\/feedback|localStorage|sessionStorage/);
});

test("local image immediately shows uploading, a thumbnail, and ready host ID", async () => {
  const wait = deferred(); const ui = setup({ uploadFile: () => wait.promise }); const selected = file();
  const pending = ui.controller.addFiles([selected]);
  assert.equal(ui.items()[0].status, "uploading"); assert.equal(ui.root.query("img").length, 1);
  assert.throws(() => ui.controller.validateReady(), /đang được xử lý/);
  wait.resolve({ fileId: "file-image" }); await pending;
  assert.equal(ui.items()[0].status, "ready"); assert.deepEqual(plain(ui.controller.getImageIds()), ["file-image"]);
  assert.equal(ui.controller.validateReady(), true);
  const saved = JSON.stringify(ui.controller.snapshot()); assert.doesNotMatch(saved, /blob:|objectUrl|previewUrl|lastModified|downloadUrl/);
  assert.equal(ui.calls.length, 0, "local image has known size; no server text-ingestion call");
});

test("UTF-8 documents use exact official file arguments and expose extracted evidence", async () => {
  const ui = setup({ selectFiles: async () => [{ fileId: "file-1", fileName: "brief.md", mimeType: "text/markdown" }] }); await ui.controller.selectLibrary();
  assert.deepEqual(plain(ui.calls[0]), { name: "ingest_uid_brands_attachment", args: { file: { download_url: "https://files.example.test/file-1?temporary=secret", file_id: "file-1", mime_type: "text/markdown", file_name: "brief.md" } } });
  assert.equal(ui.controller.getReadyAttachments()[0].text, "Product color is blue.");
  assert.deepEqual(plain(ui.controller.getImageIds()), []);
  assert.doesNotMatch(JSON.stringify(ui.controller.snapshot()), /temporary=secret|https:/);
});

test("picker accepts multiple supported types, resets so the same file can be selected again", async () => {
  const ui = setup(); const input = ui.root.query("input")[0]; input.files = [file()]; input.value = "selected";
  input.onchange!(); await flush(); assert.equal(input.value, ""); assert.equal(ui.uploads.length, 1);
  assert.equal(ui.items()[0].status, "ready");
});

test("paste and drop add actual Files while ordinary pasted text stays untouched", async () => {
  const ui = setup(); let prevented = 0;
  const textEvent = { clipboardData: { files: [], items: [{ kind: "string" }] }, preventDefault() { prevented++; } };
  assert.equal(ui.controller.handlePaste(textEvent), false); assert.equal(prevented, 0);
  const selected = file(); assert.equal(ui.controller.handlePaste({ clipboardData: { files: [], items: [{ kind: "file", getAsFile: () => selected }] }, preventDefault() { prevented++; } }), true);
  ui.controller.handleDrop({ dataTransfer: { files: [file("other.jpg", "image/jpeg")] }, preventDefault() { prevented++; } });
  await flush(); assert.equal(prevented, 2); assert.equal(ui.uploads[0], selected); assert.equal(ui.items().length, 2);
});

test("rejects PDF, DOCX, unsupported/mismatched types, empty and oversized files before upload", async () => {
  for (const selected of [file("ref.pdf", "application/pdf"), file("brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), file("ref.svg", "image/svg+xml"), file("ref.png", "text/plain"), file("empty.txt", "text/plain", 0), file("big.png", "image/png", 10 * 1024 * 1024 + 1), file("big.txt", "text/plain", 1024 * 1024 + 1)]) {
    const ui = setup(); await ui.controller.addFiles([selected]); assert.equal(ui.uploads.length, 0, selected.name); assert.equal(ui.items()[0].status, "error"); assert.throws(() => ui.controller.validateReady());
    assert.equal(ui.root.query("button").some(button => button.textContent === "Thử lại"), false);
  }
});

test("accepts format by extension when MIME is absent and enforces six per independent scope", async () => {
  const ui = setup(); await ui.controller.addFiles(Array.from({ length: 7 }, (_, i) => file("image" + i + ".png", "")));
  assert.equal(ui.items().length, 6); assert.equal(ui.uploads.length, 6);
  ui.controller.setScope("review:v1"); await ui.controller.addFiles([file("review.png")]); assert.equal(ui.items().length, 1);
  ui.controller.setScope("brief"); assert.equal(ui.items().length, 6);
  ui.controller.remove(ui.items()[0].id); assert.equal(ui.items().length, 5);
  ui.controller.setScope("review:v1"); assert.equal(ui.items().length, 1);
});

test("removal prevents late upload completion from resurrecting attachment and revokes preview", async () => {
  const wait = deferred(); const ui = setup({ uploadFile: () => wait.promise });
  const pending = ui.controller.addFiles([file()]); ui.controller.remove(ui.items()[0].id);
  wait.resolve({ fileId: "late-file" }); await pending;
  assert.equal(ui.items().length, 0); assert.equal(ui.revoked.length, 1); assert.deepEqual(plain(ui.controller.getReadyAttachments()), []);
});

test("removal also cancels late extraction, including while scoped elsewhere", async () => {
  const wait = deferred(); const ui = setup(); const selected = file("brief.txt", "text/plain"); selected.arrayBuffer = () => wait.promise; const pending = ui.controller.addFiles([selected]);
  await flush(); const id = ui.items()[0].id; assert.equal(ui.items()[0].status, "reading");
  ui.controller.setScope("review"); ui.controller.remove(id);
  wait.resolve(new TextEncoder().encode("late evidence").buffer); await pending;
  ui.controller.setScope("brief"); assert.equal(ui.items().length, 0);
});

test("ambiguous failed upload cannot retry the same upload or publish evidence", async () => {
  const selected = file(); const received: any[] = [];
  const ui = setup({ uploadFile: async (file: any) => { received.push(file); throw Error("host unavailable"); } });
  await ui.controller.addFiles([selected]); assert.equal(ui.items()[0].status, "needs_reselect"); assert.equal(ui.controller.getReadyAttachments().length, 0);
  await ui.controller.retry(ui.items()[0].id); assert.equal(received.length, 1);
  assert.equal(ui.root.query("button").some(button => button.textContent === "Thử lại"), false);
});

test("tool failure is retryable with fresh URL without uploading the same document again", async () => {
  let fail = true; const ui = setup({ selectFiles: async () => [{ fileId: "file-1", fileName: "brief.txt", mimeType: "text/plain" }], callTool: async (_: string, args: any) => fail ? { isError: true } : { structuredContent: { ok: true, file_id: args.file.file_id, mime_type: "text/plain", size_bytes: 200, text: "Recovered evidence" } } });
  await ui.controller.selectLibrary(); assert.equal(ui.items()[0].status, "error");
  fail = false; await ui.controller.retry(ui.items()[0].id); assert.equal(ui.items()[0].status, "ready"); assert.equal(ui.uploads.length, 0); assert.equal(ui.urls.length, 2);
});

test("malformed upload and ingestion outputs do not become ready references", async () => {
  const badUpload = setup({ uploadFile: async () => ({ file_id: "wrong-shape" }) }); await badUpload.controller.addFiles([file()]); assert.equal(badUpload.items()[0].status, "needs_reselect");
  for (const structuredContent of [{ ok: true, file_id: "wrong", size_bytes: 200, text: "evidence" }, { ok: true, file_id: "file-1", size_bytes: 200 }, { ok: true, file_id: "file-1", size_bytes: 1024 * 1024 + 1, text: "too large" }, { ok: true, file_id: "file-1", size_bytes: 200, text: " " }]) {
    const ui = setup({ selectFiles: async () => [{ fileId: "file-1", fileName: "brief.txt", mimeType: "text/plain" }], callTool: async () => ({ structuredContent }) }); await ui.controller.selectLibrary(); assert.equal(ui.items()[0].status, "error");
  }
});

test("library is feature-detected and consumes exactly documented entries with bounded validation", async () => {
  const unavailable = setup(); assert.equal(unavailable.button("Từ thư viện ChatGPT").hidden, true);
  const selected = [{ fileId: "library-image", fileName: "ref.png", mimeType: "image/png" }, { fileId: "library-text", fileName: "brief.txt", mimeType: "text/plain" }];
  const ui = setup({ selectFiles: async () => selected }); assert.equal(ui.button("Từ thư viện ChatGPT").hidden, false);
  await ui.controller.selectLibrary(); assert.equal(ui.uploads.length, 0); assert.equal(ui.calls.length, 2); assert.equal(ui.items().every((item: any) => item.status === "ready"), true);
  assert.deepEqual(plain(ui.controller.getImageIds()), ["library-image"]); assert.equal(ui.items()[0].size, 200);
  await ui.controller.selectLibrary(); assert.equal(ui.items().length, 2, "same host refs are not added twice");
});

test("library image over app size limit and library unverified result are never accepted", async () => {
  const ui = setup({ selectFiles: async () => [{ fileId: "library-image", fileName: "ref.png", mimeType: "image/png" }], callTool: async () => ({ structuredContent: { ok: true, file_id: "library-image", mime_type: "image/png", size_bytes: 10 * 1024 * 1024 + 1 } }) });
  await ui.controller.selectLibrary(); assert.equal(ui.items()[0].status, "error"); assert.equal(ui.controller.getImageIds().length, 0);
});

test("open library picker blocks sending, cancellation is empty, and late selection belongs to originating scope", async () => {
  const wait = deferred(); const ui = setup({ selectFiles: () => wait.promise }); const picking = ui.controller.selectLibrary();
  assert.throws(() => ui.controller.validateReady(), /lựa chọn tệp/);
  ui.controller.setScope("review"); wait.resolve([{ fileId: "selected", fileName: "brief.txt", mimeType: "text/plain" }]); await picking;
  assert.equal(ui.items().length, 0); ui.controller.setScope("brief"); assert.equal(ui.items().length, 1);
  ui.openai.selectFiles = async () => []; await ui.controller.selectLibrary(); assert.equal(ui.items().length, 1);
});

test("restores only ready refs and evidence; pending local files require explicit re-selection", async () => {
  const wait = deferred(); const ui = setup(); await ui.controller.addFiles([file(), file("brief.txt", "text/plain")]);
  ui.openai.uploadFile = () => wait.promise; const pending = ui.controller.addFiles([file("pending.png")]); const saved = plain(ui.controller.snapshot());
  const restored = setup(); restored.controller.restore(saved); await flush();
  assert.equal(restored.items()[0].status, "ready"); assert.equal(restored.items()[0].id, saved.scopes.brief[0].id); assert.equal(restored.items()[1].text, "Product color is blue."); assert.equal(restored.items()[2].status, "needs_reselect");
  assert.equal(restored.uploads.length, 0); assert.equal(restored.urls.length, 1); assert.throws(() => restored.controller.validateReady());
  await restored.controller.retry(restored.items()[2].id); assert.equal(restored.uploads.length, 0);
  wait.resolve({ fileId: "old-page" }); await pending;
});

test("restore invalidates ongoing callbacks and never trusts persisted preview/download URLs", async () => {
  const wait = deferred(); const ui = setup({ uploadFile: () => wait.promise }); const pending = ui.controller.addFiles([file()]);
  ui.controller.restore({ version: 1, scope: "brief", scopes: { brief: [{ id: "saved", status: "ready", fileId: "host-file", fileName: "ref.png", mimeType: "image/png", kind: "image", size: 200, previewUrl: "javascript:evil", downloadUrl: "https://attacker.test" }] } });
  await flush(); wait.resolve({ fileId: "old-upload" }); await pending;
  assert.equal(ui.items().length, 1); assert.equal(ui.items()[0].fileId, "host-file"); assert.equal(ui.revoked.length, 1);
  assert.ok((ui.root.query("img")[0] as any).src.startsWith("https://files.example.test/"));
});

test("unsafe URL protocols, credentials and local hosts are rejected before any ingestion", async () => {
  for (const url of ["javascript:alert(1)", "data:image/png;base64,abc", "http://files.example.test/a", "https://user:pass@files.example.test/a", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a", "https://machine.local/a"]) {
    const ui = setup({ selectFiles: async () => [{ fileId: "file-1", fileName: "brief.txt", mimeType: "text/plain" }], getFileDownloadUrl: async () => ({ downloadUrl: url }) }); await ui.controller.selectLibrary(); assert.equal(ui.items()[0].status, "error", url); assert.equal(ui.calls.length, 0);
  }
});

test("state publication uses structured model/private/image fields and blocks errors", async () => {
  const ui = setup(); await ui.controller.addFiles([file(), file("brief.txt", "text/plain")]);
  const privateState = { draft: "unchanged", attachments: ui.controller.snapshot() }; const modelContent = { evidence: ui.controller.getReadyAttachments() };
  await ui.controller.ensureModelVisibility(privateState, modelContent);
  assert.deepEqual(Object.keys(ui.states[0]).sort(), ["imageIds", "modelContent", "privateContent"]); assert.equal(ui.states[0].privateContent, privateState); assert.equal(ui.states[0].modelContent, modelContent); assert.deepEqual(plain(ui.states[0].imageIds), ["file-1"]);
  await ui.controller.addFiles([file("unsupported.pdf", "application/pdf")]); await assert.rejects(ui.controller.ensureModelVisibility({}, {})); assert.equal(ui.states.length, 1);
});

test("missing host capabilities fail honestly and refresh when they become available", async () => {
  const ui = setup({ uploadFile: undefined, setWidgetState: undefined }); assert.equal(ui.button("Chọn tệp").disabled, true);
  await ui.controller.addFiles([file()]); assert.equal(ui.items()[0].status, "error");
  ui.openai.uploadFile = async () => ({ fileId: "connected" }); ui.controller.refreshCapabilities(); assert.equal(ui.button("Chọn tệp").disabled, false);
  await ui.controller.retry(ui.items()[0].id); assert.equal(ui.items()[0].status, "ready");
  await assert.rejects(ui.controller.ensureModelVisibility({}, {}), /chia sẻ tệp/);
});

test("disabled controller freezes picker, remove, retry, paste and drop during submission", async () => {
  const ui = setup(); await ui.controller.addFiles([file()]); const id = ui.items()[0].id; ui.controller.setDisabled(true);
  assert.equal(ui.button("Chọn tệp").disabled, true); assert.equal(ui.button("Xóa").disabled, true); assert.equal(ui.controller.remove(id), false);
  await ui.controller.addFiles([file("second.png")]); ui.controller.handleDrop({ dataTransfer: { files: [file()] }, preventDefault() {} });
  assert.equal(ui.controller.handlePaste({ clipboardData: { files: [file()] }, preventDefault() {} }), false);
  assert.equal(ui.items().length, 1); ui.controller.setDisabled(false); assert.equal(ui.controller.remove(id), true);
});

test("untrusted file names are rendered as text and destroy cleans previews and invalidates uploads", async () => {
  const wait = deferred(); const ui = setup({ uploadFile: () => wait.promise }); const pending = ui.controller.addFiles([file('<img onerror="evil">.png')]);
  assert.equal(ui.root.query("img").length, 1, "only the deliberate preview element exists");
  const name = ui.root.children[2].children[0].children[1].children[0].textContent; assert.equal(name, '<img onerror="evil">.png');
  ui.controller.destroy(); wait.resolve({ fileId: "late" }); await pending; assert.equal(ui.revoked.length, 1); assert.equal(ui.controller.getReadyAttachments().length, 0);
});

test("local documents read bounded UTF-8 without any remote download or ingestion", async () => {
  const ui = setup({ getFileDownloadUrl: undefined, callTool: undefined });
  await ui.controller.addFiles([file("brief.md", "text/plain")]);
  const ready = ui.controller.getReadyAttachments()[0];
  assert.equal(ready.text, "Product color is blue."); assert.equal(ready.mimeType, "text/markdown"); assert.equal(ready.evidenceOrigin, "local"); assert.equal(ready.untrustedEvidence, true);
  assert.equal(ui.uploads.length, 1); assert.equal(ui.calls.length, 0); assert.equal(ui.urls.length, 0);
  assert.ok(ui.root.children[0].children.some(node => /tải lên ChatGPT/.test(node.textContent)), "intake disclosure precedes the picker");
});

test("local parser rejects invalid UTF-8, binary, control, markup, malformed JSON and CSV", async () => {
  const examples: Array<{ name: string; mime: string; bytes: Uint8Array }> = [
    { name: "bad.txt", mime: "text/plain", bytes: Uint8Array.from([0xff, 0xfe, 0x61]) },
    ...["%PDF-content", "PK-binary", "hello\u0000world", "wrong\u202edirection", "<script>alert(1)", "<!doctype html>hello", "<svg>image", "   "].map(content => ({ name: "bad.txt", mime: "text/plain", bytes: new TextEncoder().encode(content) })),
    { name: "bad.json", mime: "application/json", bytes: new TextEncoder().encode("{not json}") },
    { name: "bad.csv", mime: "text/csv", bytes: new TextEncoder().encode('name,value\n"unclosed,value') },
    { name: "bad.csv", mime: "text/csv", bytes: new TextEncoder().encode('"closed"extra,value') },
  ];
  for (const example of examples) {
    const ui = setup(); const selected = file(example.name, example.mime, example.bytes.byteLength); selected.arrayBuffer = async () => example.bytes.buffer as ArrayBuffer;
    await ui.controller.addFiles([selected]); assert.equal(ui.items()[0].status, "error", example.name + " " + new TextDecoder().decode(example.bytes)); assert.equal(ui.controller.getReadyAttachments().length, 0);
  }
});

test("local parser accepts valid JSON and quoted CSV, caps excerpts without splitting Unicode", async () => {
  for (const [name, mime, content] of [["data.json", "application/json", '{"product":"blue"}'], ["data.csv", "text/csv", '"name","value"\n"blue, red","a""b"']]) {
    const ui = setup(); const selected = file(name, mime); selected.arrayBuffer = async () => new TextEncoder().encode(content).buffer;
    await ui.controller.addFiles([selected]); assert.equal(ui.items()[0].status, "ready"); assert.equal(ui.controller.getReadyAttachments()[0].text, content);
  }
  const ui = setup(); const selected = file("long.txt", "text/plain", 20000); selected.arrayBuffer = async () => new TextEncoder().encode("a".repeat(15999) + "😀tail").buffer;
  await ui.controller.addFiles([selected]); const evidence = ui.controller.getReadyAttachments()[0]; assert.equal(evidence.text.length, 15999); assert.equal(evidence.truncated, true); assert.ok(!/[\uD800-\uDBFF]$/.test(evidence.text));
});

test("actual local document byte limit cannot be bypassed by misleading File metadata", async () => {
  const ui = setup(); const selected = file("oversize.txt", "text/plain", 1); selected.arrayBuffer = async () => new Uint8Array(1024 * 1024 + 1).buffer;
  await ui.controller.addFiles([selected]); assert.equal(ui.items()[0].status, "error"); assert.equal(ui.controller.getReadyAttachments().length, 0);
});

test("configured-ingestion blocker is clear and never reveals raw capability URLs", async () => {
  const ui = setup({ selectFiles: async () => [{ fileId: "file-library", fileName: "brief.txt", mimeType: "text/plain" }], callTool: async () => ({ isError: true, structuredContent: { ok: false, error: { code: "DOWNLOAD_NOT_CONFIGURED", message: "never expose https://secret.test/?signature=secret" } } }) });
  await ui.controller.selectLibrary(); assert.match(ui.items()[0].error, /Chưa bật đọc tệp thư viện/); assert.doesNotMatch(JSON.stringify(ui.controller.snapshot()), /secret\.test|signature=secret/);
  ui.openai.callTool = async () => { throw Error("transport https://secret.test/?signature=secret"); }; await ui.controller.retry(ui.items()[0].id); assert.doesNotMatch(JSON.stringify(ui.controller.snapshot()), /secret\.test|signature=secret/);
});

test("library cancellation and destroyed/remounted picker have no late side effects", async () => {
  const cancelled = setup({ selectFiles: async () => { const error = new Error("cancelled"); error.name = "AbortError"; throw error; } }); await cancelled.controller.selectLibrary(); assert.equal(cancelled.items().length, 0); assert.equal(cancelled.controller.validateReady(), true);
  const wait = deferred(); const ui = setup({ selectFiles: () => wait.promise }); const pending = ui.controller.selectLibrary(); ui.controller.restore({ version: 1, scopes: { brief: [] }, scope: "brief" });
  wait.resolve([{ fileId: "late", fileName: "late.png", mimeType: "image/png" }]); await pending; assert.equal(ui.items().length, 0); assert.equal(ui.calls.length, 0);
});


test("upload timeout settles, blocks duplicate retry, and ignores late completion or rejection", async () => {
  for (const rejects of [false, true]) {
    const wait = deferred(); let attempts = 0; const ui = setup({ uploadFile: () => { attempts++; return wait.promise; } });
    const pending = ui.controller.addFiles([file()]); await ui.clock.tick(59999); assert.equal(ui.items()[0].status, "uploading");
    await ui.clock.tick(1); await pending; assert.equal(ui.items()[0].status, "needs_reselect"); assert.throws(() => ui.controller.validateReady());
    await ui.controller.retry(ui.items()[0].id); assert.equal(attempts, 1);
    const saved = plain(ui.controller.snapshot()); const changes = ui.changes.length;
    if (rejects) wait.reject(new Error("late upload failure")); else wait.resolve({ fileId: "late" });
    await flush(); assert.deepEqual(plain(ui.controller.snapshot()), saved); assert.equal(ui.changes.length, changes); assert.equal(ui.clock.timers.size, 0);
  }
});

test("library picker timeout releases controls and discards old selection during a newer picker", async () => {
  const old = deferred(); const next = deferred(); const ui = setup({ selectFiles: () => old.promise });
  const pending = ui.controller.selectLibrary(); await ui.clock.tick(120000); await pending;
  assert.equal(ui.button("Từ thư viện ChatGPT").disabled, false); assert.equal(ui.controller.validateReady(), true);
  ui.openai.selectFiles = () => next.promise; const current = ui.controller.selectLibrary();
  old.resolve([{ fileId: "old", fileName: "old.png", mimeType: "image/png" }]); await flush(); assert.equal(ui.items().length, 0);
  assert.equal(ui.button("Từ thư viện ChatGPT").disabled, true);
  next.resolve([]); await current; assert.equal(ui.controller.validateReady(), true); assert.equal(ui.clock.timers.size, 0);
});

test("local read timeout permits a read retry without another upload and ignores old bytes", async () => {
  const wait = deferred(); const selected = file("brief.txt", "text/plain"); selected.arrayBuffer = () => wait.promise;
  const ui = setup(); const pending = ui.controller.addFiles([selected]); await flush(); await ui.clock.tick(30000); await pending;
  assert.equal(ui.items()[0].status, "error"); selected.arrayBuffer = async () => new TextEncoder().encode("new evidence").buffer;
  await ui.controller.retry(ui.items()[0].id); assert.equal(ui.uploads.length, 1); assert.equal(ui.items()[0].text, "new evidence");
  wait.resolve(new TextEncoder().encode("stale evidence").buffer); await flush(); assert.equal(ui.items()[0].text, "new evidence");
});

test("library URL and ingestion waits are bounded and retry uses fresh reads", async () => {
  for (const stage of ["url", "ingestion"]) {
    const wait = deferred(); const ui = setup({ selectFiles: async () => [{ fileId: "library", fileName: "brief.txt", mimeType: "text/plain" }] });
    const original = stage === "url" ? ui.openai.getFileDownloadUrl : ui.openai.callTool;
    ui.openai[stage === "url" ? "getFileDownloadUrl" : "callTool"] = () => wait.promise;
    const pending = ui.controller.selectLibrary(); await flush(); await ui.clock.tick(30000); await pending; assert.equal(ui.items()[0].status, "error");
    ui.openai[stage === "url" ? "getFileDownloadUrl" : "callTool"] = original;
    await ui.controller.retry(ui.items()[0].id); assert.equal(ui.items()[0].status, "ready");
    const saved = plain(ui.controller.snapshot()); wait.resolve({}); await flush(); assert.deepEqual(plain(ui.controller.snapshot()), saved); assert.equal(ui.uploads.length, 0);
  }
});

test("visibility waits time out and stale visibility completion cannot authorize submission", async () => {
  const wait = deferred(); const ui = setup({ setWidgetState: () => wait.promise }); await ui.controller.addFiles([file()]);
  const pending = ui.controller.ensureModelVisibility({}, {}); const rejected = assert.rejects(pending, /chia sẻ tệp/);
  await ui.clock.tick(30000); await rejected; wait.resolve(); await flush(); assert.equal(ui.items()[0].status, "ready");
  for (const invalidate of [(controller: any) => controller.setScope("review"), (controller: any) => controller.restore({}), (controller: any) => controller.destroy()]) {
    const stale = deferred(); const view = setup({ setWidgetState: () => stale.promise }); const visibility = view.controller.ensureModelVisibility({}, {});
    const invalidated = assert.rejects(visibility, /đã thay đổi/); invalidate(view.controller); stale.resolve(); await invalidated;
  }
});

test("scope retention is bounded with pending upload and picker origins preserved", async () => {
  const upload = deferred(); const pick = deferred(); const ui = setup({ uploadFile: () => upload.promise, selectFiles: () => pick.promise });
  const pending = ui.controller.addFiles([file()]); ui.controller.setScope("picker"); const picking = ui.controller.selectLibrary();
  for (let i = 0; i < 100; i++) ui.controller.setScope("review:" + i);
  let scopes = ui.controller.snapshot().scopes; assert.equal(Object.keys(scopes).length, 15); assert.ok(scopes.brief); assert.ok(scopes.picker); assert.ok(scopes["review:99"]);
  upload.resolve({ fileId: "uploaded" }); await pending; pick.resolve([]); await picking;
  scopes = ui.controller.snapshot().scopes; assert.equal(Object.keys(scopes).length, 13); assert.ok(scopes["review:99"]);
  assert.equal(ui.revoked.length, 1, "evicted image preview is revoked");
});

test("restore prunes inactive terminal scopes before requesting image previews", async () => {
  const scopes = Object.fromEntries(Array.from({ length: 100 }, (_, i) => ["review:" + i, [{ id: "saved:" + i, status: "ready", fileId: "image:" + i, fileName: "ref.png", mimeType: "image/png", size: 200 }]]));
  const wait = deferred(); const ui = setup({ getFileDownloadUrl: () => wait.promise });
  ui.controller.restore({ version: 1, scope: "review:0", scopes }); assert.equal(Object.keys(ui.controller.snapshot().scopes).length, 13); assert.ok(ui.controller.snapshot().scopes["review:0"]);
  await ui.clock.tick(30000); assert.equal(ui.clock.timers.size, 0); assert.equal(ui.items()[0].status, "ready");
  ui.controller.remove(ui.items()[0].id); wait.resolve({ downloadUrl: "https://files.example.test/late" }); await flush(); assert.equal(ui.items().length, 0); assert.equal(ui.root.query("img").length, 0);
});


test("same-scope refresh preserves visibility while removal invalidates it", async () => {
  const first = deferred(); const ui = setup({ setWidgetState: () => first.promise }); await ui.controller.addFiles([file()]);
  const visibility = ui.controller.ensureModelVisibility({}, {}); ui.controller.setScope("brief"); first.resolve(); await visibility;
  const second = deferred(); ui.openai.setWidgetState = () => second.promise;
  const removed = ui.controller.ensureModelVisibility({}, {}); const rejected = assert.rejects(removed, /đã thay đổi/);
  ui.controller.remove(ui.items()[0].id); second.resolve(); await rejected;
});

test("stale picker cannot release a fresh picker after restore", async () => {
  const old = deferred(); const next = deferred(); const ui = setup({ selectFiles: () => old.promise });
  const pending = ui.controller.selectLibrary(); ui.controller.restore({}); ui.openai.selectFiles = () => next.promise;
  const fresh = ui.controller.selectLibrary(); old.reject(new Error("old rejected")); await pending;
  assert.equal(ui.button("Từ thư viện ChatGPT").disabled, true); assert.throws(() => ui.controller.validateReady(), /lựa chọn tệp/);
  next.resolve([]); await fresh; assert.equal(ui.controller.validateReady(), true);
});

test("library extraction cannot mutate removed or restored references", async () => {
  for (const restore of [false, true]) {
    const wait = deferred(); const ui = setup({ selectFiles: async () => [{ fileId: "library", fileName: "brief.txt", mimeType: "text/plain" }], callTool: () => wait.promise });
    const pending = ui.controller.selectLibrary(); await flush();
    if (restore) ui.controller.restore({}); else ui.controller.remove(ui.items()[0].id);
    wait.resolve({ structuredContent: { ok: true, file_id: "library", mime_type: "text/plain", size_bytes: 200, text: "stale" } }); await pending;
    assert.equal(ui.items().length, 0); assert.equal(ui.controller.getReadyAttachments().length, 0);
  }
});
