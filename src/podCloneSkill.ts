/**
 * POD Product Clone V1
 *
 * Sibling capability to Creative DNA.
 * This file intentionally contains no Creative DNA imports or resolver fallback.
 * Memory/datastore integration will be wired through POD_CLONE_* upstreams only.
 */

export const POD_CLONE_SYSTEM_ID = "pod_clone";
export const POD_CLONE_DEFAULT_STORE = "https://af1xsf-ny.myshopify.com/";

export const POD_CLONE_BRANCHES = [
  "product_opportunities",
  "competitor_cases",
  "demand_mechanisms",
  "design_layer_patterns",
  "personalization_patterns",
  "thumbnail_patterns",
  "ad_angle_patterns",
  "production_constraints",
  "approved_variants",
  "rejected_variants",
  "learnings",
] as const;

export type PodCloneBranch = (typeof POD_CLONE_BRANCHES)[number];

export type PodCloneSourceKind =
  | "COMPETITOR_PDP"
  | "PRINT_FILE"
  | "AD_VIDEO"
  | "AD_IMAGE"
  | "AD_COPY"
  | "USER_NOTE"
  | "STORE_REFERENCE";

export type PodCloneSource = {
  kind: PodCloneSourceKind;
  reference: string;
  caption?: string;
};

export type PodCloneLayer = {
  layer_name: string;
  role: string;
  editable: boolean;
  source_needed: string;
  masking_rules?: string;
  placement_logic?: string;
  min_slots?: number;
  max_slots?: number;
  personalization_dependency?: string;
  variant_behavior?: string;
  print_safety_note?: string;
};

export type PodCloneVariantDirection = {
  concept_name: string;
  proven_demand_kept: string[];
  material_changes: string[];
  target_recipient: string;
  personalization_mechanic: string;
  visual_direction: string;
  product_format_change?: string;
  ad_entry_angle: string;
  commercial_distinction: string;
  execution_difficulty: "LOW" | "MEDIUM" | "HIGH";
  required_assets: string[];
};

export type PodCloneJobInput = {
  competitor_url?: string;
  store_url?: string;
  product_type?: string;
  niche?: string;
  supplied_assets?: PodCloneSource[];
  ad_angles?: string[];
  user_goal?: string;
  output_scope?: string[];
};

export const POD_CLONE_HARD_GATES = [
  "Extract source truth before ideation.",
  "Separate observed competitor facts from inference.",
  "Preserve demand mechanism, not exact competitor artwork or copy.",
  "Create materially differentiated product directions.",
  "Build a production-ready layer blueprint.",
  "Verify personalization and physical-product fidelity before PDP imagery.",
  "Reapply PDP thumbnails into Give Mories storefront language.",
  "Wait for explicit user approval before packaging reusable memory.",
  "Never silently resolve Creative DNA as a fallback.",
  "Every reusable learning must retain source-case evidence.",
] as const;

export const POD_CLONE_EXECUTION_STAGES = [
  "SOURCE_TRUTH",
  "OPPORTUNITY_MAP",
  "THREE_VARIANT_DIRECTIONS",
  "ASSET_LAYER_BLUEPRINT",
  "VARIANT_MATRIX",
  "THUMBNAIL_PDP_PLAN",
  "AD_ANGLE_BRIDGE",
  "USER_REVIEW",
  "OPTIONAL_MEMORY_PACKAGE",
] as const;

export const POD_CLONE_SYSTEM_SPEC = {
  id: POD_CLONE_SYSTEM_ID,
  version: "1.0.0",
  title: "POD Product Clone",
  description:
    "Turn proven competitor POD demand into commercially distinct product variants for Give Mories, with production asset decomposition, scalable personalization logic, PDP thumbnail planning, and differentiated ad angles.",
  default_store_url: POD_CLONE_DEFAULT_STORE,
  memory_isolation: {
    creative_dna_fallback: false,
    namespace: "pod_clone",
    explicit_cross_system_reference_only: true,
  },
  branches: POD_CLONE_BRANCHES,
  hard_gates: POD_CLONE_HARD_GATES,
  stages: POD_CLONE_EXECUTION_STAGES,
  default_variant_count: 3,
  packaging_requires_explicit_user_request: true,
  preferred_invocations: [
    "POD Clone — Analyze",
    "POD Clone — Package Case",
  ],
} as const;

export function compilePodCloneJob(input: PodCloneJobInput) {
  return {
    system: POD_CLONE_SYSTEM_SPEC,
    job: {
      competitor_url: input.competitor_url || null,
      store_url: input.store_url || POD_CLONE_DEFAULT_STORE,
      product_type: input.product_type || null,
      niche: input.niche || null,
      supplied_assets: input.supplied_assets || [],
      ad_angles: input.ad_angles || [],
      user_goal:
        input.user_goal ||
        "Create a differentiated POD variant for Give Mories without reproducing competitor creative execution.",
      output_scope:
        input.output_scope ||
        [
          "source_truth",
          "opportunity_map",
          "three_variant_directions",
          "asset_layer_blueprint",
          "variant_matrix",
          "thumbnail_pdp_plan",
          "ad_angle_bridge",
        ],
    },
  };
}
