# PIC playbooks and multi-brand mapping

Use this mode when people responsible for creative need to understand and reproduce a brand, or when comparing a brand family and mapping a new direction. The primary deliverable is a visual, human-readable decision guide, not a component library. Retain existing technical packages as supporting evidence; do not force every PIC task through implementation/testing of a website.

## Establish the source set

Verify domains through public identity/contact links or trusted owner context; record excluded lookalikes. Compare representative home, evergreen collection, PDP, story and support at desktop/mobile. Reuse dated prior evidence where appropriate and state its age. Inspect imagery, full-page composition and copy as well as computed styles. Missing/lazy/blocked content stays unknown. Website claims are brand self-description, not verified business performance or audience research.

## Separate four decisions

- Observation: what a source actually does, with evidence, viewport and scope.
- Interpretation: what the combination suggests about character, audience or strategy; give basis and confidence.
- Candidate-common: a pattern recurring across brands, including exceptions. Similarity does not establish historical inheritance, necessity, uniqueness, quality or approval.
- Approved invariant: an owner-approved requirement with decision provenance, scope and permitted exceptions. Never promote a candidate by frequency alone. A general positive review of a prototype does not approve every rule or a canonical system merge.

Keep brand-specific expression, ecommerce mechanics, category requirements and campaign choices distinct. Shared code identifiers are supporting technical similarities, not proof of business ancestry. Preserve observed accessibility defects as evidence and propose corrections separately.

## Deliver the PIC guide

For each brand: essence and evidence, audience/context with unknown demographics, voice examples and boundaries, palette by operational roles (not invented corporate secondary colors), type roles, image/banner recipes with actual annotated source crops, responsive adaptations, UI usage only to the depth a PIC needs, do/don't pairs, production checklist and open decisions. Distinguish descriptive rules from proposed execution recommendations. Explain what to do in a real brief; adjective lists alone are insufficient.

Provide a comparison matrix including differences and counterexamples. Include a base decision register with evidence from every relevant brand, rationale, status, owner and date. Unapproved base stays candidate-common. No automatic canonical writes.

For Figma handoff: editable text blocks, frame titles/order/dimensions, semantic colors and fonts, actual image assets with provenance, captions/annotations and evidence IDs. A screenshot of a page is source evidence, not an editable brand manual. Keep private reference imagery separate from assets cleared for publishing. Record whether Figma composition was actually done; do not call a local board a Figma file.

## New-brand intake and mapping

Collect the purpose, products, audience evidence, market, strategy, demo, moodboard, inspirations, constraints and approved base register. Every input gets a source/type, rights status and owner-provided versus inferred label. A moodboard shows desired expression, not proven customer behavior or permission to copy.

Map each candidate into: retain approved base; adapt parameter; replace brand expression; category-specific; campaign-only; reject/conflict; unresolved. Explain why, cite the input and base decision, show expected output and verification method. If no approved base exists, output a proposed mapping with the base decisions still pending. Do not synthesize an apparently approved identity from absent strategy.

Deliver a coherent draft BI/voice/art-direction/UI-use playbook, contrasting examples and an open-decision list. Test the proposed mapping on at least two different communication purposes relevant to the brief (e.g. banner and PDP), not just a recolored homepage. Review brand fit separately from technical quality. Label hypothetical demonstration briefs clearly; do not assign invented strategy to a real brand.

## Validation contract

Use pic-playbook.schema.json for the handoff and validate-pic.cjs for references and decision gates. Assertions need evidence; inferences/proposals need rationale; unknowns carry null. Approved invariants need a recorded owner decision. Each frame must point to actual content and available assets. Structural validation cannot approve strategy or visual fidelity.

Use `new-brand-mapping.schema.json` for structured intake and decisions. Check all inputIds resolve; retain-approved-base must resolve an approvedBase ID backed by a scoped decision. Retrospective comparison and hypothetical demonstrations must never be labeled new-brand executions. Unknown strategy/target stays unknown rather than silently filled from a moodboard.
