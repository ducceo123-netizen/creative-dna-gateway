/** Deterministic, fail-closed Onepage banner typography QC.
 * This evaluator checks a host-supplied, version-bound visual inspection report.
 * It does NOT view image pixels or authenticate the reviewer.
 */
export const ONEPAGE_BANNER_QC_VERSION = "uid-onepage-banner-typography-qc/2026-11-11.v1";
export const ONEPAGE_BANNER_QC_FLAGS = [
  "visible_solid_text_slab",
  "hard_rectangular_headline_background",
  "abrupt_horizontal_scene_split",
  "opaque_or_patchy_text_overlay",
  "unreadable_typography",
] as const;
type Flag = typeof ONEPAGE_BANNER_QC_FLAGS[number];
export type BannerInspection = {
  viewport: "desktop" | "mobile";
  asset_id: string;
  sha256: string;
  method: "full_resolution_image_view";
  evidence_note: string;
  findings: Record<Flag, boolean>;
};
export type BannerQcInput = {
  task_id: string;
  content_version: string;
  inspections: BannerInspection[];
};
const id = (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.length <= 160;
const hash = (v: unknown) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const safeObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
export const ONEPAGE_BANNER_QC_DESCRIPTION = "Onepage banner typography background gate (desktop AND mobile). Supply genuine full-resolution inspection notes for each exact version-bound banner and explicit boolean findings for solid text slabs, rectangular headline backgrounds, abrupt horizontal splits, patchy overlays and poor contrast. A flagged or missing/invalid finding BLOCKS the asset-review/overall/packaging stage. The tool does not inspect pixels and cannot certify absence of an issue: a clean report requires independent host visual QA, which must not be claimed without inspection. Correct the source image and rerun on new asset hashes before delivery.";
export const ONEPAGE_BANNER_QC_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["task_id", "content_version", "inspections"],
  properties: {
    task_id: { type: "string", minLength: 1, maxLength: 160 },
    content_version: { type: "string", minLength: 1, maxLength: 160 },
    inspections: { type: "array", minItems: 2, maxItems: 2, items: {
      type: "object", additionalProperties: false,
      required: ["viewport", "asset_id", "sha256", "method", "evidence_note", "findings"],
      properties: {
        viewport: { type: "string", enum: ["desktop", "mobile"] },
        asset_id: { type: "string", minLength: 1, maxLength: 160 },
        sha256: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        method: { type: "string", enum: ["full_resolution_image_view"] },
        evidence_note: { type: "string", minLength: 40, maxLength: 2000 },
        findings: { type: "object", additionalProperties: false, required: [...ONEPAGE_BANNER_QC_FLAGS],
          properties: Object.fromEntries(ONEPAGE_BANNER_QC_FLAGS.map(k => [k, { type: "boolean" }])) },
      },
    } },
  },
} as const;

export function evaluateOnepageBannerQc(input: unknown) {
  const blocked = (reasons: string[]) => ({
    schema_version: ONEPAGE_BANNER_QC_VERSION, status: "BLOCKED" as const,
    reasons: [...new Set(reasons)], can_release: false, pixel_inspected_by_server: false,
    applies_to: ["banner_asset_review", "overall_desktop_mobile", "packaging"],
    next_action: "Inspect real source banners, correct defects, and submit a new exact task/version-bound report. Do not claim visual QC or deliver blocked banners.",
  });
  if (!safeObj(input) || !id(input.task_id) || !id(input.content_version) || !Array.isArray(input.inspections) || input.inspections.length !== 2)
    return blocked(["MISSING_OR_INVALID_VERSION_BOUND_INSPECTIONS"]);
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const v of input.inspections) {
    if (!safeObj(v) || !["desktop","mobile"].includes(v.viewport) || seen.has(v.viewport)) { issues.push("MISSING_OR_DUPLICATE_VIEWPORT"); continue; }
    seen.add(v.viewport);
    if (!id(v.asset_id) || !hash(v.sha256) || v.method !== "full_resolution_image_view" ||
      typeof v.evidence_note !== "string" || v.evidence_note.trim().length < 40 || v.evidence_note.length > 2000)
      issues.push(`INSUFFICIENT_VISUAL_EVIDENCE:${v.viewport}`);
    if (!safeObj(v.findings) || Object.keys(v.findings).length !== ONEPAGE_BANNER_QC_FLAGS.length ||
      ONEPAGE_BANNER_QC_FLAGS.some(k => typeof v.findings[k] !== "boolean"))
      issues.push(`INCOMPLETE_FINDINGS:${v.viewport}`);
    else for (const flag of ONEPAGE_BANNER_QC_FLAGS) if (v.findings[flag]) issues.push(`BANNER_DEFECT:${v.viewport}:${flag}`);
  }
  if (!seen.has("desktop") || !seen.has("mobile")) issues.push("BOTH_VIEWPORTS_REQUIRED");
  if (issues.length) return blocked(issues);
  return {
    schema_version: ONEPAGE_BANNER_QC_VERSION,
    status: "REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA" as const,
    can_release: false,
    pixel_inspected_by_server: false,
    task_id: input.task_id,
    content_version: input.content_version,
    reviewed_assets: input.inspections.map((v: BannerInspection) => ({ viewport: v.viewport, asset_id: v.asset_id, sha256: v.sha256 })),
    applies_to: ["banner_asset_review", "overall_desktop_mobile", "packaging"],
    next_action: "Host must independently verify actual image pixels and desktop/mobile overall before release. Do not claim automatic QC PASS from this report.",
  };
}
