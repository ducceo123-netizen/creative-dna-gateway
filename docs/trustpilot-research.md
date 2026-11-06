# Onepage Trustpilot research gate

For every new **PawfectHouse** or **GiftSoul** Onepage run, the host agent attempts
product-relevant Trustpilot research before buyer insights, customer-value selection
and content planning. This is part of the execution packet, not a queued rule proposal.

The fixed current-brand sources are:

- PawfectHouse: https://www.trustpilot.com/review/pawfecthouse.com
- GiftSoul: https://www.trustpilot.com/review/giftsoul.co

Other brands and non-Onepage routes do not acquire this requirement. Canonical creative
rules are unchanged. The gateway overlay applies the gate even when upstream Edge
functions still return older packets. The shared module also supports direct Edge
compilation when those functions are deployed separately.

## What runs where

The host uses its permitted search/read/browser tools to search selected product names,
SKUs/variants, categories, occasions and personalization terms, then opens and reads
actual reviews in context. Search snippets or a pasted profile URL are not inspection.
The gateway **does not crawl Trustpilot** and does not certify that a page was read.
It checks the structure and consistency of the submitted host report only.

Submit `research.trustpilot_research` through the existing `compile_onepage_job` or
Onepage resolver. `trustpilot_contract.input_shape` in the response is the schema guide.
Record actual queries, tool, dates, selection/exclusions, filters, sort, access limits,
and direct review URLs. Every selected product must be covered by an attempt. Record
one observation per unique inspected review; do not inflate counts from profile totals.
This bounded ledger supports up to 30 attempts, 100 reviews and 30 insights, not an
unbounded all-reviews crawl. It has no positive-review quota.

## Scope and evidence

Product-scoped anecdotes require exact product/variant IDs, matching version strings
and a concrete match basis. If a review only establishes store, service or shipping
experience, label it `store`, with no product IDs or versions. A store review may suggest
a general buyer concern but cannot support a product-specific experience or specification.
Collection insights may not extrapolate one SKU's experience to another selected SKU.

Keep positive and negative experiences and counterevidence visible. Insights are
qualified buyer questions or content hypotheses. Answer using current matching product
facts. Reviews do not prove specifications, representative demand, promised delivery,
failure rates or permission to invent testimonials/UGC. No customer profiling, posting,
scraper, background collection or access bypass is introduced.

## Outcomes

- Missing report: `AWAITING_RESEARCH`; insight/content readiness requires the attempt.
- Malformed scope, wrong profile, duplicate review, unsupported SKU linkage, snippet-only
  inspection, missing source details or inconsistent counts: `NEEDS_EVIDENCE` and gated.
- Valid report with usable insights: `STRUCTURALLY_COMPLETE`, still requires host evidence review.
- Honest `blocked`, `no_product_matches` or `partial` attempt, or no usable insight:
  `ATTEMPTED_WITH_LIMITATIONS`. Show actual limits and continue with verified independent
  facts, without inventing review-derived claims. Store-only observations can coexist with
  `no_product_matches`; product observations cannot.

The compiler inserts `RESEARCH_TRUSTPILOT_PRODUCT_AND_STORE_REVIEWS` before the earliest
insight/content stage and reattachment does not duplicate it. Product research, canonical
quality blocks, content approval, product-pixel inspection and human review remain
independent. Structural acceptance does not prove semantic truth or freshness for a new run.

## Verification

`tests/trustpilot-research.test.ts` covers both profiles, scope and variant drift,
store-to-product promotion, source URLs, counts, duplicate records, dates, malformed
reports, limited outcomes, collection coverage and HTTP/MCP/legacy-upstream routes.
Content-plan regression tests show that otherwise valid product research cannot skip
the attempt. All review fixtures are synthetic offline data, never production findings.
