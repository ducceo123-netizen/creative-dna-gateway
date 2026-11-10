import { readFile } from "node:fs/promises";
import path from "node:path";

export const WEBSITE_BRAND_UI_SKILL_VERSION = "2026-11-10";
export const WEBSITE_BRAND_UI_SECTIONS = [
  "SKILL.md", "references/workflow.md", "references/brand-fidelity.md",
  "references/pic-playbooks.md", "references/SOURCES.md",
  "references/brand.schema.json", "references/tokens.schema.json",
  "references/pic-playbook.schema.json", "references/new-brand-mapping.schema.json",
  "references/impeccable-layout.md", "references/impeccable-typeset.md",
  "references/impeccable-craft-floor.md", "references/impeccable-critique.md",
  "references/impeccable-audit.md", "references/impeccable-adapt.md",
  "references/impeccable-harden.md",
] as const;
export type WebsiteBrandUiSection = typeof WEBSITE_BRAND_UI_SECTIONS[number];
export const WEBSITE_BRAND_UI_TOOL_DESCRIPTION =
  "Read the shared Website Brand UI skill for evidence-based website-to-brand-kit, " +
  "Scale Store Brand research, brand-fidelity audit, and ecommerce UI consistency. " +
  "Use for requests to derive Brand Identity/Brand Style/UI Rules from a website or compare brand systems. " +
  "Read SKILL.md and workflow.md first; request other specific references as needed. " +
  "This read-only tool returns instructions, not a completed website scan. " +
  "Do not claim to have visited a website or performed capture unless you actually did. " +
  "Preserve PawfectHouse/GiftSoul/SoulPrise canonical Creative DNA and Onepage/LDP workflows.";

export function isWebsiteBrandUiSection(value: unknown): value is WebsiteBrandUiSection {
  return typeof value === "string" && (WEBSITE_BRAND_UI_SECTIONS as readonly string[]).includes(value);
}
export async function getWebsiteBrandUiSkill(section: WebsiteBrandUiSection = "SKILL.md") {
  if (!isWebsiteBrandUiSection(section)) throw new Error("Unknown website-brand-ui section");
  const root = path.resolve(process.cwd(), "skills", "website-brand-ui");
  const file = path.resolve(root, section);
  if (!file.startsWith(root + path.sep)) throw new Error("Invalid skill path");
  const text = await readFile(file, "utf8");
  if (text.length > 80_000) throw new Error("Skill section exceeds allowed size");
  return {
    skill: "website-brand-ui",
    version: WEBSITE_BRAND_UI_SKILL_VERSION,
    section,
    content: text,
    available_sections: WEBSITE_BRAND_UI_SECTIONS,
    execution_status: "guidance_only",
    warning: "This tool reads the shared skill; website capture and validation need a separate browser/Node runtime.",
  };
}
