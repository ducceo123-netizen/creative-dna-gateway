import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ONEPAGE_PRODUCTION_QC, ONEPAGE_PRODUCTION_QC_GUIDANCE } from "../supabase/functions/_shared/onepage-production-qc.ts";
import { UID_NATIVE_WORKFLOW } from "../uid-brands-actions.ts";
import { RESEARCH_GUIDANCE } from "../supabase/functions/_shared/product-research.ts";
import { getOnepageUiTemplate } from "../onepage-ui-template.ts";

test("Onepage production QC is shared by ChatGPT workflow, research and UI template", () => {
  assert.deepEqual(ONEPAGE_PRODUCTION_QC.clients, ["chatgpt", "webapp"]);
  assert.equal(ONEPAGE_PRODUCTION_QC.content_choice.default, null);
  assert.deepEqual(UID_NATIVE_WORKFLOW.onepageProductionQc, ONEPAGE_PRODUCTION_QC);
  assert.ok(RESEARCH_GUIDANCE.includes(ONEPAGE_PRODUCTION_QC_GUIDANCE));
  const manifest = getOnepageUiTemplate();
  assert.deepEqual(manifest.production_qc_contract, ONEPAGE_PRODUCTION_QC);
});
test("First-pass quality rules and mapping handoff stay represented", () => {
  const qc = ONEPAGE_PRODUCTION_QC;
  assert.match(qc.image_gates.icon_quality, /first-pass/i);
  assert.match(qc.image_gates.detail_export, /square corners/i);
  assert.match(qc.image_gates.overall, /desktop and mobile/i);
  assert.match(qc.handoff.navigation, /content_version/);
  assert.match(qc.image_gates.banner_contrast, /mobile/);
});
