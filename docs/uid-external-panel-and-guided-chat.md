# External Onepage selector and guided chat

## Behavior

- The gateway returns a plain, user-opened link to `/onepage-panel.html` on the existing gateway host. It does not attach an output template or auto-open a widget.
- The public page contains only the 18 canonical production slots from `ONEPAGE_DELIVERY_ROLES`. Template aliases are not additional generated assets; optional GTK slots must exist in the current task before use.
- Select several slots, write one instruction, save that group, then add another. Saved groups cannot silently overlap. Overall feedback remains a separate scope.
- Every page action stays local to the tab and ultimately copies text. There is no API call, host bridge, login, task registry, persistence, image fetching, queue or Train submission. Clipboard denial leaves a manual text-selection path. Closing/reloading loses the draft.
- The page does not know any task, version, generated image or inventory. Its link has no private query/fragment payload. Generic labels are not previews.

## Binding pasted feedback

A copied prompt targets the current Onepage task in the destination conversation. The assistant must verify that this is unambiguous, obtain the exact current task/version and actual asset inventory, then resolve each separate `canonical_slots` block against that bound index. A canonical slot matches only an exact canonical asset ID or an explicitly verified `assets[].canonical_slot`; names and template aliases are not silently guessed. Missing, ambiguous, stale or overlapping selectors fail closed. Unselected assets remain untouched.

The index hash correlates the supplied context; it is not authentication and does not prove latest backend state. Pasting the generic prompt in another conversation does not carry the original task lock. If the intended task/version is unclear, clarify before edits. Clear, authorized requests receive a scope echo without a redundant confirmation loop. Repeated prompts must reconcile previous execution before retrying.

## Guided fallback

Brief, research, content review, assets, feedback, packaging and delivery include human-readable next-step prompts. Missing input, in-progress, blocked and failed results receive recovery guidance rather than invented progress. Technical IDs stay in structured context. Research, current creative-quality contract, reference inspection and real ZIP verification gates remain enforced; feedback is never automatically submitted as training.

## Compatibility and boundaries

Existing nine tool names remain. Review/native schemas gain only optional state, feedback selectors, image-to-asset mapping and canonical-slot fields. Other tool schemas remain unchanged. Legacy v2/v3/v4 HTML resources remain inert and script-free. Existing cached HTML in a ChatGPT session cannot be invalidated by this patch; actual host behavior requires separate validation.

No authentication, access-control, backend datastore or deployment credentials are changed. The Vercel rewrite additions expose only the three generic static files; Render uses the existing built static directory. CI path filters include the new modules and public page.

## Validation

Automated coverage checks exact canonical inventory, separate groups and exclusions, stale indices, ambiguous/missing/conflicting mappings, preserved task/version, untouched targets, unchanged legacy schemas, no automatic widgets, no upstream feedback execution and stage/error guidance. Node full suite currently passes 667 tests; TypeScript check and production build pass. Independent code review found no blocking issue. Local Chromium startup is blocked by the execution environment; the available cloud browser cannot reach this local server, so real-browser/visual behavior awaits an accessible preview. DOM-harness checks cover group editing and copy/manual fallback; final test totals and any preview-browser outcomes are recorded in the pull request.
