/** Shared Onepage production QA policy for ChatGPT MCP and the web frontend.
 * Descriptive contract only: the host must actually inspect images and supply evidence.
 * This file does not claim that a model generated, rendered, or reviewed an asset.
 */
import { ONEPAGE_BANNER_QC_VERSION, ONEPAGE_BANNER_QC_FLAGS } from "./onepage-banner-qc.ts";
import { ONEPAGE_CREATIVE_QC_VERSION, EO_ICON_DEFECTS } from "./onepage-creative-qc.ts";
export const ONEPAGE_PRODUCTION_QC_VERSION = "uid-onepage-production-qc/2026-11-11.v4";
export const ONEPAGE_PRODUCTION_QC = {
  schema_version: ONEPAGE_PRODUCTION_QC_VERSION,
  scope: "onepage-system",
  clients: ["chatgpt", "webapp"],
  authority: "SHARED_BACKEND_NO_CLIENT_OVERRIDE",
  content_choice: {
    candidates: ["good_to_know", "faqs"],
    default: null,
    required_evidence: ["target_pdp", "gallery_and_variants", "specifications", "buyer_questions", "relevant_review_sample"],
    selection: "Compare practical information value, unanswered buying questions, evidence sufficiency, and page-wide duplication. Pick only after research; no mode is a permanent default. Never manufacture FAQ answers or GTK claims.",
  },
  image_gates: {
    product_truth: "Inspect full-resolution ordered PDP media, variant differences, dimensions, mechanisms and use limitations. Show exact product and exact artwork; unsupported parts/features are blocked.",
    icon_quality: "EO FIRST-PASS HARD GATE: derive a single brand-approved icon reference, then inspect every unique icon at actual/full-size and small/mobile rendered size BEFORE the first presentation. Block inconsistent stroke/weight, rough fragments, wrong anatomy/perspective, weak silhouette, non-EO style/colors or unnecessary text/background. Redo only failing icon slots; do not pass because a prompt requested EO.",
    icon_first_pass_gate: { evaluator: "evaluate_onepage_creative_qc", scope: "eo_icons", version: ONEPAGE_CREATIVE_QC_VERSION, defect_flags: EO_ICON_DEFECTS, fail_closed: true, visual_review: "HOST_REQUIRED_NOT_SERVER_PERFORMED" },
    artwork_diversity: { evaluator: "evaluate_onepage_creative_qc", scope: "design_diversity", version: ONEPAGE_CREATIVE_QC_VERSION, stages: ["research_collection", "allocate_story_assets", "asset_review", "overall", "packaging"], fail_closed: true, strategy: "Enumerate verified actual product-and-artwork IDs across the requested PDP family; choose a balanced page-wide design distribution before image generation. Count distinct artwork/design IDs, not names, crops, angles or rooms. Across story sections do not overload one design or repeat adjacent designs when alternatives exist. A collection with limited verified designs must not invent variety. Product Details are the sole anchor-SKU exception; keep the same product but distinct factual closeup details.", visual_review: "HOST_REQUIRED_NOT_SERVER_PERFORMED" },
    banner_contrast: "HARD REJECT: no visible solid/opaque text slab, rectangular headline panel, abrupt horizontal transition, patchy gradient, artificially flattened copy-space, uniform tonal wash, unnatural texture/light discontinuity, staged empty wall or poor readability. Preserve natural ambient wall texture, window light falloff and camera depth in desktop AND mobile. Never solve readability by preparing a flat background.",
    banner_workflow: {
      version: "scene-first-typography-second/2026-11-11.v1",
      stages: ["research_product", "generate_scene_without_text", "inspect_scene_naturalness", "compose_typography_as_separate_layer", "inspect_desktop_mobile_composite", "bind_to_onepage_ui"],
      scene_generation: "Photograph a believable use moment, with subject/prop interaction and naturally occurring negative space; no headline, type, text box, darkened wash, uniform artificial wall, or forced text runway. Verify product truth, perspective, room detail, organic lighting and copy-space texture BEFORE composing typography.",
      composition: "Add approved typography separately over the verified scene in layout/artwork software; use type color, position, weight, size and natural scene framing to gain contrast. Never raster-edit a large backdrop slab or silently repaint the scene. Keep approved copy exact.",
      mobile: "Independently compose mobile from the scene using a verified mobile-safe crop or an independently generated text-free scene. Never fake a blank wall, enlarge solid/gradient overlay, or simply resize desktop typography. Compare natural scene continuity AND readability in mobile viewport.",
      receipts: "For each viewport keep a distinct SHA-256 of text-free scene and final composite, matching task_id and content_version, and inspect actual pixels in both files. A submitted clean report is not a pixel scan or release approval.",
    },
    banner_typography_gate: { evaluator: "evaluate_onepage_banner_qc", version: ONEPAGE_BANNER_QC_VERSION, defect_flags: ONEPAGE_BANNER_QC_FLAGS, required_viewports: ["desktop", "mobile"], fail_closed: true, required_stages: ["asset_review", "overall", "packaging"], pixel_review: "HOST_REQUIRED_NOT_SERVER_PERFORMED" },
    physical_plausibility: "Reject twisted hands, impossible grip, missing hinges, gravity errors and unnatural product interaction. Do not force a hero angle to reveal all artwork; use a separate verified closeup.",
    casting: "Follow the approved market-specific casting brief and use natural everyday people and contexts; do not infer nationality from visual appearance. Product truth, anatomy and authenticity take priority.",
    detail_export: "Export square Product Detail source images with square corners and no baked-in rounded mask. Apply border-radius once via the UI container, not in the image pixels.",
    overall: "Render the real version-bound desktop and mobile Onepage mapping, inspect text/asset placements and confirm all required slots. A template URL or file ID is not proof of rendering.",
  },
  handoff: {
    stages: ["brief", "content_approval", "asset_review", "packaging", "complete"],
    always_show: "At every genuine outcome, show the correct stage, the usable next action, and the actual task or Feedback panel link with one-sentence instructions. At asset review, include verified overall desktop and mobile previews, exact inventory, feedback route, and packaging action. Never imply that a link automatically opens or executes.",
    navigation: "Preserve branch, task_id, content_version and verified asset inventory. Feedback uses the current version-bound index and never silently resets to a new task.",
    retries: "Correct failed QC before showing an output, without pretending image generation is deterministic. No automatic publishing, Train submission, or write retry.",
  },
  enforcement: "HOST_VISUAL_AND_EVIDENCE_REVIEW_REQUIRED",
} as const;

