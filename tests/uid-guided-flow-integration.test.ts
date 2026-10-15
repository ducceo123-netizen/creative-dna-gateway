import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.ts";
import { UID_EXTERNAL_PANEL_URL, UID_EXTERNAL_PANEL } from "../uid-brands-chat.ts";
import { REVIEW_INPUT_SCHEMA, NATIVE_INPUT_SCHEMA } from "../uid-brands-review-contract.ts";

// Bun shares imported modules across test files, including the production limiter.
// Give each local fixture a stable simulated proxy IP from TEST-NET-2 instead of
// sharing the suite-wide loopback bucket. The real limiter still runs on every call.
let fixtureNumber = 0;

async function withMcp(work: (call: (args: any, name?: string) => Promise<any>) => Promise<void>, allowRoutes = false) {
  const app = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => app.once("listening", resolve));
  const origin = `http://127.0.0.1:${(app.address() as any).port}`;
  const clientIp = `198.51.100.${++fixtureNumber}`;
  const original = globalThis.fetch;
  let external = 0, id = 0;
  globalThis.fetch = async (_url, init) => {
    if (allowRoutes && JSON.parse(String(init?.body ?? "{}")).action === "routes") return Response.json({ routes: [{ brand: "Verified Brand", branch: "Home Hero" }] });
    external++; throw new Error("Review must not call upstream or write");
  };
  try {
    await work(async (args, name = "show_uid_brands_review") => {
      const response = await original(origin + "/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-Forwarded-For": clientIp }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("RateLimit-Limit"), "120");
      assert.equal(response.headers.get("RateLimit-Remaining"), String(120 - id));
      const wire = await response.text();
      const packet = JSON.parse(wire.startsWith("{") ? wire : wire.split("\n").find(line => line.startsWith("data: "))!.slice(6));
      assert.equal(packet.error, undefined);
      assert.notEqual(packet.result.isError, true);
      return packet.result;
    });
    assert.equal(external, 0, "No generation, packaging, media fetching or automatic Train");
  } finally {
    globalThis.fetch = original;
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
}
const bound = { task_id: "task-secret-817", content_version: "revision-secret-23", retry_id: "retry-secret-19", branch: "onepage-system" };
const assets = [
  { id: "asset-secret-a", label: "Hero desktop", section: "Banner", position: "desktop" },
  { id: "asset-secret-b", label: "Hero mobile", section: "Banner", position: "mobile" },
  { id: "asset-secret-c", label: "Product detail", section: "Details" },
];
const base = { ...bound, stage: "asset_review", assets };
const actions = (r: any) => r.structuredContent.next_actions.map((a: any) => a.action);
function safeProse(result: any) {
  const prose = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  assert.doesNotMatch(prose, /task-secret-817|revision-secret-23|retry-secret-19|asset-secret-[abc]|feedback:[a-f0-9]{64}|"task_id"\s*:/);
  assert.ok(result.content.every((c: any) => c.type === "text"), "No fabricated image preview");
  for (const action of result.structuredContent.next_actions) assert.equal(action.execution, "not_dispatched");
  assert.ok(!actions(result).includes("train"));
  assert.equal(result.structuredContent.renderer, "chat");
  assert.equal(result.structuredContent.ui_status.render, "disabled");
  assert.doesNotMatch(JSON.stringify(result._meta ?? {}), /resourceUri|outputTemplate/);
  return prose;
}

test("live stages retain usable natural requests and context-bound prerequisite recovery", async () => {
  await withMcp(async call => {
    for (const name of ["show_uid_brands_review", "get_uid_brands_native_workflow"]) {
      const content = await call({ ...bound, stage: "content_approval", result_content: "Real reviewed content" }, name);
      assert.deepEqual(actions(content), ["revise", "regenerate", "approve"]); safeProse(content);
      const review = await call(base, name); safeProse(review);
      assert.ok(actions(review).includes("feedback"));
      assert.equal(review.structuredContent.review_index.entries.length, 3);
      const packaging = await call({ ...base, stage: "packaging" }, name); safeProse(packaging);
      assert.match(packaging.content[0].text, /research\/QC/);
      const complete = await call({ ...base, stage: "complete", result_links: [{ label: "Verified delivery", url: "https://example.com/verified-delivery" }] }, name);
      safeProse(complete); assert.match(complete.content[0].text, /https:\/\/example.com\/verified-delivery/);
      assert.ok(actions(complete).includes("new_task"));
      for (const args of [{ stage: "asset_review", assets }, { ...bound, stage: "asset_review" }, { ...bound, stage: "packaging" }]) {
        const missing = await call(args, name); safeProse(missing);
        assert.deepEqual(actions(missing), ["recover_context"]);
        assert.equal(missing.structuredContent.review_index, undefined);
      }
      const noDelivery = await call({ ...base, stage: "complete" }, name);
      assert.ok(actions(noDelivery).includes("recover_delivery"));
    }
  });
});

