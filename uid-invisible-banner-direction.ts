/**
 * Generation-time art direction, not an additional approval gate.
 * This guidance is advisory: product evidence, existing QC and canonical
 * brand rules always take precedence. Do not pretend to inspect image pixels.
 */
export const INVISIBLE_BANNER_DIRECTION_VERSION = "2026-11-17.v1";
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
    policy: INVISIBLE_BANNER_DIRECTION,
  };
}

export const INVISIBLE_BANNER_DIRECTION_GUIDANCE =
  " INVISIBLE ART DIRECTION (ONEPAGE/LDP BANNERS): Integrate art direction into the initial single-pass FULL banner generation; do not add any concept, content or typography approval step. Keep the existing approved content and all canonical research, product-fidelity and quality gates. Choose at most five genuinely inspected approved/rejected visual references for the SAME brand, product category and occasion where available; optional references must never block a task. Never claim to have inspected a reference based only on its name or metadata. Make headline hierarchy, semantic line breaks, font weight, optical spacing, product-led moment, subject relationship, natural negative space and soft localized feathered contrast treatment coherent in the first render. Avoid solid color slabs, fake empty walls, tiny thin support text, unnatural overlays and product anatomy/physics mistakes. Art-direct desktop and mobile individually while retaining the same approved meaning and real product. Run only the already-required lightweight defect review after generation, not a new serial QC stage. At most ONE conditional auto-repair if a remediable defect is detected; never create an unbounded retry or a human wait gate. Any unresolved defect must be disclosed with the actual existing BLOCKED/WARN outcome, never mislabeled PASS, and cannot bypass a canonical release gate. Learn from versioned approved/rejected feedback only through the existing admin-reviewed canonical process; do not silently promote feedback to shared rule or homogenize PawfectHouse/GiftSoul/SoulPrise styles. Track first-pass approval, repair count and added latency where telemetry is available; never invent metrics. ";