export const ONEPAGE_PRODUCTION_QC_GUIDANCE =
  "SHARED ONEPAGE QUALITY GATES (" + ONEPAGE_PRODUCTION_QC_VERSION + "): " +
  "Before output inspect the exact product and every relevant full-resolution PDP/variant asset, its mechanisms and actual use. " +
  "Choose Good To Know versus FAQs only after evidence-backed comparison of buyer questions and page-wide content overlap; neither is default. " +
  "Before generating Onepage image assets, enumerate real PDP items and their distinct artwork IDs and assign those designs across banner, occasions, why-you-love-it and UGC slots in a single cross-section plan. Do not claim diversity by changing crop, model, angle, name or room of the same print. Keep one anchor SKU for Product Details but distinct factual closeups. Use evaluate_onepage_creative_qc scope=design_diversity to block weak coverage, dominant repeats and adjacent duplicates before review/overall/packaging; inventory claims require real inspected PDPs. FIRST-PASS EO ICON QC: derive one approved EO icon reference, maintain consistent stroke, thickness, optical weight, silhouette and line simplicity. Inspect every icon at full and mobile display size and call evaluate_onepage_creative_qc scope=eo_icons; redo failed slots before first delivery. The evaluator never sees pixels, so a clean report is not automatic visual proof. " +
  "BANNER WORKFLOW V3: SCENE-FIRST, TYPOGRAPHY-SECOND. Generate actual natural scene photos WITHOUT headline/text/overlay, inspect believable lighting, texture, depth and naturally available negative space, THEN add the approved text as an independent graphic layer. Do NOT flatten/darken/blur a section of wall to create an artificial copy area; no staged empty wall, uniform tonal wash, fake smooth texture or visible gradient. For mobile create and inspect a separate scene-safe composition, not a text-heavy resize; protect the product moment. HARD STOP on solid slab, unnatural copy space, texture/light discontinuity, abrupt split, patchy wash or low text contrast on either viewport. Call evaluate_onepage_banner_qc with independent scene and composite asset IDs/hashes, genuine full-resolution evidence and all flags, then revise if blocked. The server cannot inspect pixels; a reported-clear result is NOT visual approval. Do not mark banner, overall or packaging ready without real visual inspection. " +
  "Do not force a product-facing camera angle at the expense of gravity, anatomy, grip, hinges or real use; prefer a separate closeup. " +
  "Respect the brief's casting/market preference while prioritizing natural, anatomically plausible scenes; never infer nationality solely from appearance. " +
  "Product Detail 1:1 source images must retain square corners; apply rounding only through the UI at mapping time. " +
  "Always actually render and inspect desktop/mobile overall before reporting that result ready, show the version-bound task/feedback navigation and appropriate next action at each stage. " +
  "A text instruction, panel link, template or uploaded ID is not proof of asset generation, visual QA, panel opening or successful delivery. " +
  "Both ChatGPT and Web App must use this shared policy; client-specific UI must not change these production rules.";
