# Onepage packaging naming

The compact packet previously exposed runtime slot names but omitted their canonical delivery-name projection. Host-generated packages reused runtime names such as `banner-desktop`, `detail-main`, `wyl-01` and `occasion-icon-01`. These are not canonical filenames.

The shared technical projection now provides exact root-folder, slug, production-role and PNG mapping conventions. It is available only for the supported active delivery rules; incompatible current rules mark packaging blocked. It does not grant packaging approval, create a ZIP, inspect host files, or certify image quality. Existing originals are never automatically renamed.

Read-only archive check:

```
node --import tsx scripts/audit-onepage-package.ts archive.zip 'Poseable Plush Doll' poseable_plush_doll gtk
```

This reads the actual ZIP central directory, tests CRC, and checks names, exact root, missing/extra/duplicate entries and unsafe paths. A passing result is `VALID_NAMES_ONLY`; decoded media format, dimensions, correct slot allocation, approved revision and visual quality still require separate checks. A ZIP basename may differ from the internal root and cannot establish a folder violation.

Source: canonical `onepage-system` role mapping, package-root rule and WebP-only final production rule; current `delivery.mapping-png.v1` requires the distinct `onepage_{product_slug}-overall.png` mapping name. FAQ mode omits GTK; it does not invent a verified FAQ template. Intentional technical projection version: `uid-onepage-packaging/1`.

Gateway execution guidance requires refreshing the current compiled packet at packaging time, using its ready contract, and validating the actual archive before delivery. This is a host instruction, not server-controlled execution. Activation requires deployment of Supabase `creative-dna-compile-onepage` for the packet plus the gateway for refreshed host guidance; publishing repository code alone is insufficient.