test("observed in-progress, blocked and failed states offer recovery, never approval or replay", async () => {
  await withMcp(async call => {
    for (const stage of ["content_approval", "asset_review", "packaging", "complete"]) {
      for (const status of ["in_progress", "blocked", "failed"]) {
        const result = await call({ ...base, stage, workflow_state: { status, message: "Verified missing source" } });
        safeProse(result);
        assert.deepEqual(actions(result), [status === "in_progress" ? "check_status" : "inspect_blocker"]);
        assert.match(result.content[0].text, /Verified missing source/);
      }
    }
  });
});

test("multiple feedback blocks map exact groups and instructions on the same task/version/index", async () => {
  await withMcp(async call => {
    const displayed = (await call(base)).structuredContent.review_index;
    assert.equal(displayed.task_id, bound.task_id); assert.equal(displayed.content_version, bound.content_version);
    for (const name of ["show_uid_brands_review", "get_uid_brands_native_workflow"]) {
      const mapped = await call({ ...base, feedback_request: { index_id: displayed.index_id, blocks: [
        { group_names: ["Banner"], text: "Increase whitespace" },
        { asset_names: ["Product detail"], text: "Reduce heading size" },
      ] } }, name);
      safeProse(mapped);
      assert.deepEqual(actions(mapped), [], "Resolved user feedback needs no redundant approval prompt");
      assert.equal(mapped.structuredContent.execution_guidance.mapping_is_authorization, false);
      assert.equal(mapped.structuredContent.execution_guidance.execution, "not_dispatched");
      assert.deepEqual(mapped.structuredContent.feedback_resolution, { ok: true, index_id: displayed.index_id, blocks: [
        { text: "Increase whitespace", asset_ids: [assets[0].id, assets[1].id], ordinals: [1, 2] },
        { text: "Reduce heading size", asset_ids: [assets[2].id], ordinals: [3] },
      ] });
      assert.match(mapped.structuredContent.scope_echo, /Hero desktop/);
      assert.match(mapped.structuredContent.scope_echo, /Increase whitespace/);
      assert.match(mapped.structuredContent.scope_echo, /Reduce heading size/);
      assert.equal(mapped.structuredContent.review_index.index_id, displayed.index_id);
    }
    const all = await call({ ...base, feedback_request: { index_id: displayed.index_id, blocks: [{ all: true, text: "Use warmer colors" }] } });
    assert.deepEqual(all.structuredContent.feedback_resolution.blocks[0].asset_ids, assets.map(a => a.id));
  });
});

test("stale, ambiguous, overlapping and missing selectors request clarification with no partial action", async () => {
  await withMcp(async call => {
    const index = (await call(base)).structuredContent.review_index;
    const cases = [
      { input: { ...base, content_version: "changed-revision" }, blocks: [{ all: true, text: "Change all" }], code: "stale_index" },
      { input: { ...base, assets: assets.slice(0, 2) }, blocks: [{ all: true, text: "Change all" }], code: "stale_index" },
      { input: base, blocks: [{ ordinals: [1, 2], text: "A" }, { ordinals: [2], text: "B" }], code: "overlapping_blocks" },
      { input: base, blocks: [{ text: "A" }], code: "missing_selector" },
      { input: base, blocks: [{ ordinals: [99], text: "A" }], code: "unknown_ordinal" },
    ];
    for (const c of cases) {
      const result = await call({ ...c.input, feedback_request: { index_id: index.index_id, blocks: c.blocks } });
      assert.equal(result.structuredContent.feedback_resolution.ok, false);
      assert.equal(result.structuredContent.feedback_resolution.code, c.code);
      assert.equal(result.structuredContent.feedback_resolution.blocks, undefined);
      assert.deepEqual(actions(result), ["recover_context"]); safeProse(result);
    }
    const duplicate = { ...base, assets: assets.map(a => ({ ...a, label: "Duplicate" })) };
    const duplicateIndex = (await call(duplicate)).structuredContent.review_index;
    const ambiguous = await call({ ...duplicate, feedback_request: { index_id: duplicateIndex.index_id, blocks: [{ asset_names: ["Duplicate"], text: "Change it" }] } });
    assert.equal(ambiguous.structuredContent.feedback_resolution.code, "ambiguous_name");
    assert.deepEqual(actions(ambiguous), ["recover_context"]);
  });
});

test("image associations require explicit asset IDs and remain references, never verified previews", async () => {
  await withMcp(async call => {
    const result = await call({ ...base, result_images: [{ file_id: "file-real-1", label: "Hero desktop" }, { file_id: "file-real-2", label: "Original detail", asset_id: assets[2].id }] });
    safeProse(result);
    const entries = result.structuredContent.review_index.entries;
    assert.deepEqual(entries[0].media, []); assert.equal(entries[0].preview_availability, "unavailable");
    assert.deepEqual(entries[2].media, [{ file_id: "file-real-2", label: "Original detail" }]);
    assert.equal(entries[2].preview_availability, "reference_only");
  });
});

