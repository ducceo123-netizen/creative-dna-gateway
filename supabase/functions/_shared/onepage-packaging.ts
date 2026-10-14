/** Technical projection of canonical Onepage naming, not an archive execution receipt.
 * Sources: canonical:onepage-system / ONEPAGE ASSET PACKAGING & FILE NAMING,
 * ONEPAGE PACKAGE ROOT FOLDER NAMING, final WebP rule, mapping-png.v1.
 */
export const ONEPAGE_DELIVERY_ROLES: Record<string, string> = {
  banner_desktop: 'banner', banner_mobile: 'banner-mobile',
  wyl_01: 'wyl_01', wyl_02: 'wyl_02', wyl_03: 'wyl_03',
  detail_main: 'detail_banner', detail_01: 'detail-01', detail_02: 'detail-02', detail_03: 'detail-03',
  occasion_01: 'occasion_banner-01', occasion_02: 'occasion_banner-02',
  occasion_icon_01: 'occasion_icon-01', occasion_icon_02: 'occasion_icon-02',
  occasion_icon_03: 'occasion_icon-03', occasion_icon_04: 'occasion_icon-04',
  gtk_01: 'gtk-01', gtk_02: 'gtk-02', gtk_03: 'gtk-03',
};
export const ONEPAGE_PACKAGING_CONTRACT = {
  schema_version: 'uid-onepage-packaging/1',
  source: 'canonical:onepage-system',
  execution: 'HOST_PACKAGING_REQUIRES_EXPLICIT_USER_APPROVAL',
  root_folder_template: 'Onepage - {product_line_name}',
  product_line_rule: 'Use the supplied or clearly resolved product LINE name. Never substitute brand, SKU, campaign or revision suffix. Do not slugify the display folder name. If ambiguous, resolve before packaging.',
  product_slug_rule: 'One stable lowercase ASCII snake_case product-line slug; do not use a full SKU or campaign.',
  production_filename_template: 'onepage-{product_slug}-{delivery_role}.webp',
  mapping_filename_template: 'onepage_{product_slug}-overall.png',
  role_by_slot: ONEPAGE_DELIVERY_ROLES,
  gtk_rule: 'Include gtk_01..03 only when GTK is selected; never invent GTK assets for FAQ.',
  template_alias_rule: 'occasion_story_01/02 bind occasion_01/02. occasion_story_01_mobile binds detail_main and is NOT an additional production file.',
  archive_name_note: 'The root-folder rule applies to entries INSIDE the ZIP; a download label or ZIP basename does not prove that root is correct.',
  delivery_gate: 'MUST_NOT_DELIVER_UNVALIDATED_ARCHIVE',
  host_execution_steps: ['Resolve product line display name and snake_case slug from approved task context; never infer them from temporary output paths.', 'Construct every final entry from root_folder_template and role_by_slot, not runtime slot aliases or generation filenames.', 'After writing the ZIP, reopen the actual ZIP and run the exact path-set validation plus CRC check. A planned manifest is not evidence.', 'Stop delivery on any missing, duplicate, extra or noncanonical name. Fix names only, preserving approved image bytes, then rerun the check.', 'Separately decode final images and verify required dimensions, current approved revision and slot mapping before delivery.'],
  validation: 'MANDATORY BEFORE DELIVERY: inspect actual ZIP entries: one exact root; exact role names and product slug; no duplicates, missing slots, extra files, unsafe paths or stale mapping. Decode final images to verify format/dimensions/revision separately. Gateway guidance does not inspect host archive bytes or certify execution.',
};

export function onepagePackagePaths(productLineName: string, productSlug: string, section: 'gtk' | 'faq') {
  if (!productLineName || productLineName !== productLineName.trim() || /[\\/\x00-\x1f]/.test(productLineName) || productLineName === '.' || productLineName === '..') throw new Error('Invalid product line display name');
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(productSlug)) throw new Error('Invalid lowercase snake_case product slug');
  if (section !== 'gtk' && section !== 'faq') throw new Error('Explicit GTK/FAQ selection required');
  const root = `Onepage - ${productLineName}`;
  return [...Object.entries(ONEPAGE_DELIVERY_ROLES).filter(([slot]) => section === 'gtk' || !slot.startsWith('gtk_')).map(([,role]) => `${root}/onepage-${productSlug}-${role}.webp`), `${root}/onepage_${productSlug}-overall.png`];
}

/** Validates a listing only. Caller must obtain it from the actual archive, never a planned manifest. */
export function validateOnepagePackagePaths(entries: string[], productLineName: string, productSlug: string, section: 'gtk' | 'faq') {
  const expected = onepagePackagePaths(productLineName, productSlug, section);
  const root = `Onepage - ${productLineName}`;
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry)) issues.push(`DUPLICATE:${entry}`);
    seen.add(entry);
    if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').some(p => p === '..' || p === '.') || /[\x00-\x1f]/.test(entry)) issues.push(`UNSAFE_PATH:${entry}`);
    if (entry === `${root}/`) continue;
    if (!expected.includes(entry)) issues.push(`UNEXPECTED_PATH:${entry}`);
  }
  for (const entry of expected) if (!seen.has(entry)) issues.push(`MISSING:${entry}`);
  return {status: issues.length ? 'INVALID' : 'VALID_NAMES_ONLY', issues, expected, byte_validation: 'NOT_PERFORMED'};
}
