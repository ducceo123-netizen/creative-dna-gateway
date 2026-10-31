/** Slot contract transcribed from the versioned backend template; parity is tested.
 * No canonical writes, output approval or visual-QC claim is made by this module.
 */
const pairs = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, '0')).flatMap(n => [`title_${n}`, `description_${n}`]);
export const ONEPAGE_UI_CONTENT_CONTRACT = {
  schema_version: 'uid-onepage-ui-content/1',
  authority: 'SELECTED_BACKEND_UI_TEMPLATE',
  approval_scope: 'COPY_AND_ASSETS_IN_EXISTING_SLOTS_ONLY_NOT_LAYOUT_PERMISSION',
  fixed_headings: { benefits: "Why You'll Love It", details: 'Product Details', gtk: 'Good to know' },
  sections: [
    { id: 'banner', text_slots: [], note: 'Copy is inside banner assets, governed by banner content rules; no extra HTML title/support.' },
    { id: 'benefits', text_slots: pairs(1, 3), count: 3 },
    { id: 'details', text_slots: pairs(4, 6), count: 3 },
    { id: 'occasion_media', text_slots: [], count: 2, note: 'Image-only pair. No heading, support, caption or overlaid text; no new block before, between or after images.' },
    { id: 'occasion_icons', text_slots: pairs(7, 10), count: 4 },
    { id: 'post_story', text_slots_by_mode: { gtk: pairs(11, 13), faq: ['faq_heading', 'faq_question_NN', 'faq_answer_NN'] }, note: 'Select exactly one approved mode. Only FAQ rows may repeat, as defined by faq_binding.' },
  ],
  instruction: 'Read the selected backend template and its text_slots BEFORE drafting content. The template owns layout, fixed UI headings, section order, counts and responsive behavior. Draft only exact declared data-text-slot keys, never invent UI copy or insert a block to accommodate an approved draft. Product Details is followed directly by two text-free Occasion images and then four icon cards; titles/descriptions 07–10 belong to the four cards, not the image pair. Brand style/mood may vary within approved assets and product copy within declared slots; it does not authorize changing DOM, CSS, fixed headings, counts or section order. Content approval is not layout approval. If approved copy has no destination slot, stop mapping and correct the content map instead of injecting it, silently dropping it or repurposing a different slot. Bind as textContent, never HTML. Keep existing evidence, approval and desktop/mobile visual-QC gates.',
};

/** Optional full copy draft, separate from research notes and raster banner copy. */
export function validateOnepageUiCopy(copy: unknown, mode: unknown, faqCount: number): string[] {
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return ['INVALID_UI_COPY_MAP'];
  if (mode !== 'gtk' && mode !== 'faq') return ['UI_COPY_REQUIRES_SELECTED_TEMPLATE_MODE'];
  if (mode === 'faq' && (!Number.isInteger(faqCount) || faqCount < 1 || faqCount > 100)) return ['UI_COPY_INVALID_FAQ_COUNT'];
  const expected = [...pairs(1, 10), ...(mode === 'gtk' ? pairs(11, 13) : ['faq_heading', ...Array.from({ length: Math.min(100, Math.max(0, faqCount)) }, (_, i) => String(i + 1).padStart(2, '0')).flatMap(n => [`faq_question_${n}`, `faq_answer_${n}`])])];
  const entries = Object.entries(copy);
  const issues: string[] = [];
  if (entries.some(([key]) => !expected.includes(key))) issues.push('UI_COPY_OUTSIDE_TEMPLATE_SLOTS');
  if (expected.some(key => !Object.hasOwn(copy, key))) issues.push('UI_COPY_MISSING_TEMPLATE_SLOTS');
  if (entries.some(([, value]) => typeof value !== 'string' || !value.trim() || value.length > 4000)) issues.push('UI_COPY_REQUIRES_NONEMPTY_TEXT');
  return issues;
}
