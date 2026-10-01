# POD Product Clone Skill V1

## Purpose

POD Product Clone is a sibling system to Creative DNA for discovering and developing differentiated POD product variants from proven market demand.

It reuses Creative DNA's gateway/auth/MCP/admin infrastructure patterns, but MUST use a completely separate knowledge namespace and datastore. No Creative DNA canonical rule, proposal, memory node, feedback item, or resolver result may be implicitly read into POD Product Clone.

## Primary user flow

The user may provide any combination of:

- Competitor product URL
- Competitor product screenshots / PDP images
- Print file / artwork file
- Ad video
- Ad creative
- Ad copy / hook / angle
- Notes about performance or demand

The skill then performs:

1. Competitor Truth Extraction
2. Demand Mechanism Analysis
3. Differentiation Strategy
4. Product Variant Directions
5. Asset Layer Blueprint
6. Personalization / Variant Architecture
7. Thumbnail & PDP Image Plan
8. Ad-Angle Bridge
9. Review / Feedback
10. Optional packaging into POD Clone memory only after the user explicitly asks to save/train/package

## Core principle

Clone the proven DEMAND MECHANISM, not the competitor's exact creative execution.

The skill should preserve what appears to create purchase intent while changing enough of the product, story, visual language, personalization mechanic, recipient, use case, or ad entry point to create a commercially distinct offer.

### Copy boundary

Do not reproduce a competitor's copyrighted artwork, proprietary copy, character, exact composition, or near-identical design.

Allowed analysis targets include:

- recipient
- occasion
- emotional trigger
- gifting moment
- personalization mechanism
- product form factor
- visual hierarchy
- layout logic
- ad hook structure
- proof mechanism
- thumbnail sequencing
- purchase objections
- offer framing

## Store target

Primary destination store:
https://af1xsf-ny.myshopify.com/

Current store direction observed in October 2026:
- Personalized pet & family gifts
- Product pages commonly use 6-8 gallery images
- Strong reliance on product visualization and "See it in action"
- Personalization/edit-design flow
- Delivery estimate block before deeper product storytelling

The skill should learn store-specific thumbnail language separately from competitor truth.

## Output contract

For each analyzed product, return this structure.

### A. Source Truth

- competitor_url
- product_type
- niche
- recipient
- occasion
- core promise
- personalization type
- physical product constraints
- visible design structure
- thumbnail sequence
- ad hooks / angles
- inferred purchase triggers
- evidence confidence

### B. Opportunity Map

Identify reusable commercial mechanisms:

- demand anchor
- emotional trigger
- recipient tension
- occasion timing
- personalization delight
- social-share value
- utility vs novelty
- giftability
- ad-scroll stopper
- proof / demonstration mechanism

Separate:
- KEEP: mechanism worth preserving
- CHANGE: area too close to competitor
- EXPLORE: whitespace for differentiation

### C. Three Variant Directions

Always generate 3 directions before committing to production unless the user explicitly asks for one.

Each direction includes:
- concept name
- what remains from proven demand
- what materially changes
- target recipient
- personalization mechanic
- visual direction
- product-format change if any
- ad-entry angle
- why it is commercially distinct
- execution difficulty
- required assets

Do not score or rank unless the user asks for business prioritization. If prioritization is requested, base it on explicit commercial criteria such as production complexity, differentiation, estimated creative breadth, and fit with current store.

### D. Asset Layer Blueprint

Decompose the chosen design into production-ready layers.

Possible layers:
- base background
- texture / pattern
- decorative objects
- headline / phrase
- name / date / relationship text
- upload photo mask
- portrait/photo treatment
- clipart body / avatar
- pet / people slots
- frame / border
- badges
- iconography
- shadows / highlights
- foreground overlay
- SKU-specific safe area
- print bleed / trim
- color variants
- recipient variants
- occasion variants

For every layer define:
- layer_name
- role
- editable/fixed
- source needed
- masking rules
- placement logic
- min/max slots
- dependency on personalization
- variant behavior
- print safety note

### E. Variant Matrix

Map scalable variants, for example:
- 1 / 2 / 3 / 4 people
- 1 / 2 / 3 pets
- Mom / Dad / Couple / Bestie / Family
- Christmas / Halloween / Anniversary / Memorial
- light / dark background
- different text grammar
- different upload-photo shapes
- different product colors

