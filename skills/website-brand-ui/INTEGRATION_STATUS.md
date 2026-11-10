# Website Brand UI — UID Brands integration

Status: source introduction only; NOT yet wired into runtime, NOT validated, NOT deployed.

The original uploaded `website-brand-ui.zip` contains 27 files. This branch currently stages the original entrypoint `SKILL.md`; the remaining 26 source files must be copied verbatim before this PR can be merged. Do not treat this as an executable deployment.

Expected location: `skills/website-brand-ui/`.

Runtime: Node, installed Chrome, Playwright 1.56.1 and Ajv 8.20.0, explicitly installed in an isolated execution environment. Do not automatically install browsers, change canonical Supabase Creative DNA, or activate any production MCP route. Keep Onepage/LDP behavior unchanged.

Acceptance checklist:
- [ ] Import all 27 original source files and license/NOTICE files verbatim
- [ ] Run bundled validator/test scripts with Ajv available
- [ ] Test Playwright capture only in isolated explicitly provisioned runtime
- [ ] Add optional, explicitly gated invocation adapter after reviewing router
- [ ] Confirm existing routes, Onepage and LDP regression tests
- [ ] Review PR prior to merge and production deploy

Source provenance: user uploaded the ZIP on 2026-11-10.