# Test UID Brands → Clipo Reference Discovery (Onepage)

## Production state
- Upstream `creative-dna-compile-onepage` Edge Function deployed as v16.
- The compiled Onepage packet includes `CLIPO_REFERENCE_DISCOVERY` before
  `SELECT_INCREMENTAL_CUSTOMER_VALUE` and before materials generation.
- A public Clipo MCP search + image-open happens during compile.
- Gateway code additionally supports a real UID member bearer, which upgrades
  the search/open to `/member/mcp`. The gateway release must be deployed before
  team mode can be confirmed through ChatGPT.

## Manual ChatGPT test

Using UID Brands, call `compile_onepage_job` with:
- brand: `PawfectHouse`
- source_url: a real PawfectHouse product URL
- source_type: `product`

Validate response:
1. `execution` includes `CLIPO_REFERENCE_DISCOVERY` exactly once, after
   `VALIDATE_RESEARCH_BEFORE_CONTENT` and before creative materials.
2. `clipo_reference_discovery.attempted === true`.
3. Inspect `status` (`references_opened`, `matches_unopened`, `no_match`,
   `unavailable` or `authorization_required`) and `access`.
4. If `references_opened`, verify `opened[].pack`, `opened[].ref_id`,
   source URL and MIME are genuine. This confirms an MCP image payload was
   received. It does **not** claim the AI visually inspected the pixels.
5. The AI must actually inspect any selected reference image before deriving
   artistic direction; never copy designs or infer EO approval from storefront.
6. No Clipo match or network failure must not block unrelated Onepage work.

## Team-only verification (after gateway deployment)

A real signed-in, active UID Brands member should receive
`clipo_reference_discovery.access === "team"`, team packs and successfully
opened team image metadata. The gateway must forward the bearer only to the
authenticated Clipo member MCP. Confirm with a non-member session that team
references are unavailable and never returned through public fallback.

**Do not treat a public-only search as full team-mode verification.**

## Evidence checked

On 2026-11-25, the production UID Brands tool returned:
- `CLIPO_REFERENCE_DISCOVERY` at execution index 12
- `status: "references_opened"`
- `access: "public"`
- `ref_id: "glass-light"`
- `pack: "pawfecthouse--onepage--banner-mobile--glass-light-4be6412bea5b--v000001"`

This is a real public-branch integration check. Gateway team-branch deployment
and member-authenticated end-to-end testing remain separate release gates.
