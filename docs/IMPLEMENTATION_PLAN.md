> Status update (2026-11-08): the five search/recovery/usability extensions are implemented in the existing modules. See PRODUCT_SPEC.md and ARCHITECTURE.md for current behavior and TESTING.md for current checks and outstanding manual gates. The original plan below is historical.

# Implementation plan

- [x] Inspect workspace/tools/account; define product, design, architecture.
- [x] Scaffold TypeScript, local build pipeline, lockfile, CI.
- [x] Implement bounded extraction, session recovery and permission-aware indexing.
- [x] Implement ranked search and shared keyboard UI.
- [x] Implement activation, safe highlighting and restricted-page fallback.
- [x] Implement exclusions, themes, clear/pause/resume and recovery.
- [x] Verify automated behavior, isolated Chrome flows, visual states and benchmarks; record unverified manual checks.
- [x] Synchronize README/privacy/testing, source/build handoff and draft PR.

Dependencies follow this order. Each feature checkpoint runs relevant checks; final check runs typecheck, lint, tests, build. Browser checks use isolated fixtures/profile; never load-test existing user tabs. Document any inaccessible environments or unperformed checks.

Open release gates: VoiceOver/screen-reader pass, actual browser 200% zoom and broader real-site compatibility. Draft PR intentionally remains draft until these are verified.

Native Mac Control+Space invocation, repeated refocus, and Escape closure are now verified through native Chrome controls. Windows/default suggestion is Ctrl+Shift+Space; Windows runtime and other release gates remain open.
