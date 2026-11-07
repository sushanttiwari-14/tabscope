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

Open release gates: observe native command invocation on a physical keyboard, VoiceOver/screen-reader pass, actual browser 200% zoom and broader real-site compatibility. Draft PR intentionally remains draft until these are verified.
