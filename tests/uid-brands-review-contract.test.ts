import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, TOOL_DEFINITIONS } from "../server.ts";
import { REVIEW_STEPS, REVIEW_STAGES, NATIVE_FALLBACK_TEXT } from "../uid-brands-actions.ts";
import { createReviewContext, REVIEW_INPUT_SCHEMA } from "../uid-brands-review-contract.ts";
import { LAUNCHER_MIME, LAUNCHER_URI, launcherHtml } from "../uid-brands-workflow.ts";

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
    const { tools } = await rpc("tools/list", {});
    for (const name of ["show_uid_brands_review", "get_uid_brands_native_workflow", "ingest_uid_brands_attachment"]) {
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
    const reviewTool = tools.find((tool: any) => tool.name === "show_uid_brands_review");
    assert.equal(reviewTool._meta.ui.resourceUri, LAUNCHER_URI);
    assert.equal(reviewTool._meta["openai/outputTemplate"], LAUNCHER_URI);
    const resource = await rpc("resources/read", { uri: LAUNCHER_URI });
    assert.equal(resource.contents[0].mimeType, LAUNCHER_MIME);
    assert.equal(resource.contents[0].text, launcherHtml);
    for (const stage of REVIEW_STAGES) {
      const args = { stage, task_id: "task-A", content_version: "v1", retry_id: "retry-1", result_summary: "Verified outcome summary", assets: [{ id: "a", element: "Banner", section: "Banner", position: "desktop", label: "Hero", asset_name: "A", name: "a" }] };
      const review = await rpc("tools/call", { name: "show_uid_brands_review", arguments: args });
      const native = await rpc("tools/call", { name: "get_uid_brands_native_workflow", arguments: args });
      assert.equal(review.isError, undefined); assert.equal(native.isError, undefined);
      assert.deepEqual(review.structuredContent.assets, args.assets);
      assert.equal(review.structuredContent.result_summary, args.result_summary);
      assert.equal(native.structuredContent.result_summary, args.result_summary);
      assert.deepEqual(native.structuredContent.form, REVIEW_STEPS[stage]);
      assert.deepEqual(native.structuredContent.review_context, review.structuredContent.review_context);
      assert.equal(native.content[0].text, NATIVE_FALLBACK_TEXT);
      assert.equal(native.structuredContent.fallback.review, "show_uid_brands_review");
    }
    const legacy = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "content_approval" } });
    assert.equal(legacy.structuredContent.review_context.binding, "unbound");
    const invalid = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "launcher" } });
    assert.equal(invalid.isError, true);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
