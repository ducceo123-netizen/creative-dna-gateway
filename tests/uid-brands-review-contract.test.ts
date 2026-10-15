import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp, TOOL_DEFINITIONS } from "../server.ts";
import { REVIEW_STEPS, REVIEW_STAGES, NATIVE_FALLBACK_TEXT } from "../uid-brands-actions.ts";
import { createReviewContext, REVIEW_INPUT_SCHEMA } from "../uid-brands-review-contract.ts";
import { LAUNCHER_MIME, LAUNCHER_URI, launcherHtml } from "../uid-brands-workflow.ts";
import { LEGACY_LAUNCHER_URI, PREVIOUS_LAUNCHER_URI } from "../uid-brands-ui-resource.ts";

test("Feedback context fixes publish v4 and pin reviewed widget source inputs", () => {
  assert.equal(LAUNCHER_URI, "ui://uid-brands/workflow-v4.html");
  assert.equal(LEGACY_LAUNCHER_URI, "ui://uid-brands/workflow-v2.html");
  assert.notEqual(LAUNCHER_URI, LEGACY_LAUNCHER_URI);
  // Pin the integrated feedback context source inputs, undoing ONLY this patch's
  // URI wiring. This guard is runtime-independent and preserves PR84 packaging
  // guidance too. Intentional future source changes must review these pins.
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const workflow = source("uid-brands-workflow.ts").replace('export { LAUNCHER_URI } from "./uid-brands-ui-resource.ts";', 'export const LAUNCHER_URI = "ui://uid-brands/workflow-v2.html";');
  const actions = source("uid-brands-actions.ts")
    .replace('import { LAUNCHER_URI } from "./uid-brands-ui-resource.ts";\n', "")
    .replace('resourceUri: LAUNCHER_URI', 'resourceUri: "ui://uid-brands/workflow-v2.html"')
    .replace('"openai/outputTemplate": LAUNCHER_URI', '"openai/outputTemplate": "ui://uid-brands/workflow-v2.html"');
  assert.equal(hash(workflow), "0801b6ce0e381fffb1b642b4225406040186496233c7fe5649dcbe373c818d05");
  assert.equal(hash(actions), "59042d5b83d09d26d037e1f7eefdf886ad59b3bd5e7e4318d8cf3e3398f136cb");
  assert.equal(hash(source("uid-brands-attachment-ui.ts")), "07c40d34b48b2c1f3f069cc830bc5f8f6cf03377e02290eac3e908b05153cbef");
  assert.equal(hash(source("supabase/functions/_shared/product-research.ts")), "b3d4a6456b26d77a088c1e05cb0636b2748f340b68018615f723dae8a4a9302d");
  // Production uses Node. Bun 1.4.3 escapes non-ASCII characters inside String.raw
  // during transpilation, so its emitted bytes differ even on the approved base.
  // Do not normalize that difference or bless a second output hash. The exact
  // source pins above apply to BOTH runtimes; retain the production-byte guard.
  if (!process.versions.bun) assert.equal(hash(launcherHtml), "2fe2b841067abf7b23cb11ef0f98134bae86992b32e15add5e01fe266fea1953");
});

test("review correlation is stable per task/version/stage, changes after revision, and labels legacy callers unbound", () => {
  const input = { stage: "content_approval" as const, task_id: "task-A", content_version: "v1" };
  const first = createReviewContext(input);
  assert.deepEqual(createReviewContext(input), first);
  assert.notEqual(createReviewContext({ ...input, content_version: "v2" }).review_id, first.review_id);
  assert.notEqual(createReviewContext({ ...input, task_id: "task-B" }).review_id, first.review_id);
  assert.notEqual(createReviewContext({ ...input, stage: "asset_review" }).review_id, first.review_id);
  const retry = createReviewContext({ ...input, retry_id: "failed-generation-retry-1" });
  assert.notEqual(retry.review_id, first.review_id);
  assert.equal(createReviewContext({ ...input, retry_id: "failed-generation-retry-1" }).review_id, retry.review_id);
  const legacy = createReviewContext({ stage: "content_approval" });
  assert.equal(legacy.binding, "unbound");
  assert.notEqual(createReviewContext({ stage: "content_approval" }).review_id, legacy.review_id);
  assert.equal(createReviewContext({ stage: "content_approval", task_id: "task-A" }).binding, "unbound");
  assert.match(first.instruction, /do not authenticate/);
});

