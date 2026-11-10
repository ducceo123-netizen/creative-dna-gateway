import { test } from "node:test";
import assert from "node:assert/strict";
import { getWebsiteBrandUiSkill, WEBSITE_BRAND_UI_SECTIONS, isWebsiteBrandUiSection } from "../uid-website-brand-ui.ts";
import { TOOL_DEFINITIONS } from "../server.ts";

test("shared Website Brand UI instructions are available without an account-specific file path", async () => {
  const result = await getWebsiteBrandUiSkill();
  assert.equal(result.skill, "website-brand-ui");
  assert.equal(result.section, "SKILL.md");
  assert.ok(result.content.includes("Website"));
  assert.ok(result.available_sections.includes("references/workflow.md"));
  assert.equal(result.execution_status, "guidance_only");
});

test("supports evidence workflow and brand-fidelity references", async () => {
  for (const name of ["references/workflow.md", "references/brand-fidelity.md"] as const) {
    const result = await getWebsiteBrandUiSkill(name);
    assert.ok(result.content.length > 100);
    assert.equal(result.section, name);
  }
});

test("rejects path traversal and undeclared files", async () => {
  assert.equal(isWebsiteBrandUiSection("../server.ts"), false);
  assert.equal(isWebsiteBrandUiSection("scripts/capture.cjs"), false);
  assert.ok(WEBSITE_BRAND_UI_SECTIONS.length > 10);
  await assert.rejects(getWebsiteBrandUiSkill("../server.ts" as any));
});

test("publishes cross-account tool discovery metadata", () => {
  const tools = TOOL_DEFINITIONS.filter(x => x.name === "get_website_brand_ui_skill");
  assert.equal(tools.length, 1);
  const tool = tools[0];
  if (!tool) throw new Error("Missing website-brand-ui tool");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.ok(tool.inputSchema);
});
