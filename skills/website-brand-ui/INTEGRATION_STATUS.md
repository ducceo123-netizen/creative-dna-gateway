# Website Brand UI — UID Brands integration

Source: user-supplied `website-brand-ui.zip`, received 2026-11-10.

## Implemented in branch
- 27 original skill files copied to `skills/website-brand-ui/`: entrypoint, references, schemas, attribution/licenses, Node scripts and validators.
- `uid-website-brand-ui.ts` exposes a strictly allowlisted, read-only reference loader.
- `get_website_brand_ui_skill` is registered in public UID Brands MCP discovery and callable from accounts that connect to the same MCP service. Its response is guidance/evidence methodology; no remote website has been visited by the tool.
- `GET /api/website-brand-ui?section=...` provides read-only skill text for the web.
- UID Brands homepage has a URL intake and copyable ChatGPT research brief. This UI is not a capture executor.
- New tests cover source availability, allowlist safety and tool metadata.

## Runtime boundaries
The shared MCP tool does NOT run Chromium, Playwright capture, arbitrary Node scripts, website downloads or validators on behalf of remote users. The user-facing ChatGPT agent may use supported browser/research tools to follow instructions; automated capture and artifact generation require a separately provisioned, isolated runner and an explicit future feature. Do not claim capture was performed by this MCP tool.

No changes to canonical Supabase Creative DNA, design approval, existing Onepage/LDP route semantics, payment, publishing or provider access. Multi-account support means users who can connect to the UID Brands app/MCP endpoint can discover and invoke this tool. It does NOT auto-install the app into other accounts.

## Release acceptance
- [x] Stage 27 original skill files and attribution
- [x] Shared read-only MCP tool and browser UI entry
- [x] File access/path traversal tests
- [ ] Full Gateway UI Validation CI green
- [ ] Merge to main and verify Render deployment/health
- [ ] Confirm real MCP discovery on production URL
- [ ] Smoke-test from another independently connected account
- [ ] Optional separate sandboxed capture service (not part of this release)