test("review input stays backward compatible and accepts the complete asset metadata schema", () => {
  assert.deepEqual(REVIEW_INPUT_SCHEMA.parse({ stage: "content_approval" }), { stage: "content_approval" });
  const asset = { id: "a", asset_id: "a", element: "Banner", section: "Banner", label: "desktop", asset_name: "Hero", name: "hero", position: "desktop" };
  assert.deepEqual(REVIEW_INPUT_SCHEMA.parse({ stage: "asset_review", assets: [asset] }).assets, [asset]);
  assert.equal(REVIEW_INPUT_SCHEMA.safeParse({ stage: "launcher" }).success, false);
  assert.equal(REVIEW_INPUT_SCHEMA.safeParse({ stage: "asset_review", assets: Array(101).fill(asset) }).success, false);
  assert.equal(REVIEW_INPUT_SCHEMA.safeParse({ stage: "content_approval", content_version: " " }).success, false);
});

test("review outcome fields preserve full text, host image IDs and HTTPS links without accepting executable URLs", () => {
  const input = { stage: "content_approval", result_content: "Full outcome\n<script>untrusted text</script>".repeat(300), result_links: [{ label: "Deliverable", url: "https://example.com/result" }], result_images: [{ file_id: "file_actual-image-1", label: "Banner desktop" }] };
  assert.deepEqual(REVIEW_INPUT_SCHEMA.parse(input), input);
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "http://example.com", "https://user:secret@example.com/file"]) {
    assert.equal(REVIEW_INPUT_SCHEMA.safeParse({ ...input, result_links: [{ label: "Unsafe", url }] }).success, false);
  }
  assert.equal(REVIEW_INPUT_SCHEMA.safeParse({ ...input, result_content: "x".repeat(120001) }).success, false);
  assert.equal(REVIEW_INPUT_SCHEMA.safeParse({ ...input, result_images: [{ file_id: "https://example.com/image.png", label: "Not a host ID" }] }).success, false);
});

