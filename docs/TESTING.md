# Verification report — 2026-11-07

This is a working MVP in a draft PR, not a production-readiness claim. Source branch: `feat/tabscope-mvp`. Native command invocation and some accessibility/compatibility checks remain release gates.

## Environment and reproducible commands

macOS on Apple M4, 16GB RAM; Git 2.51.0; Node v24.21.0; npm 11.19.0. Installed Google Chrome 157.0.8103.39 was detected. Completed browser suite used official **Google Chrome for Testing 157.0.8103.38**, a separate profile and controlled HTTP fixtures served only on 127.0.0.1. Existing user Chrome tabs were not load-tested or modified.

```sh
npm ci
npm run check       # strict typecheck, ESLint, Vitest
npm run build       # dist/ loadable Manifest V3 extension
npm run benchmark   # pure search/rebuild timings, synthetic documents
```

Browser test requires a recent Chrome with the experimental CDP Extensions domain (157 tested), and a desktop session for native permission prompts. Set your installed Chrome/Chrome for Testing executable, not its .app directory:

```sh
TABSCOPE_CHROME='/path/to/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
TABSCOPE_HEADED=1 TABSCOPE_LOAD_TEST=1 npm run test:browser
```

The script creates an isolated temporary profile, loads the production `dist` through CDP, and asks for localhost-only website access using the real Settings button. Approve Chrome's localhost prompt in that disposable profile within two minutes. It never requests all-site access. `TABSCOPE_LOAD_TEST=1` opts into the controlled 105-tab load test; omit it for functional checks. `TABSCOPE_EVIDENCE=/absolute/path` changes the screenshot/result location (default ignored `work/browser`). `TABSCOPE_CHROME` defaults to the normal macOS Chrome binary, but Chrome for Testing is recommended to keep native automation separate from personal Chrome. Headless mode cannot approve the native extension permission prompt.

Experimental CDP APIs and the `--enable-unsafe-extension-debugging` flag are used only in this throwaway test profile, never by the extension itself. On browsers without these test APIs, load `dist` manually and follow the checklist below. Browser tests are intentionally separate from CI, which has no native prompt approval.

## Automated results

- Strict TypeScript, ESLint: passed.
- Vitest: **15 tests across 3 files passed**. Multiword/prefix/diacritic ranking; real-source snippets; deterministic ordering; incremental record replacement and body eviction; host exclusion boundaries; budget eviction; generation/URL/paused/denied commit protection; bounded extraction/hidden/form/editable omission; extraction→search; saved settings; restored worker records; closure/revocation/discard behavior; navigation failure; untrusted sender rejection, including null-origin URL spoof; blocked late extraction racing Clear Data.
- Production build passed. Chrome reported no manifest install warnings/errors in the isolated automated profile.
- npm audit: zero vulnerabilities after a scoped `minimatch` override to 11.0.1+ for the TypeScript ESLint development toolchain. Production `npm audit --omit=dev` also passed. This describes this lockfile at verification time.
- GitHub Quality workflow passed on pushed checkpoints. Final workflow status is linked in the draft PR.

## Actual Chrome observations

Passed in Chrome for Testing 157.0.8103.38 against the production bundle:

- Before host grants, body-only query has no matches; localhost permission granted from the actual UI flow; unrelated-title/URL tabs found using `orbital ceramic` and reordered `ceramic orbital`.
- Extension action event invoked through CDP `Extensions.triggerAction`; repeat invocation creates one overlay. This tests Chrome's action callback, not a physical toolbar click.
- Input, arrow selection, one selected option, Escape removal, original input focus restoration.
- Real text split over inline DOM nodes; CSS Highlight range present; page scrolled more than 500px to a below-viewport passage. The initial broad-context scroll bug was fixed and retested.
- Dynamic DOM content becomes searchable after debounced observer processing.
- Browser-internal page action opens a separate extension popup with the shared search UI.
- Cross-window activation and passage highlighting in the correct window/tab.
- Discarded tab loses body coverage; a search leaves it discarded. Explicit activation reloads it and indexing recovers. Chrome can replace the tab ID during discard; replacement lifecycle handling added and tested.
- Content-script-origin search request rejected; only extension-origin palette documents receive search responses.
- Worker forced to stop through CDP; a disposable global marker disappears and stored records still return matches after restart. This establishes actual context restart, rather than assuming a successful stop command proves it.
- Exclusion purges body text; removal permits reindexing; Clear Data pauses and empties search; automatic Refresh does not recreate it; Resume restores content.
- Closed tabs disappear; hidden/form fixture text never matches; permission revocation removes body matches.
- System light/dark styling and reduced-motion media emulation; 360×640 narrow viewport has no horizontal document overflow. Screenshots were visually inspected for clipping, alignment, readable snippets and contrast. All screenshots contain synthetic fixtures only.

