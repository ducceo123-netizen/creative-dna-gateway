/** Additive FAQ mapping variant. Existing GTK source and hashes stay immutable. */
export const ONEPAGE_FAQ_TEMPLATE_VERSION = '2026-10-19.faq.v1';

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
