/** Shared Onepage production QA policy for ChatGPT MCP and the web frontend.
 * Descriptive contract only: the host must actually inspect images and supply evidence.
 * This file does not claim that a model generated, rendered, or reviewed an asset.
 */
export const ONEPAGE_PRODUCTION_QC_VERSION = "uid-onepage-production-qc/2026-11-11.v1";
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
    icon_quality: "Inspect first-pass icons for canonical EO style, coherent strokes, clean silhouettes, anatomy, consistent optical weight and no stray/fragmented marks. Regenerate before presenting failed icons.",
    banner_contrast: "Compose lighting, crop and negative space before using an overlay. Avoid conspicuous opaque/solid blocks behind headline, especially mobile. Use restrained, gradual treatment only when necessary and review both viewports.",
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
  "First-pass EO icons must have clean coherent strokes, consistent proportions and no stray/fragmented marks; redo failed icons before presentation. " +
  "Make banner typography legible primarily through composition and lighting, never a heavy conspicuous solid mobile text slab. " +
  "Do not force a product-facing camera angle at the expense of gravity, anatomy, grip, hinges or real use; prefer a separate closeup. " +
  "Respect the brief's casting/market preference while prioritizing natural, anatomically plausible scenes; never infer nationality solely from appearance. " +
  "Product Detail 1:1 source images must retain square corners; apply rounding only through the UI at mapping time. " +
  "Always actually render and inspect desktop/mobile overall before reporting that result ready, show the version-bound task/feedback navigation and appropriate next action at each stage. " +
  "A text instruction, panel link, template or uploaded ID is not proof of asset generation, visual QA, panel opening or successful delivery. " +
  "Both ChatGPT and Web App must use this shared policy; client-specific UI must not change these production rules.";