Evidence: [browser result](evidence/browser-result.json), [browser benchmark](evidence/browser-benchmark.json), [light](screenshots/light.png), [dark](screenshots/dark.png), [narrow](screenshots/narrow.png), [overlay](screenshots/overlay.png), [fallback](screenshots/fallback.png).

## Performance

Synthetic search-only benchmark: ~19,953 characters/document, repeated materials-science prose with a rare body-only query marker in every seventh document. Ten cold MiniSearch rebuilds and 250 alternating warm keyword searches per dataset; Node performance.now, milliseconds. No DOM/network/storage involved. Heap is the observed Node JS heap after repetitions, not peak extension/browser memory. Raw output: [search benchmark](evidence/search-benchmark.txt).

| Documents | Characters | Cold rebuild p50 / p95 ms | Warm search p50 / p95 ms | Observed JS heap MB |
| --- | ---: | ---: | ---: | ---: |
| 5 | 99,773 | 2.71 / 4.94 | 0.19 / 0.23 | 9 |
| 20 | 399,069 | 9.80 / 9.88 | 0.74 / 0.78 | 10 |
| 50 | 997,684 | 23.84 / 24.99 | 1.84 / 1.99 | 18 |
| 100 | 1,995,345 | 48.54 / 50.23 | 3.69 / 3.91 | 11 |
| 150 | 2,993,006 | 72.76 / 74.11 | 4.75 / 5.08 | 20 |

The 150-document search-library stress dataset exceeds the product's 2M-character storage budget; it is not an assertion that all that text is retained by the extension.

Real Chrome load test: one short fixture plus long ~20,100-character pages, grown incrementally through 5/20/50/105 actual fixture tabs across normal windows. Thirty warm requests at each stage. Warm timings include UI runtime messaging, permission/metadata reconciliation, ranking, snippets, and CDP test round trip, not just the search algorithm. “Settle added tabs” includes creation/loading/extraction/index/storage work from the previous stage; it is not a full cold browser boot measurement.

| Fixture tabs | Content-searchable | Retained text units | Settle added tabs ms | Warm round trip p50 / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| 5 | 5 | 80,550 | 349 | 0.92 / 2.16 |
| 20 | 20 | 382,050 | 750 | 2.28 / 4.03 |
| 50 | 50 | 985,050 | 1,564 | 5.28 / 5.81 |
| 105 | 99 | 1,989,900 | 3,425 | 10.01 / 11.51 |

The 105-tab result exercises budget eviction: six oldest bodies are metadata-only. The representative 100-document warm search target of <100ms was met here, as was the 105-tab observed round trip. Results are measurements, not hardware/site guarantees. Per-process Chrome CPU, peak memory, and a fresh browser cold boot were not instrumented. DOM complexity, unique-origin permissions, text distribution and device hardware can change results substantially.

## Manual release checklist and remaining limits

These are **unverified**, not passed:

- [ ] Physical native command: Chrome displays `⇧⌘K` assigned in the dedicated test browser. CDP-generated keys do not invoke browser accelerators. Native automation attempts also did not produce an observed palette; do not claim command invocation is verified. On a physical keyboard, focus a normal loaded page, press the assigned command, assert immediate input focus and one palette; repeat, then Escape. Repeat on chrome://extensions for fallback. Reassign at chrome://extensions/shortcuts if needed. This must be resolved before marking ready.
- [ ] Physical toolbar icon click. Chrome's actual action callback passed via CDP; native click was not confirmed through available automation.
- [ ] VoiceOver/NVDA announces dialog name, combobox/list count, option selection, coverage and errors; Tab/Shift+Tab stay inside palette; closing restores focus. ARIA/native-dialog implementation and keyboard interactions are present, but no live screen reader was exercised.
- [ ] Actual browser zoom at 200%/400%; narrow viewport passed, which is not a substitute for browser zoom or a full contrast audit.
- [ ] Native deny prompt and per-site withholding through Chrome's own controls. No-grant and revoke states passed; the explicit Deny button was not manually exercised. All-site grant prompt was not requested in the user's browser.
- [ ] Broader compatibility on safe real websites (strict CSP, complex SPAs, open shadow trees, long/duplicate passages, lazy-loaded articles). Current real browser coverage uses controlled fixtures; unit tests include capped long text. SVG/shadow/frame/PDF/image/canvas/virtualized content remains unsupported.
- [ ] Chrome 120 floor on actual hardware and Windows/Linux shortcut behavior. API floor is documented; runtime tested on Chrome 157/macOS only.
- [ ] Quantitative contrast audit, page-level assistive-technology behavior and IME composition with a real non-Latin input method. Reduced-motion/light/dark are media-emulated; IME guards are implemented but not manually exercised.

Do not merge, release, submit to the store, or mark production-ready based on this report. Keep the PR draft until release gates are checked or explicitly scoped by a reviewer.
