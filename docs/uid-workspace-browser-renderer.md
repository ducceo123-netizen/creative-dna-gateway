# Canonical browser capture adapter

`createWorkspaceBrowserRenderer` implements the Onepage `renderMapping` port. It reconstructs the exact fixed template from current copy and manifest asset hashes. It ignores supplied preview scripts and arbitrary markup, verifies original binding/render identity, embeds only matching private raster bytes, and injects a deny-all CSP except embedded raster/font data and canonical inline CSS.

A reviewed server composition must supply a real Playwright-compatible Chromium launcher. The adapter requests `headless: true`, `chromiumSandbox: true`, and no launch arguments. It does not discover/download a browser, reuse a user's session, bypass certificate warnings, weaken the sandbox, install a runtime, or obtain credentials. Deploy in a separate resource-limited renderer worker with an approved sandbox-enabled Chromium. An injected function is not proof that those operating-system controls exist.

Each invocation creates isolated contexts for desktop 1440, mobile 390 and the 798/799 breakpoints. JavaScript, service workers, downloads, permissions and CSP bypass are disabled. All external network requests are aborted and cause capture failure. The actual image decode and fonts readiness are awaited, global overflow and pixel/dimension limits are checked, actual full-page PNG bytes are independently decoded, and exact bytes/metadata are persisted through fenced run-artifact intents. A bounded deadline closes browser contexts; cancellation prevents later artifact writes.

The evidence receipt binds owner, task, snapshot, canonical/template/render/index hashes, exact HTML checksum, viewport dimensions, observed font-family names and all stored PNG checksums. A reference `render:<sha256>:<byte_length>` locates the immutable JSON object in the current owner's task namespace. Independent QC must reopen this receipt and the captures, not accept the reference itself as proof. The receipt explicitly sets semantic QC and EO parity false. Font readiness does not prove a particular font face is installed; actual typography/pixels still need independent review.

## Composition

Supply the real reviewed launcher and durable runtime services, then bind `renderer.renderMapping` only when `renderer.readiness().ready` is true. Otherwise keep the port absent so the pipeline advertises the missing browser prerequisite. The launcher must forward the requested sandbox options to official Playwright Chromium without insecure overrides.

## What has and has not run

Tests use explicit fake browser lifecycle/layout methods and actual PNG encoding/decoding and byte hashing. They verify the requested browser controls, four viewport identities, evidence storage, tamper checks, overflow/network/dimension rejection, deadline and cancellation. This is **not a browser pixel test**, semantic review, installed Chromium verification or production acceptance. The local browser route remained unavailable; no security setting was bypassed to obtain a screenshot.
