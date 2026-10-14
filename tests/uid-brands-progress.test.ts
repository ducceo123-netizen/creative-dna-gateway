import test from "node:test";
import assert from "node:assert/strict";
import { createApp, TOOL_DEFINITIONS } from "../server.ts";
import { UID_PROGRESS_GUIDANCE, UID_PROGRESS_REMINDER, UID_PROGRESS_DESCRIPTION, UID_TOOL_INVOCATION_LABELS, uidProgressTool, withUidProgress } from "../uid-brands-progress.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { RESEARCH_GUIDANCE } from "../supabase/functions/_shared/product-research.ts";
import { gatewayJson } from "../uid-gateway-upstream.ts";

async function withMcp(work: (rpc: (method: string, params: unknown) => Promise<any>) => Promise<void>, upstream?: typeof fetch) {
  const app = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => app.once("listening", resolve));
  const origin = `http://127.0.0.1:${(app.address() as any).port}`;
  const original = globalThis.fetch;
  if (upstream) globalThis.fetch = upstream;
  let id = 0;
  try {
    await work(async (method, params) => {
      const response = await original(origin + "/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      assert.equal(response.status, 200);
      const wire = await response.text();
      const packet = wire.startsWith("{") ? JSON.parse(wire) : JSON.parse(wire.split("\n").find(line => line.startsWith("data: "))!.slice(6));
      assert.equal(packet.error, undefined);
      return packet.result;
    });
  } finally {
    globalThis.fetch = original;
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
}

function assertGuidanceOnce(result: any) {
  const visible = JSON.stringify({ content: result.content, structuredContent: result.structuredContent });
  assert.equal(visible.split(UID_PROGRESS_REMINDER).length - 1, 1);
  assert.equal(result.progress, undefined);
  assert.equal(result.job_status, undefined);
}

test("all nine discovered and registered tools share supported bounded labels and preserve metadata", async () => {
  await withMcp(async rpc => {
    const initialized = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "progress-test", version: "1" } });
    assert.ok(initialized.instructions.startsWith(UID_PROGRESS_GUIDANCE));
    assert.match(initialized.instructions.slice(0, 512), /Research-before-output gates creative deliverables, not progress updates/);
    assert.ok(initialized.instructions.includes(RESEARCH_GUIDANCE));
    const { tools } = await rpc("tools/list", {});
    assert.equal(tools.length, 9);
    assert.deepEqual(tools.map((t: any) => t.name).sort(), Object.keys(UID_TOOL_INVOCATION_LABELS).sort());
    for (const tool of tools) {
      const discovery = TOOL_DEFINITIONS.find(t => t.name === tool.name)!;
      assert.deepEqual(tool._meta, discovery._meta, tool.name);
      assert.equal(tool.description, discovery.description);
      assert.ok(tool.description.endsWith(UID_PROGRESS_DESCRIPTION));
      for (const field of ["invoking", "invoked"]) {
        const label = tool._meta[`openai/toolInvocation/${field}`];
        assert.ok(label.length > 0 && [...label].length <= 64, `${tool.name}: ${field}`);
      }
      assert.match(tool._meta["openai/toolInvocation/invoked"], /call ended$/);
      assert.doesNotMatch(tool._meta["openai/toolInvocation/invoked"], /success|ready|complete|approved|saved|generated/i);
      assert.deepEqual(tool.annotations, discovery.annotations);
    }
    assert.deepEqual(tools.find((t: any) => t.name === "ingest_uid_brands_attachment")._meta["openai/fileParams"], ["file"]);
    assert.equal(tools.find((t: any) => t.name === "launch_creative_dna")._meta["openai/widgetAccessible"], true);
    assert.equal(tools.find((t: any) => t.name === "submit_training_feedback").annotations.readOnlyHint, false);
  });
});

