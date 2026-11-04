# Sources and adaptations

Local workflow version 1.1.0, authored 2026-10-29. No upstream runtime is executed.
- adobe/skills @ `84e248b6609fae2eb8a241b4444fc4d945fe9d76` — https://github.com/adobe/skills/tree/84e248b6609fae2eb8a241b4444fc4d945fe9d76. Apache-2.0; see skills-LICENSE.
- nexu-io/open-design @ `6ab98c4b13832d1d2dbbb3ea186bd92b63c49429` — https://github.com/nexu-io/open-design/tree/6ab98c4b13832d1d2dbbb3ea186bd92b63c49429. Apache-2.0; see open-design-LICENSE.
- pbakaus/impeccable @ `5e745ace7e151feb2a93d360d0281fe39448b857` — https://github.com/pbakaus/impeccable/tree/5e745ace7e151feb2a93d360d0281fe39448b857. Apache-2.0; see impeccable-LICENSE.

Adobe Stardust extract informs multi-page capture, raw provenance and visual verification. Its source is retained in the task vendor/stardust-extract; it is not installed as a standalone functional migration stack.
OpenDesign brand-extract informs the brand-kit sections; od CLI, finalizer, daemon, derived light/dark themes and asset generation are not installed. Its original skill is retained in task source-review.
Impeccable 4.8.0 selected reference playbooks are copied verbatim as passive references; the adapter supersedes their upstream engine/hook assumptions. No automatic binary downloads, telemetry, hooks or upstream subagent configuration is installed.
Our capture and validation scripts are newly authored; not copies of upstream executables. Source methods are adapted to separate observation from inference/proposal and isolate campaign/ecommerce/category rules.

Version 1.1.0 adds an independent visual brand-acceptance gate after owner feedback, two-archetype comparisons, contextual art direction and semantic/component token validation. These changes are locally authored; upstream pins are unchanged.
