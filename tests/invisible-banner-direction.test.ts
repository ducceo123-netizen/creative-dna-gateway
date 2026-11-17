import { test } from "node:test";
import { strict as assert } from "node:assert";
import { compileInvisibleBannerDirection, INVISIBLE_BANNER_DIRECTION, INVISIBLE_BANNER_DIRECTION_GUIDANCE } from "../uid-invisible-banner-direction.ts";
import { REVIEW_EXECUTION_GUIDANCE } from "../uid-brands-actions.ts";

const input = {
  brand: "pawfecthouse" as const,
  product: "Personalized Ornament",
  audience: "pet lovers",
  occasion: "Christmas",
  headline: "Made Just for Your Christmas",
};
test("runtime creative execution includes first-pass direction without additional approval", () => {
  assert.ok(REVIEW_EXECUTION_GUIDANCE.includes(INVISIBLE_BANNER_DIRECTION_GUIDANCE));
  assert.equal(INVISIBLE_BANNER_DIRECTION.generation, "single_pass_integrated_final_banner");
  assert.equal(INVISIBLE_BANNER_DIRECTION.max_auto_repairs, 1);
  assert.equal(INVISIBLE_BANNER_DIRECTION.additional_human_approval_gates, 0);
  assert.match(INVISIBLE_BANNER_DIRECTION_GUIDANCE, /cannot bypass a canonical release gate/);
});
test("references stay optional, brand-isolated and inspected", () => {
  const result = compileInvisibleBannerDirection({
    ...input, references: [
      { brand: "pawfecthouse", status: "approved", verified_pixels: true, observation: "natural blur" },
      { brand: "giftsoul", status: "approved", verified_pixels: true, observation: "other brand" },
      { brand: "pawfecthouse", status: "rejected", verified_pixels: false, observation: "metadata only" },
    ],
  });
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].observation, "natural blur");
  assert.equal(compileInvisibleBannerDirection(input).references.length, 0);
});
test("reference packet is bounded", () => {
  const result = compileInvisibleBannerDirection({
    ...input, references: Array.from({ length: 25 }, (_, i) => ({ brand: "pawfecthouse", status: "approved" as const, verified_pixels: true, observation: "pattern " + i })),
  });
  assert.equal(result.references.length, 5);
});
