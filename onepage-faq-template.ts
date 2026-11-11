/** Additive FAQ mapping variant. Existing GTK source and hashes stay immutable. */
export const ONEPAGE_FAQ_LEGACY_VERSION = '2026-10-19.faq.v1';
export const ONEPAGE_FAQ_TEMPLATE_VERSION = '2026-11-11.faq.v2';

/** Replace only the captured post-story GTK block, keeping every other byte. */
export function replacePostStorySection(html: string, faqHtml: string) {
  const marker = '<div class="uid-product-good-to-know">';
  const start = html.indexOf(marker);
  if (start < 0 || html.indexOf(marker, start + marker.length) >= 0) throw new Error('Expected one captured GTK section');
  const tags = /<div\b[^>]*>|<\/div\s*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(0, start) + faqHtml + html.slice(tags.lastIndex);
  }
  throw new Error('Unbalanced captured GTK section');
}

/**
 * Replace the checkbox-backed FAQ prototype with native, accessible details/summary.
 * The checked input is never present in new Onepage FAQ mapping HTML.
 * Historical captured FAQ v1 remains available for archived output verification.
 */
export function checkboxFreeFaqSection(html: string) {
  const before = '<div class="uid-faqs-item" data-faq-item="01"><input class="product-tabs__radio" type="checkbox" hidden id="uid-faq-01" checked aria-label="Toggle FAQ answer"><label class="uid-faqs-question" for="uid-faq-01">';
  const after = '<div class="uid-faqs-item" data-faq-item="01"><details class="uid-faq-entry" open><summary class="uid-faqs-question">';
  const closeBefore = '</span></label><div class="uid-faqs-answer"';
  const closeAfter = '</span></summary><div class="uid-faqs-answer"';
  const tailBefore = '{{faq_answer_01}}</div></div></div></div>';
  const tailAfter = '{{faq_answer_01}}</div></details></div></div></div>';
  if (!html.includes(before) || !html.includes(closeBefore) || !html.includes(tailBefore))
    throw new Error('FAQ_CHECKBOX_PROTOTYPE_MISMATCH');
  const revised = html.replace(before, after).replace(closeBefore, closeAfter).replace(tailBefore, tailAfter);
  if (/\btype\s*=\s*["']checkbox["']|<input\b|<label\b|\buid-faq-01\b/i.test(revised))
    throw new Error('FAQ_CHECKBOX_NOT_REMOVED');
  return revised;
}

/* Explicit scoped native-FAQ behavior; checkboxes are absent, not merely hidden.
 * Keep the established FAQ typography, layout and +/- icon styling.
 */
export const CHECKBOX_FREE_FAQ_CSS = `
.uid-product-content-faqs .uid-faq-entry { display: block; width: 100%; }
.uid-product-content-faqs .uid-faq-entry > summary.uid-faqs-question {
  list-style: none; cursor: pointer; user-select: none;
}
.uid-product-content-faqs .uid-faq-entry > summary.uid-faqs-question::marker { content: ""; }
.uid-product-content-faqs .uid-faq-entry > summary.uid-faqs-question::-webkit-details-marker { display: none; }
.uid-product-content-faqs .uid-faq-entry > .uid-faqs-answer { display: none; }
.uid-product-content-faqs .uid-faq-entry[open] > .uid-faqs-answer { display: block; }
.uid-product-content-faqs .uid-faq-entry[open] > summary .uid-faqs-icon::before {
  transform: translateX(-50%) rotate(90deg);
}
.uid-product-content-faqs .uid-faq-entry > summary:focus-visible {
  outline: 2px solid currentColor; outline-offset: 2px;
}
`;