test("live successful tool results carry one model-visible contract without claiming downstream execution", async () => {
  await withMcp(async rpc => {
    for (const [name, args] of [
      ["launch_creative_dna", {}],
      ["list_creative_dna_routes", {}],
      ["get_onepage_ui_template", {}],
      ["show_uid_brands_review", { stage: "content_approval", result_content: "Verified draft for review" }],
      ["get_uid_brands_native_workflow", { stage: "content_approval" }],
      ["submit_training_feedback", { brand: "PawfectHouse", branch: "LDP", feedback: "Use readable heading hierarchy", submitter_name: "Verified Member" }],
    ] as const) {
      const result = await rpc("tools/call", { name, arguments: args });
      assert.notEqual(result.isError, true, name);
      assertGuidanceOnce(result);
      if (name === "submit_training_feedback") assert.equal(JSON.parse(result.content[0].text).status, "Pending");
      if (name === "show_uid_brands_review") assert.equal(result.structuredContent.result_content, "Verified draft for review");
    }
  }, async (_url, init) => JSON.parse(String(init?.body || "{}")).action === "routes" ? Response.json({ routes: [] }) : Response.json({ status: "Pending", proposal_id: "test-proposal" }));
});

test("resolver/compiler research gates remain blocking creative authoring while progress remains visible", async () => {
  await withMcp(async rpc => {
    for (const name of ["resolve_creative_dna", "compile_onepage_job"]) {
      const result = await rpc("tools/call", { name, arguments: { brand: "PawfectHouse", ...(name === "resolve_creative_dna" ? { branch: "Home Hero" } : {}) } });
      assert.notEqual(result.isError, true);
      const data = JSON.parse(result.content[0].text);
      assert.equal(data.research_validation.status, "AWAITING_RESEARCH");
      assert.ok(["REQUIRES_RESEARCH", "BLOCKED"].includes(data.readiness.content_authoring));
      assert.equal(data.branch.content_md, "Original canonical rules");
      assertGuidanceOnce(result);
    }
  }, async () => Response.json({ brand: { slug: "pawfecthouse" }, branch: { slug: "home-hero", content_md: "Original canonical rules" } }));
});

test("live blocked reads, failed attachment/template and uncertain Train preserve errors and safe recovery", async () => {
  let trainCalls = 0;
  await withMcp(async rpc => {
    const calls = [
      ["launch_creative_dna", {}], ["list_creative_dna_routes", {}],
      ["resolve_creative_dna", { brand: "PawfectHouse", branch: "Home Hero" }],
      ["compile_onepage_job", { brand: "PawfectHouse" }],
      ["get_onepage_ui_template", { version: "nonexistent" }],
      ["ingest_uid_brands_attachment", { file: { file_id: "file-test", download_url: "http://127.0.0.1/blocked" } }],
      ["submit_training_feedback", { brand: "PawfectHouse", branch: "LDP", feedback: "Use readable heading hierarchy", submitter_name: "Verified Member" }],
    ] as const;
    for (const [name, args] of calls) {
      const result = await rpc("tools/call", { name, arguments: args });
      assert.equal(result.isError, true, name);
      assertGuidanceOnce(result);
      if (name === "submit_training_feedback") {
        const failure = JSON.parse(result.content[0].text);
        assert.equal(failure.recovery.outcome, "unknown");
        assert.equal(failure.recovery.action, "verify_before_retry");
        assert.equal(failure.recovery.retryable, false);
      }
      assert.doesNotMatch(JSON.stringify(result), /secret-upstream-detail/);
    }
    const partial = await rpc("tools/call", { name: "get_uid_brands_native_workflow", arguments: {} });
    assertGuidanceOnce(partial);
    assert.equal(partial.structuredContent.routes_error.recovery.action, "retry_read");
    assert.ok(partial.structuredContent.form.fields.length > 0);
  }, async (url) => {
    if (String(url).includes("feedback-submit")) trainCalls++;
    return Response.json({ error: "secret-upstream-detail" }, { status: 503, headers: { "Retry-After": "0" } });
  });
  assert.equal(trainCalls, 1);
});

