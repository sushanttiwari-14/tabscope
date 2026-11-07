# Implementation plan

- [x] Inspect workspace/tools/account; define product, design, architecture.
- [ ] Scaffold TypeScript, local build pipeline, lockfile, CI.
- [ ] Implement bounded extraction, session recovery and permission-aware indexing.
- [ ] Implement ranked search and shared keyboard UI.
- [ ] Implement activation, safe highlighting and restricted-page fallback.
- [ ] Implement exclusions, themes, clear/pause/resume and recovery.
- [ ] Verify automated behavior, isolated Chrome flows, visual states and benchmarks.
- [ ] Synchronize README/privacy/testing, source/build handoff and draft PR.

Dependencies follow this order. Each feature checkpoint runs relevant checks; final check runs typecheck, lint, tests, build. Browser checks use isolated fixtures/profile; never load-test existing user tabs. Document any inaccessible environments or unperformed checks.
