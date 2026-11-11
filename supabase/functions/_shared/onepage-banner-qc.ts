/** Deterministic, fail-closed Onepage banner typography QC.
 * This evaluator checks a host-supplied, version-bound visual inspection report.
 * It does NOT view image pixels or authenticate the reviewer.
 */
export const ONEPAGE_BANNER_QC_VERSION = "uid-onepage-banner-typography-qc/2026-11-11.v3";
export const ONEPAGE_BANNER_QC_FLAGS = [
  "visible_solid_text_slab",
  "hard_rectangular_headline_background",
  "abrupt_horizontal_scene_split",
  "opaque_or_patchy_text_overlay",
  "unreadable_typography",
  "under_supported_headline_contrast",
  "artificially_flattened_copy_space",
  "uniform_tonal_wash_behind_headline",
  "texture_or_light_discontinuity",
  "staged_empty_wall_for_typography",
] as const;
type Flag = typeof ONEPAGE_BANNER_QC_FLAGS[number];
export type BannerInspection = {
  viewport: "desktop" | "mobile";
  asset_id: string;
  sha256: string;
  method: "full_resolution_image_view";
  evidence_note: string;
  findings: Record<Flag, boolean>;
  scene_asset_id: string;
  scene_sha256: string;
  scene_method: "scene_first_no_typography";
  scene_evidence_note: string;
  final_composition_method: "independent_typography_layer";
};
export type BannerQcInput = {
  task_id: string;
  content_version: string;
  inspections: BannerInspection[];
};
const id = (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.length <= 160;
const hash = (v: unknown) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const safeObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
export const ONEPAGE_BANNER_QC_DESCRIPTION = "Onepage scene-first / typography-second banner gate (desktop AND mobile). Use separate text-free scene and independently composited typography. Do NOT universally ban overlays: permit subtle, soft feathered, localized TRANSLUCENT gradient/light support if required for legibility; preserve natural photographic detail, with no obvious slab or boundary. Flag BOTH weak headline contrast (including under-supported typography) AND opaque/flat/patchy/staged heavy overlay. Provide actual scene and composite asset hashes with genuinely inspected full-resolution evidence for each viewport. Missing evidence or any flagged defect BLOCKS banner/overall/packaging. Evaluator does NOT see pixels; submitted clean reports require independent visual QA." ;
export const ONEPAGE_BANNER_QC_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["task_id", "content_version", "inspections"],
  properties: {
    task_id: { type: "string", minLength: 1, maxLength: 160 },
    content_version: { type: "string", minLength: 1, maxLength: 160 },
    inspections: { type: "array", minItems: 2, maxItems: 2, items: {
      type: "object", additionalProperties: false,
      required: ["viewport", "asset_id", "sha256", "scene_asset_id", "scene_sha256", "scene_method", "scene_evidence_note", "final_composition_method", "method", "evidence_note", "findings"],
      properties: {
        viewport: { type: "string", enum: ["desktop", "mobile"] },
        asset_id: { type: "string", minLength: 1, maxLength: 160 },
        sha256: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        scene_asset_id: { type: "string", minLength: 1, maxLength: 160 },
        scene_sha256: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        scene_method: { type: "string", enum: ["scene_first_no_typography"] },
        scene_evidence_note: { type: "string", minLength: 40, maxLength: 2000 },
        final_composition_method: { type: "string", enum: ["independent_typography_layer"] },
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
    next_action: "Create a scene without baked-in typography, compose text as an independent layer, inspect both assets and both viewport composites, correct defects, then submit a new task/version-bound report. Do not claim visual QC or deliver blocked banners.",
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
    if (!id(v.scene_asset_id) || !hash(v.scene_sha256) || v.scene_method !== "scene_first_no_typography" ||
      v.final_composition_method !== "independent_typography_layer" ||
      typeof v.scene_evidence_note !== "string" || v.scene_evidence_note.trim().length < 40 || v.scene_evidence_note.length > 2000)
      issues.push(`MISSING_SCENE_FIRST_EVIDENCE:${v.viewport}`);
    if (v.scene_asset_id === v.asset_id || v.scene_sha256 === v.sha256)
      issues.push(`SCENE_AND_COMPOSITE_MUST_BE_DISTINCT:${v.viewport}`);
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
    reviewed_assets: input.inspections.map((v: BannerInspection) => ({ viewport: v.viewport, asset_id: v.asset_id, sha256: v.sha256, scene_asset_id: v.scene_asset_id, scene_sha256: v.scene_sha256 })),
    applies_to: ["banner_asset_review", "overall_desktop_mobile", "packaging"],
    next_action: "Host must independently verify actual image pixels and desktop/mobile overall before release. Do not claim automatic QC PASS from this report.",
  };
}
