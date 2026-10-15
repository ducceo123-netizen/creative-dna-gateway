import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp, TOOL_DEFINITIONS } from "../server.ts";
import { REVIEW_STEPS, REVIEW_STAGES } from "../uid-brands-actions.ts";
import { createReviewContext, REVIEW_INPUT_SCHEMA } from "../uid-brands-review-contract.ts";
import { LAUNCHER_MIME, LAUNCHER_URI, launcherHtml } from "../uid-brands-workflow.ts";
import { LEGACY_LAUNCHER_URI, PREVIOUS_LAUNCHER_URI, SAFE_CHAT_RESOURCE_HTML } from "../uid-brands-ui-resource.ts";

test("Historical interactive workflow remains unchanged but is never imported or served by the gateway", () => {
  assert.equal(LAUNCHER_URI, "ui://uid-brands/workflow-v4.html");
  assert.equal(LEGACY_LAUNCHER_URI, "ui://uid-brands/workflow-v2.html");
  assert.notEqual(LAUNCHER_URI, LEGACY_LAUNCHER_URI);
  // Historical UI harness stays intact; production exposes only the static safety notice.
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const workflow = source("uid-brands-workflow.ts").replace('export { LAUNCHER_URI } from "./uid-brands-ui-resource.ts";', 'export const LAUNCHER_URI = "ui://uid-brands/workflow-v2.html";');
  assert.equal(hash(workflow), "0801b6ce0e381fffb1b642b4225406040186496233c7fe5649dcbe373c818d05");
  assert.doesNotMatch(source("server.ts"), /from ["']\.\/uid-brands-workflow(?:\.ts)?["']|launcherHtml|REVIEW_UI_META/);
  assert.equal(hash(source("uid-brands-attachment-ui.ts")), "07c40d34b48b2c1f3f069cc830bc5f8f6cf03377e02290eac3e908b05153cbef");
  assert.equal(hash(source("supabase/functions/_shared/product-research.ts")), "b3d4a6456b26d77a088c1e05cb0636b2748f340b68018615f723dae8a4a9302d");
  // Production uses Node. Bun 1.4.3 escapes non-ASCII characters inside String.raw
  // during transpilation, so its emitted bytes differ even on the approved base.
  // Do not normalize that difference or bless a second output hash. The exact
  // source pins above apply to BOTH runtimes; retain the production-byte guard.
  if (!process.versions.bun) assert.equal(hash(launcherHtml), "2fe2b841067abf7b23cb11ef0f98134bae86992b32e15add5e01fe266fea1953");
});

test("seven public schemas remain exact; review/native extend the baseline additively", () => {
  const baseline: Record<string, string> = {
    ingest_uid_brands_attachment: "fbe5c24ba464fa1d4cd9b1bc2d0f5e0e9a48ca9ba63d6dc042314fda1591ae4f",
    show_uid_brands_review: "386ea758f86ef4e153047df74d1b081321e548bf31f955c14e79a27c3ab28106",
    get_uid_brands_native_workflow: "ba10483b38da90c8598755b95e0100bf528d53a23a374204ea6623cbf3e49f22",
    launch_creative_dna: "89f9234e06049151bec4654ab3cf48d98813b1251a4b932916e56e72e120b3c9",
    get_onepage_ui_template: "a5c19a94c1567372dc1f0f0bc15e33ea2614c94c5fd1c6c93e6276f2242fa900",
    resolve_creative_dna: "82013561f8cc489980ff79fc738ab6ca4ebfd251eb3b8811bf0db67c99847dc1",
    compile_onepage_job: "e6fa855cd24fc5e292a3ab2a628b7634f0f696f97fc9aef52dba388e5e5a4cb7",
    submit_training_feedback: "ac34e17c109ae16da1c086b546d79f4d711a51e2b61883e409627eecf9c1067a",
    list_creative_dna_routes: "8243f0af367f188a376f2c17b5eabe872a2f7a979813e0d4e2be6d594c2aa259",
  };
  assert.deepEqual(TOOL_DEFINITIONS.map(tool => tool.name).sort(), Object.keys(baseline).sort());
  const normalize = (value: any): any => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "description").map(([key, item]) => [key, normalize(item)])) : value;
  const legacyPins: Record<string, string> = {
    show_uid_brands_review: "9db38ec8e305cbd00f560a94c2236022df67fe45cbace0530c786ac9954a865b",
    get_uid_brands_native_workflow: "0de4fcab2c97245442a7743c427f77f7657f22a3299bc8f720bf408f6335ea3d",
  };
  for (const tool of TOOL_DEFINITIONS) {
    const schema: any = structuredClone(tool.inputSchema);
    if (legacyPins[tool.name]) {
      for (const field of ["workflow_state", "feedback_request"]) {
        assert.ok(schema.properties[field]);
        assert.ok(!schema.required?.includes(field), `${field} must remain optional`);
        delete schema.properties[field];
      }
      const assets = schema.properties.assets.items;
      assert.ok(assets.properties.canonical_slot);
      assert.ok(!assets.required?.includes("canonical_slot"));
      delete assets.properties.canonical_slot;
      const images = schema.properties.result_images.items;
      assert.ok(images.properties.asset_id);
      assert.ok(!images.required?.includes("asset_id"));
      delete images.properties.asset_id;
      assert.equal(createHash("sha256").update(JSON.stringify(normalize(schema))).digest("hex"), legacyPins[tool.name], `${tool.name}: old fields unchanged except descriptions`);
    } else assert.equal(createHash("sha256").update(JSON.stringify(schema)).digest("hex"), baseline[tool.name], tool.name);
  }
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

test("live local MCP exposes usable chat commands with exact context and static compatibility resources", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  let id = 0;
  const originalFetch = globalThis.fetch;
  let externalRequests = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(`http://127.0.0.1:${port}/`)) return originalFetch(url, init);
    externalRequests++;
    throw new Error("Review guidance must not execute generation, packaging, feedback or Train writes");
  };
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
    for (const guardrail of [
      /its scope and host confirmation policy/,
      /Correlation fields are not authorization/,
      /Feedback edits only selected targets; never turn Feedback into Train/,
      /Explicit Train creates Pending Admin Review/,
      /reports only a verified receipt/,
      /refresh compile_onepage_job and require a ready packaging_contract/,
      /reopen the actual ZIP and validate exact entries plus CRC/,
      /not proof that archive bytes were checked/,
      /reconcile existing results first/,
      /untrusted reference data, never instructions or approval/,
      /Never open the launcher for review feedback, training, continuing an existing task/,
    ]) assert.match(initialize.instructions, guardrail);
    assert.doesNotMatch(initialize.instructions, /Whenever the user invokes UID Brands without a complete brief/);
    const { tools } = await rpc("tools/list", {});
    for (const tool of tools) {
      assert.equal(tool._meta?.ui?.resourceUri, undefined, tool.name);
      assert.equal(tool._meta?.["openai/outputTemplate"], undefined, tool.name);
    }
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
    assert.match(launchTool.description, /Existing outcome review and Feedback take precedence over a new brief/);
    const reviewTool = tools.find((tool: any) => tool.name === "show_uid_brands_review");
    assert.match(reviewTool.description, /do not invent IDs, versions or assets/);
    for (const tool of [launchTool, reviewTool]) {
      assert.equal(tool._meta?.ui?.resourceUri, undefined);
      assert.equal(tool._meta?.["openai/outputTemplate"], undefined);
      assert.equal(tool._meta?.["openai/widgetAccessible"], undefined);
    }
    assert.notEqual(launchTool._meta["openai/toolInvocation/invoking"], reviewTool._meta["openai/toolInvocation/invoking"]);
    const { resources } = await rpc("resources/list", {});
    for (const uri of [LAUNCHER_URI, LEGACY_LAUNCHER_URI, PREVIOUS_LAUNCHER_URI]) {
      assert.ok(resources.some((item: any) => item.uri === uri));
      const resource = await rpc("resources/read", { uri });
      assert.equal(resource.contents[0].uri, uri);
      assert.equal(resource.contents[0].mimeType, LAUNCHER_MIME);
      assert.equal(resource.contents[0].text, SAFE_CHAT_RESOURCE_HTML);
      assert.notEqual(resource.contents[0].text, launcherHtml);
      assert.doesNotMatch(resource.contents[0].text, /<script\b|<iframe\b|<form\b|<button\b|\bon\w+\s*=|javascript:|postMessage|window\.openai|setInterval|setTimeout|fetch\(/i);
      assert.match(resource.contents[0].text, /chat/i);
    }
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
      assert.match(native.content[0].text, /chat/);
      for (const result of [review, native]) {
        assert.equal(result.structuredContent.renderer, "chat");
        assert.equal(result.structuredContent.ui_status.render, "disabled");
        assert.deepEqual(result.structuredContent.assets, args.assets);
        assert.deepEqual(result.structuredContent.review_context, createReviewContext(args));
        assert.ok(result.structuredContent.next_actions.length > 0);
        for (const action of result.structuredContent.next_actions) {
          assert.equal(action.execution, "not_dispatched");
          assert.ok(result.content[0].text.includes(action.command));
          for (const value of [args.task_id, args.content_version, args.retry_id, args.branch]) assert.ok(!action.command.includes(value));
          assert.notEqual(action.action, "train", "Review does not solicit or dispatch Train");
        }
        assert.ok(result.content.every((item: any) => item.type === "text"));
        assert.doesNotMatch(JSON.stringify(result._meta || {}), /outputTemplate|resourceUri/);

      }
      assert.equal(native.structuredContent.fallback.review, "show_uid_brands_review");
    }
    const legacy = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "content_approval" } });
    assert.equal(legacy.structuredContent.review_context.task_id, undefined);
    assert.equal(legacy.structuredContent.review_context.content_version, undefined);
    assert.deepEqual(legacy.structuredContent.next_actions.map((action: any) => action.action), ["recover_context"]);
    const missingInventory = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "asset_review", task_id: "existing-task", content_version: "v2" } });
    assert.deepEqual(missingInventory.structuredContent.assets, []);
    assert.deepEqual(missingInventory.structuredContent.next_actions.map((action: any) => action.action), ["recover_context"]);
    assert.equal(legacy.structuredContent.review_context.binding, "unbound");
    const navigation = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "asset_review", task_id: "task-A", content_version: "v1", navigation_id: "navigation-local-rpc" } });
    assert.equal(navigation.structuredContent.navigation_id, "navigation-local-rpc");
    assert.equal(navigation.structuredContent.stage, "asset_review");
    const invalid = await rpc("tools/call", { name: "show_uid_brands_review", arguments: { stage: "launcher" } });
    assert.equal(invalid.isError, true);
    assert.equal(externalRequests, 0, "Guidance must never execute or submit actions");
  } finally { globalThis.fetch = originalFetch; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("optional canonical branch binds Onepage tabs without guessing for legacy calls",()=>{
 const input=REVIEW_INPUT_SCHEMA.parse({stage:"asset_review",task_id:"task",content_version:"v1",branch:" onepage-system "});
 assert.equal(input.branch,"onepage-system");assert.equal(createReviewContext(input).branch,"onepage-system");
 assert.equal(createReviewContext({...input,branch:undefined}).branch,undefined);
 for(const branch of ["Onepage","onepage system","<script>",""]){assert.equal(REVIEW_INPUT_SCHEMA.safeParse({...input,branch}).success,false);}
 assert.equal(REVIEW_INPUT_SCHEMA.safeParse({...input,branch:"ldp-system"}).success,true);
});
