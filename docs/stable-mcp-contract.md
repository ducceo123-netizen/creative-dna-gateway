# Creative DNA stable MCP contract

## Promise
The canonical DNA database, brand rules, Onepage compiler, feedback approval pipeline and asset outcomes remain owned by their existing upstream services. The ChatGPT MCP gateway must not rewrite these behaviors for launcher upgrades.

## Public tool contracts
Retain names, input schemas, and meaning for `resolve_creative_dna`, `compile_onepage_job`, `submit_training_feedback`, `list_creative_dna_routes`, and `launch_creative_dna`. Deploy changes to content, wisdom, theme presets, branch lists, task form markup and server implementation behind those stable interfaces.

## What auto-updates
- Canonical rule changes apply on subsequent reads.
- The launcher gets current brand/branch data on each fresh invocation via `listCreativeDnaRoutes`.
- A new session invokes the currently deployed widget resource.

## Platform limitation
Existing ChatGPT installations may cache the original tool catalog and resource metadata. No backend code can force an existing ChatGPT member installation to rediscover an entirely new tool or a breaking schema revision. An initial re-connection might be necessary to acquire `launch_creative_dna`. Version or change public tools only when unavoidable.

## Regression checks
Run `npm run lint`, `npm run build`, and `node --import tsx --test tests/mcp-contract.test.ts` before publishing. In ChatGPT, verify form render, follow-up generation, complete-brief direct execution, feedback submission, and representative Onepage output. These checks guard contracts but are not a substitute for comparing creative outputs.
