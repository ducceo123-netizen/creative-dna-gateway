# Concrete Onepage image assets adapter

`createWorkspaceOnepageImageAssets` in `uid-workspace-image-assets.ts` supplies the
existing Onepage `generateAssets(context,input)` hook. It is server-only and does
not install credentials, change live config, grant budgets or claim visual QC.

## Wiring

Required server capabilities:

- The same `operations` journal and `writeRunArtifact` from workspace runtime.
- The same private object store, never public URLs or mutable host paths.
- Concrete research adapter `reopenResearchEvidence` (exact pinned packet digest).
- Concrete budgeted Images `submit(childContext, request)` from provider runtime.
- An explicit per-call micro-USD cap and current provider authority.
- Reviewed sizing strategies pinned to canonical quality contract and slot, where
  canonical/provider dimensions differ. Current project capability must support
  each exact requested size. No cap or strategy creates a hard billing bound.

The factory returns `{ generateAssets }`. No additional model author/planner is
required. Slot briefs deterministically carry pinned rules/supplements/hard gates,
approved copy, supported research claims and source identities. Oversized policy
prompts block the batch before spending instead of silently dropping rules.

## Source and revision integrity

All requested slots must exactly equal the selected GTK/FAQ inventory, or the
selected original feedback slots. The approved content digest/revision is checked.
The adapter reopens private acquisition bindings and decodes actual verified PDP
images. Product Details and banners use the verified anchor. Other initial slots
rotate across the verified pool. This is an allocation plan, not evidence that the
result preserves merchandise truth; independent pixel review remains mandatory.

Every request is an **edit with actual source bytes**, not an ungrounded text-only
product generation. Initial mobile banner also receives the generated desktop
bytes for responsive creative continuity. Each feedback request prepends the exact
selected original artifact bytes, keeps exact user group boundaries/instructions,
and includes the selected brief/group/global references. Missing, corrupt,
cross-owner, cross-task or oversized evidence blocks; it is never replaced with
prose claiming the model saw it. Product source photos do not lock people/pet casting.

## Canonical sizes

Preflight resolves **all** sizes before the first paid slot. A supported exact size
is used directly. For canonical dimensions not accepted by Images API (for example
950×950, 732×480 or 720×700), a reviewed strategy must specify a larger supported
size with exactly the same aspect ratio. Only downsampling with lossless WebP
re-encoding is supported. No stretching, padding, cropping, aspect approximations
or upscaling. Such a strategy does not itself establish artistic quality.

Icons whose canonical size is `3x_UI_DISPLAY_SIZE` additionally require actual
reviewed display width/height and evidence for the pinned template; the adapter
checks the resulting ×3 dimensions. It does not guess icon size. The repository
contains no installed production sizing strategy, so unresolved plans stay blocked.

## Paid operation and custody

Each slot has its own durable child operation and exact input SHA. Budget dispatch
is delegated only to the concrete image transport. A completed response is usable
only with settled accounting and no reconciliation requirement. Raw paid WebP is
retained privately before any fitting step, then the verified canonical WebP and a
small immutable operation receipt are retained. The receipt binds source hashes,
slot, content revision, requested sizing, provider IDs and budget receipt.

Unknown or unsettled image accounting stops the batch; no retry is created. A later
technical failure leaves billed raw bytes retained and the child unresolved for
reconciliation. No asset is returned as an approved artifact. The existing Onepage
stage still performs canonical technical checks, independent source/product/artistic
review, rendered desktop/mobile QC and authenticated final artwork approval.

## Local fixtures

`node --import tsx --test tests/uid-workspace-image-assets.test.ts`

Synthetic fixtures use real sharp raster bytes and the actual child-operation
journal. Covered: full 15-slot FAQ inventory; distinct child IDs; mobile receives
desktop pixels; original-first feedback edits; all-slot preflight; approved content;
source hash/scope; exact slot/revision preservation; no-crop downscale; unresolved
icon evidence; missing product pixels; cancellation; held-accounting stop; raw
output retention on conversion failure and durable no-retry behavior.

These are transport/orchestration checks, not a live paid run or EO proof. Operator
configuration, independent hard-cost evidence and real project access remain gates.
