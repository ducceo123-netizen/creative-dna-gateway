# Scale Brands validation — 2026-11-04

- `npm run lint`: passed.
- `npm run build`: passed (Vite client and bundled Node server).
- `env TMPDIR=/private/tmp npm test`: 1,137 passed, 0 failed, 0 skipped. The canonical temporary path is needed on macOS because the pre-existing package/review symlink guards reject `/var` or `/tmp` aliases; no guard was weakened.
- Real local HTTP/MCP transport: tool discovery, source-reference retrieval, initialization for all three brands, incomplete job submission, store mismatch and invalid input tested. Deterministic transport tests explicitly mock the canonical upstream.
- Live smoke through local MCP and the real read-only canonical upstream: PawfectHouse, GiftSoul and SoulPrise each returned `AWAITING_BASELINES` with all five regions and website-brand-ui@1.3.0.
- Current route enumeration lists material routes rather than Brand DNA root nodes. The implementation discovers the brand from that list and verifies the explicit `brand-dna` resolver result, independently of LDP.
- GiftSoul `https://giftsoul.co` and SoulPrise `https://soulprise.co` matched canonical source metadata. PawfectHouse metadata does not carry a source URL, so store identity is honestly `UNVERIFIED` until the host supplies evidence; no root URL was fabricated in canonical data.
- Source manifest and runtime reference tests verify the 28 vendored skill files against the installed Mac source hashes and compare bundled reference text byte-for-byte.

Limits: no real store theme was edited; no Teeinblue, tracking-provider, Judge.me or cart interaction was executed. No storefront visual/functional QA is claimed. The host must inspect actual baseline/draft artifacts for a future Scale Brands task. The installed ChatGPT plugin has not been switched to this branch. Merge, deployment and installed-host acceptance remain release work; this change is prepared as a draft PR.
