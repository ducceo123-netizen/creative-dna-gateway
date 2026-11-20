/**
 * Generation-time art direction, not an additional approval gate.
 * This guidance is advisory: product evidence, existing QC and canonical
 * brand rules always take precedence. Do not pretend to inspect image pixels.
 */
export const INVISIBLE_BANNER_DIRECTION_VERSION = "2026-11-20.v2";
export const INVISIBLE_BANNER_DIRECTION = Object.freeze({
  generation: "single_pass_integrated_final_banner",
  max_auto_repairs: 1,
  additional_human_approval_gates: 0,
  reference_limit: 5,
  status_on_unresolved_defect: "WARN_NOT_PASS",
  preserve_brand_separation: true,
} as const);

export type BannerDirection = {
  brand: "pawfecthouse" | "giftsoul" | "soulprise";
  product: string;
  audience: string;
  occasion: string;
  headline: string;
  support?: string;
  references?: readonly { brand: string; status: "approved" | "rejected"; observation: string; verified_pixels: boolean }[];
};

/**
 * A bounded, deterministic context packet; it does not fetch references,
 * certify a banner, or mutate canonical wisdom.
 */
export function compileInvisibleBannerDirection(input: BannerDirection) {
  const selected = (input.references ?? [])
    .filter(r => r.brand.toLowerCase() === input.brand && r.verified_pixels && r.observation.trim())
    .slice(0, INVISIBLE_BANNER_DIRECTION.reference_limit)
    .map(r => ({ status: r.status, observation: r.observation }));
  return {
    version: INVISIBLE_BANNER_DIRECTION_VERSION,
    brand: input.brand,
    product: input.product,
    audience: input.audience,
    occasion: input.occasion,
    exact_headline: input.headline,
    support: input.support ?? "",
    references: selected,
    typography_direction: {
      priority: "BRAND_VERIFIED_EO_EXPRESSION_OVER_GENERIC_TYPE",
      evidence_status: selected.some(r=>r.status==="approved")?"APPROVED_SAME_BRAND_REFERENCES_REPORTED":"REFERENCE_STYLE_NOT_VISUALLY_VERIFIED",
      art_direction: "Select display character, optical weight, hierarchy, emphasis and line rhythm together from inspected same-brand examples where available. Product title is a designed editorial element, NOT a generic single-weight sentence over a photo. Preserve correct verified product-line title; emphasize its meaningful word/group through scale, weight, typographic contrast or intentional rhythm ONLY when consistent with same-brand EO references. Avoid artificially ornate decoration and mismatched font families.",
      layout: "Build type + photo + product moment as one balanced visual composition. Desktop must use intentional alignment, optical margins and word grouping; mobile is separately re-composed with dominant readable display type, not shrunk-to-fit text.",
      support: "If verified approved support copy exists, make it subordinate but comfortably legible and visually aligned with headline. Never use weak hairline fonts or tiny caption to make room for imagery.",
      reference_boundary: "Without inspected, approved same-brand banner pixels, do not invent exact EO font identity, font files, script style, approved color or claim style parity. Use current canonical brand typography and record parity UNVERIFIED.",
      reject: ["generic single-weight slide headline","arbitrary ornamental script or mixed fonts","flat uniform line rhythm with no hierarchy","awkward one-word orphan or line breaks","tiny thin support copy","misaligned support relative to display title","floating typography unrelated to moment","type over face or main product"]
    },
    policy: INVISIBLE_BANNER_DIRECTION,
  };
}

export const INVISIBLE_BANNER_DIRECTION_GUIDANCE =
  " EO BANNER TYPOGRAPHY RESTORATION: Before rendering any Onepage banner, inspect up to five genuinely approved same-brand full-size prior banner references where available, not just text descriptions. Determine the product/occasion-appropriate typographic voice, display hierarchy, deliberate word emphasis, optical weight, tracking, line breaks, subtitle placement and alignment with the human/product moment as ONE creative design. Do not use a default flat single-weight headline, generic PowerPoint style, arbitrary script, or weak tiny support text just because the title technically fits. Typography must feel editorial, distinctive and harmonious with actual approved EO expression; avoid copying another brand. On mobile recompose scene/negative space instead of shrinking the headline. When genuine image references are unavailable, ground direction in canonical brand tokens but mark visual style parity UNVERIFIED; do not invent historical EO specifics. Do not stop for owner approval: repair only failing viewport within current task and inspect actual final pixels. " +
  " INVISIBLE ART DIRECTION (ONEPAGE/LDP BANNERS): Integrate art direction into the initial single-pass FULL banner generation; do not add any concept, content or typography approval step. Keep the existing approved content and all canonical research, product-fidelity and quality gates. Choose at most five genuinely inspected approved/rejected visual references for the SAME brand, product category and occasion where available; optional references must never block a task. Never claim to have inspected a reference based only on its name or metadata. Make headline hierarchy, semantic line breaks, font weight, optical spacing, product-led moment, subject relationship, natural negative space and soft localized feathered contrast treatment coherent in the first render. Avoid solid color slabs, fake empty walls, tiny thin support text, unnatural overlays and product anatomy/physics mistakes. Art-direct desktop and mobile individually while retaining the same approved meaning and real product. Run only the already-required lightweight defect review after generation, not a new serial QC stage. At most ONE conditional auto-repair if a remediable defect is detected; never create an unbounded retry or a human wait gate. Any unresolved defect must be disclosed with the actual existing BLOCKED/WARN outcome, never mislabeled PASS, and cannot bypass a canonical release gate. Learn from versioned approved/rejected feedback only through the existing admin-reviewed canonical process; do not silently promote feedback to shared rule or homogenize PawfectHouse/GiftSoul/SoulPrise styles. Track first-pass approval, repair count and added latency where telemetry is available; never invent metrics. ";
