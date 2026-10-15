/** General delegated creative-rule protocol. Pilot texts below are regression fixtures only.
 * This does not enable production or reclassify any existing v2 intent. */
export const RULE_REVIEW_MODE = 'agent_rule_review' as const;
export const RULE_REVIEW_SCOPE = 'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC' as const;
export const RULE_REVIEW_EVALUATOR = 'dot-agent-v3-rule-semantics' as const;
export const RULE_COMPILER = '2026-10-15-agent-rule-general-v1';
export const RULE_OPERATION = 'creative_rule_supplement.v1';
export const PILOT_SCOPE = 'STRUCTURAL shared Onepage: PawfectHouse, GiftSoul, SoulPrise; brand expression and verified product truth remain unchanged.';
export const PILOT_BRANDS = ['giftsoul', 'pawfecthouse', 'soulprise'];
const canonical = (rule: string, behavior: string, reject: string[]) => `## Generalized Rule\n${rule}\n\n## Expected Behavior\n${behavior}\n\n## Reject Conditions\n${reject.map(x => '- ' + x).join('\n')}\n\n## Scope\n${PILOT_SCOPE}\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH`;
/** These exact texts are reviewable release fixtures, not approved canonical records. */
export const PILOT_RULES = Object.freeze({
  'onepage.distinct-product-design.v1': canonical(
    'Plan product and design diversity across non-Product-Details Onepage assets using verified products relevant to the brief. Product Details preserves its one exact product anchor.',
    'Before generation, allocate each product-bearing asset to its verified product URL, SKU, variant and evidence-backed design family. Record its section, responsive creative group and any reuse reason. Prefer relevant unused verified products and designs across non-PD groups when available. Desktop/mobile versions of one creative count as one selection. Changes to personalization names, uploaded photos, sizes, angles or backgrounds alone do not establish a distinct design family. Keep the Product Details quartet on one exact SKU, design, variant and construction; exclude this intentional repetition from non-PD diversity counts. Report unique products/design families and repeated selections with evidence-backed reasons. Inspect generated assets against the allocation before claiming visual compliance. If the verified pool is insufficient, report that limitation without inventing products or specifications. Preserve single-product task scope; do not force product imagery into text-only or icon-only sections.',
    ['Unexplained repeated product/design selection when a relevant verified unused choice exists.', 'Counting responsive pairs or personalization-only changes as new designs.', 'Breaking the PD anchor or importing another product into a single-product task.', 'Claiming image QC from an allocation table or inventing products to meet a quota.']),
  'onepage.banner-product-keyword.v1': canonical(
    'In Onepage banners, the approved product-line keyword is the primary typographic focus, ahead of supporting copy.',
    'Use the verified, approved product-line wording as the strongest text emphasis through hierarchy, size, weight, contrast and placement, consistent with the active brand design system. Keep supporting text subordinate and readable on both desktop and mobile. Preserve product truth, approved copy and layout safety; do not add unsupported claims. Inspect the rendered banner before claiming visual compliance.',
    ['Supporting copy visually dominates the product-line keyword.', 'Invented product wording, claims or specifications.', 'Claiming a rendered banner passes visual QC without inspecting it.']),
});
export type PilotOperation = keyof typeof PILOT_RULES;