test("live local MCP advertises and executes matching review/native contracts, metadata and resource", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  let id = 0;
  async function rpc(method: string, params: any) {
    const response = await fetch(`http://127.0.0.1:${port}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    assert.equal(response.status, 200);
    const text = await response.text();
    const packet = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find(line => line.startsWith("data: "))!.slice(6));
    assert.equal(packet.error, undefined); return packet.result;
  }
  try {
    const initialize = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "local-contract-test", version: "1" } });
    assert.doesNotMatch(initialize.instructions, /only for explicit requests in a later turn|WIDGET ACTION IS AUTHORITATIVE|REAL USER ACTION/);
    assert.match(initialize.instructions, /does not itself prove authenticated user approval/);
    assert.match(initialize.instructions, /Existing outcome review and Feedback take precedence/);
    assert.doesNotMatch(initialize.instructions, /Whenever the user invokes UID Brands without a complete brief/);
    const { tools } = await rpc("tools/list", {});
    for (const name of ["launch_creative_dna", "show_uid_brands_review", "get_uid_brands_native_workflow", "ingest_uid_brands_attachment"]) {
      const runtime = tools.find((tool: any) => tool.name === name);
      const discovery = TOOL_DEFINITIONS.find(tool => tool.name === name)!;
      const { $schema, ...runtimeSchema } = runtime.inputSchema;
      assert.deepEqual(runtimeSchema, discovery.inputSchema, `${name} input schema parity`);
      assert.equal(runtime.description, discovery.description);
      assert.deepEqual(runtime.annotations, discovery.annotations);
      assert.deepEqual(runtime._meta, discovery._meta);
    }
    const ingestion = tools.find((tool: any) => tool.name === "ingest_uid_brands_attachment");
    assert.deepEqual(ingestion._meta["openai/fileParams"], ["file"]);
    assert.equal(ingestion._meta["openai/widgetAccessible"], true);
    assert.deepEqual(ingestion._meta.ui.visibility, ["model", "app"]);
    assert.deepEqual(ingestion.inputSchema.properties.file.required, ["download_url", "file_id"]);
    assert.ok(ingestion.outputSchema);
    const denied = await rpc("tools/call", { name: "ingest_uid_brands_attachment", arguments: { file: { file_id: "file-test", download_url: "http://127.0.0.1/forbidden?token=redacted", file_name: "brief.txt", mime_type: "text/plain" } } });
    assert.equal(denied.isError, true); assert.equal(denied.structuredContent.ok, false);
    assert.doesNotMatch(JSON.stringify(denied), /127\.0\.0\.1|token=redacted/);
    const launchTool = tools.find((tool: any) => tool.name === "launch_creative_dna");
    assert.match(launchTool.description, /CONTEXT FIRST/);
    assert.match(launchTool.description, /execute within its authorized scope without inserting an unnecessary panel/);
    assert.match(launchTool.description, /show_uid_brands_review, never launch_creative_dna/);
    const reviewTool = tools.find((tool: any) => tool.name === "show_uid_brands_review");
    assert.match(reviewTool.description, /do not invent IDs, versions or assets/);
    assert.equal(reviewTool._meta.ui.resourceUri, LAUNCHER_URI);
    assert.equal(reviewTool._meta["openai/outputTemplate"], LAUNCHER_URI);
    assert.equal(reviewTool._meta["openai/widgetAccessible"], true);
    assert.deepEqual(reviewTool._meta.ui.visibility, ["model", "app"]);
    const launcherMeta = tools.find((tool: any) => tool.name === "launch_creative_dna")._meta;
    for (const key of ["ui", "openai/outputTemplate", "openai/widgetAccessible"]) assert.deepEqual(launcherMeta[key], reviewTool._meta[key]);
    assert.notEqual(launcherMeta["openai/toolInvocation/invoking"], reviewTool._meta["openai/toolInvocation/invoking"]);
    const resource = await rpc("resources/read", { uri: LAUNCHER_URI });
    assert.equal(resource.contents[0].uri, LAUNCHER_URI);
    assert.equal(resource.contents[0].mimeType, LAUNCHER_MIME);
    assert.equal(resource.contents[0].text, launcherHtml);
    const { resources } = await rpc("resources/list", {});
    for (const uri of [LAUNCHER_URI, LEGACY_LAUNCHER_URI, PREVIOUS_LAUNCHER_URI]) assert.ok(resources.some((item: any) => item.uri === uri));
    const legacyResource = await rpc("resources/read", { uri: LEGACY_LAUNCHER_URI });
    assert.equal(legacyResource.contents[0].uri, LEGACY_LAUNCHER_URI);
    assert.equal(legacyResource.contents[0].mimeType, LAUNCHER_MIME);
    assert.equal(legacyResource.contents[0].text, launcherHtml);
    assert.deepEqual(legacyResource.contents[0]._meta, resource.contents[0]._meta);
    for (const stage of REVIEW_STAGES) {
      const args = { stage, branch: "onepage-system", task_id: "task-A", content_version: "v1", retry_id: "retry-1", result_summary: "Verified outcome summary", result_content: "Full section one\nFull section two\nFull section three", result_links: [{ label: "Delivery", url: "https://example.com/delivery" }], result_images: [{ file_id: "file-image-1", label: "Banner" }], assets: [{ id: "a", element: "Banner", section: "Banner", position: "desktop", label: "Hero", asset_name: "A", name: "a" }] };
      const review = await rpc("tools/call", { name: "show_uid_brands_review", arguments: args });
      const native = await rpc("tools/call", { name: "get_uid_brands_native_workflow", arguments: args });
      assert.equal(review.isError, undefined); assert.equal(native.isError, undefined);
      assert.deepEqual(review.structuredContent.assets, args.assets);
      assert.equal(review.structuredContent.review_context.branch, "onepage-system");
      assert.equal(native.structuredContent.review_context.branch, "onepage-system");
      assert.equal(review.structuredContent.result_summary, args.result_summary);
      assert.equal(native.structuredContent.result_summary, args.result_summary);
      for (const key of ["result_content", "result_links", "result_images"] as const) {
        assert.deepEqual(review.structuredContent[key], args[key]);
        assert.deepEqual(native.structuredContent[key], args[key]);
      }
      assert.deepEqual(native.structuredContent.form, REVIEW_STEPS[stage]);
      assert.deepEqual(native.structuredContent.review_context, review.structuredContent.review_context);
      assert.equal(native.content[0].text, NATIVE_FALLBACK_TEXT);
      assert.equal(native.structuredContent.fallback.review, "show_uid_brands_review");
    }
    const legacy = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "content_approval" } });
    assert.equal(legacy.structuredContent.review_context.binding, "unbound");
    const navigation = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "asset_review", task_id: "task-A", content_version: "v1", navigation_id: "navigation-local-rpc" } });
    assert.equal(navigation.structuredContent.navigation_id, "navigation-local-rpc");
    assert.equal(navigation.structuredContent.stage, "asset_review");
    const invalid = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "launcher" } });
    assert.equal(invalid.isError, true);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("optional canonical branch binds Onepage tabs without guessing for legacy calls",()=>{
 const input=REVIEW_INPUT_SCHEMA.parse({stage:"asset_review",task_id:"task",content_version:"v1",branch:" onepage-system "});
 assert.equal(input.branch,"onepage-system");assert.equal(createReviewContext(input).branch,"onepage-system");
 assert.equal(createReviewContext({...input,branch:undefined}).branch,undefined);
 for(const branch of ["Onepage","onepage system","<script>",""]){assert.equal(REVIEW_INPUT_SCHEMA.safeParse({...input,branch}).success,false);}
 assert.equal(REVIEW_INPUT_SCHEMA.safeParse({...input,branch:"ldp-system"}).success,true);
});