test("additive input fields are optional and bounded on review and native tools", () => {
  for (const schema of [REVIEW_INPUT_SCHEMA, NATIVE_INPUT_SCHEMA]) {
    assert.equal(schema.safeParse({ stage: "asset_review" }).success, true);
    const valid = { ...base, workflow_state: { status: "blocked", message: "Missing source" }, feedback_request: { index_id: "actual-index", blocks: [{ ordinals: [1], text: "Fix heading" }] }, result_images: [{ asset_id: assets[0].id, file_id: "file-real-1", label: "Original" }] };
    assert.equal(schema.safeParse(valid).success, true);
    for (const patch of [
      { workflow_state: { status: "complete" } }, { workflow_state: { status: "failed", message: "x".repeat(1001) } },
      { feedback_request: { index_id: "actual-index", blocks: [] } },
      { feedback_request: { index_id: "actual-index", blocks: Array(11).fill({ all: true, text: "Change" }) } },
      { feedback_request: { index_id: "actual-index", blocks: [{ ordinals: [0], text: "Change" }] } },
      { feedback_request: { index_id: "actual-index", blocks: [{ all: true, text: "x".repeat(4001) }] } },
      { result_images: [{ asset_id: " ", file_id: "file-real-1", label: "Original" }] },
    ]) assert.equal(schema.safeParse({ ...valid, ...patch }).success, false);
  }
});

 test("brief guidance uses verified routes and asks for ordinary information without IDs or JSON", async () => {
  await withMcp(async call => {
    for (const [name, args] of [["launch_creative_dna", {}], ["get_uid_brands_native_workflow", { stage: "launcher" }]] as const) {
      const result = await call(args, name);
      assert.equal(result.structuredContent.renderer, "chat");
      assert.equal(result.structuredContent.ui_status.render, "disabled");
      const prose = result.content.map((item: any) => item.text ?? "").join("\n");
      assert.match(prose, /[Bb]rief/);
      assert.match(prose, /brand/i);
      assert.match(prose, /material/i);
      assert.match(prose, /link/i);
      assert.doesNotMatch(prose, /"task_id"\s*:|"content_version"\s*:/);
    }
  }, true);
});

 test("external selector is a plain public link with no private hydration or automatic widget", async () => {
  const url = new URL(UID_EXTERNAL_PANEL_URL);
  assert.equal(url.protocol, "https:"); assert.equal(url.search, ""); assert.equal(url.hash, "");
  assert.equal(url.pathname, "/onepage-panel.html");
  await withMcp(async call => {
    for (const name of ["show_uid_brands_review", "get_uid_brands_native_workflow"]) {
      const onepage = await call(base, name);
      assert.deepEqual(onepage.structuredContent.external_panel, UID_EXTERNAL_PANEL);
      assert.match(onepage.content[0].text, new RegExp(UID_EXTERNAL_PANEL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(onepage.structuredContent.external_panel.opens_automatically, false);
      assert.equal(onepage.structuredContent.external_panel.private_context_transferred, false);
      safeProse(onepage);
      for (const branch of [undefined, "home-hero"]) {
        const unrelated = await call({ ...base, branch }, name);
        assert.equal(unrelated.structuredContent.external_panel, undefined);
        assert.ok(!unrelated.content[0].text.includes(UID_EXTERNAL_PANEL_URL));
      }
    }
    for (const [name, args] of [["launch_creative_dna", {}], ["get_uid_brands_native_workflow", { stage: "launcher" }]] as const) {
      const launch = await call(args, name);
      assert.deepEqual(launch.structuredContent.external_panel, UID_EXTERNAL_PANEL);
      assert.ok(launch.content[0].text.includes(UID_EXTERNAL_PANEL_URL));
      assert.doesNotMatch(JSON.stringify(launch._meta ?? {}), /resourceUri|outputTemplate/);
    }
  }, true);
});

test("pasted canonical panel selection binds only explicit current assets and preserves exclusions", async () => {
  await withMcp(async call => {
    const actual = { ...base, assets: [
      { id: "asset-secret-a", label: "Desktop", canonical_slot: "banner_desktop" },
      { id: "asset-secret-b", label: "Mobile", canonical_slot: "banner_mobile" },
      { id: "asset-secret-c", label: "Feature", canonical_slot: "wyl_01" },
    ] };
    const displayed = (await call(actual)).structuredContent.review_index;
    const result = await call({ ...actual, feedback_request: { index_id: displayed.index_id, blocks: [
      { canonical_slots: ["banner_desktop", "banner_mobile"], exclude_canonical_slots: ["banner_mobile"], text: "Increase whitespace" },
      { canonical_slots: ["wyl_01"], text: "Reduce title size" },
    ] } });
    assert.equal(result.structuredContent.feedback_resolution.ok, true);
    assert.deepEqual(result.structuredContent.feedback_resolution.blocks.map((block: any) => block.asset_ids), [["asset-secret-a"], ["asset-secret-c"]]);
    assert.deepEqual(actions(result), []);
    const unknown = await call({ ...actual, feedback_request: { index_id: displayed.index_id, blocks: [{ canonical_slots: ["gtk_03"], text: "Change missing item" }] } });
    assert.equal(unknown.structuredContent.feedback_resolution.ok, false);
    assert.deepEqual(actions(unknown), ["recover_context"]);
  });
});
