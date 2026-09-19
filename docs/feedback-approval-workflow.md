# Creative DNA Feedback Approval Workflow

## Goal

Allow team contributors to submit `Creative DNA — Train` feedback without modifying canonical Creative DNA. Every contributor submission enters a pending review queue. Only an admin can accept or reject it.

## Canonical flow

```
Contributor Train
  -> training_events(status = needs_review)
  -> knowledge_proposals(status = pending)
  -> Admin Review
       -> reject: canonical DNA unchanged
       -> accept: proposal becomes accepted
  -> explicit admin merge/consolidation
  -> knowledge_nodes updated/versioned
```

Acceptance is intentionally separated from merge. This prevents an accidental button click from silently changing canonical production rules.

## Roles

- viewer: resolve/use only
- contributor: resolve/use + submit train/seed evidence
- admin: contributor capabilities + consolidate + review proposals

Contributors never write `knowledge_nodes` directly.

## Database

`knowledge_proposals` is the review queue. Added fields:

- brand_id
- submitted_by
- submitted_by_name
- raw_feedback
- proposed_scope
- reviewed_by
- review_note
- merged_at
- updated_at

Statuses: `pending`, `accepted`, `rejected`, `merged`.

## Authenticated admin API

Supabase Edge Function `creative-dna` v3 remains JWT-protected.

Contributor submission:

```json
{
  "mode": "train",
  "brand_slug": "soulprise",
  "target_slug": "onepage-system",
  "input": "Seasonal story images should feel more candid and UGC-like."
}
```

Admin decision:

```json
{
  "mode": "review",
  "proposal_id": "<uuid>",
  "decision": "accept",
  "review_note": "Approved for Onepage shared-system consolidation."
}
```

An accepted proposal does **not** mutate `knowledge_nodes`. It becomes eligible for an explicit admin consolidation/merge step.

## Admin UI contract

Target route: `/admin/feedback`

Queue card should display:
- brand / branch
- submitter
- raw feedback
- proposed scope
- created time
- status

Actions:
- Accept
- Reject
- optional review note

The Admin UI must authenticate the admin and call the JWT-protected `creative-dna` function. Do not expose service-role credentials in the browser.

## Cross-brand Onepage

For shared Onepage structural feedback, admin consolidation is responsible for applying the accepted rule to the shared Onepage contract / synchronized brand branches. Brand-style feedback remains brand-specific.

## Safety invariant

Pending, accepted, or rejected proposals must never change resolver output by themselves. Resolver output changes only after an explicit canonical merge/version operation.