The objective is to make the winning concept extensible without bloating the initial launch.

### F. Thumbnail / PDP Image System

Reapply the product into Give Mories' own storefront language rather than copying the competitor's thumbnails.

Default image plan should cover:
1. Hero thumbnail
2. Personalization reveal
3. Real-life use / story
4. Design/detail close-up
5. Variant or recipient breadth
6. Scale / product truth
7. Gift moment / emotional payoff
8. Optional UGC / social proof / ad-like frame

For each image provide:
- objective
- scene
- camera angle
- product prominence
- text overlay need
- personalization shown
- proof function
- asset dependencies

### G. Ad-Angle Bridge

Translate the product into distinct acquisition angles.

For each angle:
- hook
- target audience
- first 2 seconds visual
- product reveal
- personalization reveal
- emotional payoff
- CTA concept
- how it differs from competitor's active angle

## Memory architecture

POD Product Clone memory MUST be isolated from Creative DNA.

Recommended namespace:
- system: pod_clone
- brand/store: givemories
- branches:
  - product_opportunities
  - competitor_cases
  - demand_mechanisms
  - design_layer_patterns
  - personalization_patterns
  - thumbnail_patterns
  - ad_angle_patterns
  - production_constraints
  - approved_variants
  - rejected_variants
  - learnings

Never resolve Creative DNA data as a hidden fallback.

Cross-system sharing is explicit only:
- Creative DNA may be queried for a brand/style rule only when the user explicitly asks to use that style.
- POD Clone may store a reference pointer to a Creative DNA route, but never copy canonical Creative DNA nodes into POD Clone memory.

## Training / learning flow

Default behavior:
- Analyze and generate first.
- Wait for user review/feedback.
- Do not automatically package a case into reusable memory.
- When the user explicitly says save/train/package/learn this case, create a POD Clone proposal.
- Admin review may accept/reject.
- Accepted proposal still requires explicit merge into canonical POD Clone memory.

Suggested statuses:
- draft
- pending
- accepted
- rejected
- merged

## Proposed datastore separation

Use separate tables or separate Supabase schema. Preferred hard isolation:

- pod_clone_cases
- pod_clone_sources
- pod_clone_assets
- pod_clone_knowledge_nodes
- pod_clone_proposals
- pod_clone_training_events
- pod_clone_case_versions

No FK should point to Creative DNA knowledge tables except an optional neutral external_reference string.

## Proposed MCP tools

Phase 1:
- resolve_pod_clone_system
- compile_pod_clone_job
- submit_pod_clone_feedback
- list_pod_clone_routes

Phase 2:
- get_pod_clone_case
- list_pod_clone_cases
- search_pod_clone_memory
- package_pod_clone_case

## compile_pod_clone_job input concept

- competitor_url
- store_url
- product_type
- niche
- supplied_assets[]
- ad_angles[]
- user_goal
- output_scope

The compiler returns a compact execution contract rather than dumping the full memory graph.

## Hard gates

1. Source truth before ideation.
2. Product fidelity before thumbnail generation.
3. Distinguish competitor facts from inference.
4. Do not copy competitor artwork or exact ad creative.
5. Generate materially different commercial directions.
6. Asset blueprint must be production-oriented, not only visual description.
7. Give Mories thumbnail language is the destination system.
8. User review comes before memory packaging.
9. POD Clone memory never silently reads Creative DNA memory.
10. Every reusable learning records its source case and evidence.

## V1 invocation language

Preferred natural command:

POD Clone — Analyze

Product: <competitor URL>
Print file: <attachment>
Ads: <video / images / notes>
Goal: Create differentiated variant for Give Mories

Optional:

POD Clone — Package Case
Case: <current case>
Feedback: <approved/rejected notes>

## V1 success definition

A successful clone case should leave the team with:
- a clearly differentiated product concept
- a layer-by-layer production asset plan
- scalable personalization/variant logic
- a PDP thumbnail plan aligned with Give Mories
- acquisition angles that do not simply mirror the competitor
- traceable source evidence
- reusable learning only after explicit approval
