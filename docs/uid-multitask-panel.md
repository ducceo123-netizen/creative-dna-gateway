# External Prompt Master: multi-material task briefs

Base: verified main b9ad6f396949c922d0eee04a6f5ccbb5e43f75d5 (PR88).

The Task tab now filters 22 verified routes by brand (PawfectHouse 9, GiftSoul 8, SoulPrise 5). The catalog was read using list_creative_dna_routes and resolve_creative_dna on 2026-10-15. Only route names and input/output metadata are copied into static assets. Canonical prose, feedback history, private examples and task data are excluded.

The page remains offline/copy-only: no fetch, storage, host bridge, iframe, authentication or task execution. Existing Onepage group-feedback controls and scope validation are unchanged. The Feedback tab is explicitly labeled Onepage. Other materials use feedback in chat.

Each route exposes fields from its own input schema. Creative fields such as idea/context/theme can be inferred during research and never force placeholder entry. Essential source/recipient/niche information still gates copying. URL/theme/custom text is scoped to each brand/task draft. Brand-specific output sizes are reference hints, not runtime authority. PawfectHouse LDP Hero and Seasonal Banner schemas conflict with later accepted paired-output rules. Their numeric hints are intentionally suppressed, and both UI and copied prompts require canonical reconciliation; the raw snapshot documents the stale schema instead of pretending it is current. Optional source URLs are validated when supplied; image/specification references are described in text and must be verified in the same chat. No fake preview or inferred image access is created. Quantity, ratio and dimension syntax is checked before copying. Source metadata that lacks a detailed schema remains explicitly incomplete rather than fabricated.

The chat must resolve current canonical rules, research, content approval and product-image requirements before execution. Onepage starts with content; LDP prepares structure/content/UI guidance and explicitly does not claim Figma end-to-end availability. Other material prompts request their selected material under its own gates, without importing Onepage-specific rules. No prompt grants Train or unrelated packaging authority.

Catalog refresh procedure: re-read routes and each route's input/output schema, update both the snapshot and static catalog, review for private content, run all tests and verify brand availability and dimensions. Do not add network access to fetch a live catalog without separately reviewing the security scope.

Validation: 678 Node tests, typecheck and build passed before review. Live browser checks for this new version have not yet occurred. Earlier PR88 production browser interactions passed; screenshot/mobile checks were canceled and are not proof for this follow-up.