test("slow operations add no synthetic state and preserve timeout/unknown recovery without retries", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response(new ReadableStream({ start() {} })); };
    const upstream = await gatewayJson("https://example.test/submit", { method: "POST" }, { operation: "train", timeoutMs: 25 });
    const result = withUidProgress({ content: [{ type: "text", text: JSON.stringify(upstream.data) }], isError: !upstream.ok });
    assert.equal(calls, 1);
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).recovery.outcome, "unknown");
    assertGuidanceOnce(result);
    assert.deepEqual(Object.keys(result).sort(), ["content", "isError"]);
  } finally { globalThis.fetch = original; }
});

test("partial outcomes preserve actual evidence and one next-action contract, never infer completion", () => {
  const structuredContent = { assets: [{ id: "real-banner" }], blocked: ["Required product reference unavailable"], pending: ["Detail image"], next_action: "Obtain exact product reference" };
  const result = withUidProgress({ content: [{ type: "text", text: "One banner available; detail image blocked" }], structuredContent });
  assert.strictEqual(result.structuredContent, structuredContent);
  assert.equal(result.structuredContent.assets.length, 1);
  assertGuidanceOnce(result);
  const native = withUidProgress({ content: [{ type: "text", text: "Workflow controls" }], structuredContent: UID_NATIVE_WORKFLOW });
  assert.equal(native.content.length, 2);
  assert.match(native.structuredContent.statusContract, /Keep drafts for the same exact review/);
  assertGuidanceOnce(native);
  assert.match(UID_PROGRESS_GUIDANCE, /done \/ pending \/ blocked and the next action/);
  assert.match(UID_PROGRESS_GUIDANCE, /Never expose private reasoning, invent percentages, timers or completion/);
  assert.match(UID_PROGRESS_GUIDANCE, /Continue authorized work without redundant confirmation/);
  assert.throws(() => uidProgressTool("unlisted_tool", { description: "new tool" }), /Missing invocation labels/);
});

test("route failure followed by review is phase-scoped, never blanket form failure or verified rendering", async () => {
  await withMcp(async rpc => {
    const launcher=await rpc("tools/call",{name:"launch_creative_dna",arguments:{}});
    assert.equal(launcher.isError,true);
    assert.equal(launcher.structuredContent.ui_status.routing,"degraded");
    assert.equal(launcher.structuredContent.ui_status.render,"unverified");
    assert.match(launcher.content[0].text,/does not prove the form failed to render/);
    const review=await rpc("tools/call",{name:"show_uid_brands_review",arguments:{stage:"content_approval",task_id:"task-A",content_version:"v1",result_content:"Content v1"}});
    assert.notEqual(review.isError,true);
    assert.equal(review.structuredContent.ui_status.stage,"content_approval");
    assert.equal(review.structuredContent.ui_status.render,"unverified");
    assert.match(review.content[0].text,/earlier launcher or route error belongs to that earlier stage/);
    assert.match(review.content[0].text,/Do not create another panel/);
    const init=await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"stage-test",version:"1"}});
    assert.match(init.instructions,/do not repeat an earlier launcher error as a current blanket form failure/);
  },async()=>Response.json({error:"unavailable"},{status:503,headers:{"Retry-After":"0"}}));
});

test("research and market work retain natural chat updates before the final artifact",()=>{
 assert.match(UID_PROGRESS_GUIDANCE,/Keep ordinary conversational acknowledgement and progress visible while the embedded UI is open/);
 assert.match(UID_PROGRESS_GUIDANCE,/verified PDP\/specification checks, review findings, market\/comparison coverage and missing sources/);
 assert.match(UID_PROGRESS_GUIDANCE,/before the final artifact/);
 assert.match(UID_PROGRESS_REMINDER,/Full-result deduplication must not suppress these updates/);
 assert.match(UID_PROGRESS_REMINDER,/distinguish planned work from checked sources/);
});
