import { test, expect } from "bun:test";
import { getWebsiteBrandUiSkill, WEBSITE_BRAND_UI_SECTIONS, isWebsiteBrandUiSection } from "../uid-website-brand-ui.ts";
import { TOOL_DEFINITIONS } from "../server.ts";

test("shared Website Brand UI instructions are available without an account-specific file path", async () => {
  const result = await getWebsiteBrandUiSkill();
  expect(result.skill).toBe("website-brand-ui");
  expect(result.section).toBe("SKILL.md");
  expect(result.content).toContain("Website");
  expect(result.available_sections).toContain("references/workflow.md");
  expect(result.execution_status).toBe("guidance_only");
});

test("supports evidence workflow and brand-fidelity references", async () => {
  for (const name of ["references/workflow.md", "references/brand-fidelity.md"] as const) {
    const result = await getWebsiteBrandUiSkill(name);
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.section).toBe(name);
  }
});

test("rejects path traversal and undeclared files", async () => {
  expect(isWebsiteBrandUiSection("../server.ts")).toBe(false);
  expect(isWebsiteBrandUiSection("scripts/capture.cjs")).toBe(false);
  expect(WEBSITE_BRAND_UI_SECTIONS.length).toBeGreaterThan(10);
  await expect(getWebsiteBrandUiSkill("../server.ts" as any)).rejects.toThrow();
});

test("publishes cross-account tool discovery metadata", () => {
  const tools = TOOL_DEFINITIONS.filter(x => x.name === "get_website_brand_ui_skill");
  expect(tools).toHaveLength(1);
  expect(tools[0].annotations.readOnlyHint).toBe(true);
  expect(tools[0].inputSchema.properties.section.type).toBe("string");
});
