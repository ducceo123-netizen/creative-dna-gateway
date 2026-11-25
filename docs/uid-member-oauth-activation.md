# UID Brands member OAuth — production activation / evidence

## Live code already deployed
- Public MCP unchanged: `https://uid-brands-gateway-preview.onrender.com/api/mcp`
- Protected member MCP: `https://uid-brands-gateway-preview.onrender.com/api/mcp-member`
- RFC 9728 resource metadata:
  `https://uid-brands-gateway-preview.onrender.com/.well-known/oauth-protected-resource/api/mcp-member`
- OAuth consent UI: `https://uid-brands-gateway-preview.onrender.com/oauth/consent`
- Status diagnostic: `https://uid-brands-gateway-preview.onrender.com/api/member-oauth-status`
- Production issuer: `https://wuonwttmkadwsmefjukv.supabase.co/auth/v1`

The member route validates a bearer by calling Clipo's authenticated member MCP
`ping`, which verifies Supabase Auth identity and `creative_dna_team_members.is_active`.
A missing/invalid token is rejected and never falls back to the public catalog.

## External activation REQUIRED
The Render production log reported:
`issuer_status=not_configured; reason=issuer_discovery_not_enabled`.

The Supabase Auth project currently has 0 registered `auth.oauth_clients`.
The connected Supabase administration interface available in this session has
no OAuth Server configuration action. Do not edit internal `auth` tables
to bypass the management UI.

In Supabase Dashboard for project `wuonwttmkadwsmefjukv`:

1. Go to **Authentication → OAuth Server** and enable the OAuth 2.1 server.
2. Set the authorization path to `/oauth/consent`.
3. In **Authentication → URL Configuration** set the Site URL to
   `https://uid-brands-gateway-preview.onrender.com`.
   Preserve other legitimate redirect allowlist entries; allow
   `https://uid-brands-gateway-preview.onrender.com/oauth/consent`
   for passwordless email return.
4. Configure a trusted ChatGPT public OAuth client (PKCE S256 with
   `token_endpoint_auth_method=none`) using the precise redirect URI
   shown by ChatGPT app management. Alternatively enable Dynamic Client
   Registration with *mandatory explicit user consent* and monitor new clients.
   Do not wildcard ChatGPT redirect URIs.
5. Verify `https://wuonwttmkadwsmefjukv.supabase.co/.well-known/oauth-authorization-server/auth/v1`
   returns metadata describing the issuer, authorization endpoint, token endpoint,
   and S256 PKCE.
6. Inspect the OAuth access token audience. Supabase OAuth tokens may default
   to `aud=authenticated`, while resource-bound MCP clients expect the
   protected resource URL as audience. If necessary use the official Supabase
   Custom Access Token Hook scoped to the specific UID Brands OAuth client,
   setting `aud=https://uid-brands-gateway-preview.onrender.com/api/mcp-member`.
   Do not silently change the audience for ordinary Supabase sessions or other
   clients; test `/auth/v1/user` and Clipo member admission afterwards.
7. Update or reconnect the ChatGPT UID Brands MCP app to use
   `https://uid-brands-gateway-preview.onrender.com/api/mcp-member`
   and OAuth authentication. Connecting/reconnecting requires the user's
   explicit action in ChatGPT. Keep existing public `/api/mcp` until migration is verified.

## E2E release gate
- Anonymous POST to member MCP: HTTP 401 + OAuth challenge.
- Authenticated non-member: HTTP 403.
- Authenticated active member with consented OAuth access token:
  `compile_onepage_job` returns `access:team`.
- The trace contains successful `search_reference_packs` and
  `open_reference_image` for at least one **team** pack newly synced.
- Re-check a public-only request still uses public refs and Onepage
  still has exactly one `CLIPO_REFERENCE_DISCOVERY` stage.
- Until these checks pass, report **PARTIAL — issuer disabled**, not DONE.

Do not expose member JWTs, OAuth client secrets, SQL service-role keys or
team image bytes in build logs, documentation or chat.
