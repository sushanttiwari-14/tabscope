# Multilingual search policy and validation

Implemented 2026-11-12. This is a feature-specific validation matrix, not a claim of native-level linguistic quality. Search is local, lexical, and does not translate, transliterate, detect languages, use embeddings, or perform OCR. The interface ships English only.

## Shared analysis and source invariant

`src/analysis.ts` is dependency-light and shared by retrieval, verification, excerpts and destination helpers. `Token` keeps original UTF-16 source start/end, original spelling, canonical form, relaxed form and validated locale hint. `Words` keeps field policy and optional source-sequence projections. `ANALYSIS_VERSION = 1` versions the contract. `distance.ts` is independent; neither the content script nor palette imports MiniSearch or the full search engine. The search/matching circular dependency is removed.

Every navigable range is an original extracted-source range. Canonical/relaxed token matches highlight the whole verified original token. No-space substring matches use a cached canonical projection with original grapheme boundary maps (compact Uint32 arrays) and verify both endpoints; normalized-string offsets never index the source. Displayed URL excerpts carry source-relative ranges. Ellipses are separate visual nodes, outside these coordinate systems. Titles, passages and URL excerpts consume worker evidence through one range renderer; overlapping ranges merge for display without changing their original navigation evidence. The palette has no independent word matcher.

“Original source” means the existing bounded readable-text collector's output, including its whitespace collapsing, DOM character maps and structural offsets. This change does not rewrite page text. PDF source means PDF.js's extracted text after the existing ligature, whitespace and line-hyphen handling; it does not imply a PDF's visual reading order is known.

## Segmentation and fallback

Word and grapheme segmenters use a fixed `en` locale for reproducibility within a runtime, independent of browser UI language and page hints. ICU's script-aware dictionary segmentation handles mixed scripts within this contract. The eight-entry bounded segmenter cache is shared per execution context. Exact results are verified on original source, not inferred from `supportedLocalesOf()`.

Page `lang` is bounded to 64 characters, validated/canonicalized with `Intl.getCanonicalLocales`, and stored optionally in session records. Invalid/missing/unsupported-language hints use the fixed segmentation policy. Hints affect Turkish/Azeri casing and whether English approximation is enabled; they do not select a different word dictionary or remove scripts from indexing. An incorrect hint can still affect case/approximate behavior, so it is not proof of the document's language. A page-wide English hint is only a conservative approximation gate, not a guarantee that every Latin token is English.

Han, kana and Thai **script checks are not language detection**. A field containing these scripts retains one additional original-source sequence with a canonical grapheme projection, built on content update. Bare no-space terms and phrases containing these scripts are verified as complete source substrings, irrespective of word segmentation in isolation or context. Whitespace runs collapse to a single space in phrase projections; punctuation, zero-width characters and joiners remain literal. A shared character cannot stand for a multi-character query. These sequences are not n-grams, are not displayed words, add no expansion-frequency score, and never cross an explicit paragraph/page/column boundary for a phrase.

MiniSearch uses the shared word tokenizer and an identity `processTerm`: token normalization happens once. Already-parsed query index terms use an identity lookup tokenizer rather than being segmented and normalized again. Verified supplemental candidates cover context-sensitive substrings, relaxed forms and Turkish casing that a word dictionary can miss. Filters apply before verification and all eligible candidates are considered before the existing 100-result cap. This fallback costs a bounded pass over cached analyses; documents are not segmented on keystrokes.

Manifest minimum and esbuild target remain Chrome 120. [Chrome’s Intl.Segmenter support table](https://web.dev/blog/intl-segmenter) records support from Chrome 87. The existing startup offscreen probe now uses runtime.getContexts (Chrome 116+) instead of the newer hasDocument API. TypeScript adds Intl declarations and ES2023 declarations for already-supported `findLast`; this does not change that runtime floor. Actual runtime exercised: Chrome 157.0.8103.78 on macOS. Chrome 120 itself is **unverified**. If Segmenter is absent, regex words retain marks/joiners, no dictionary equivalence is promised, and truncation conservatively keeps whole strings or returns empty text. No-space fallback only matches endpoints it can verify; partial substrings can be unavailable. Truncated HTML extraction in that compatibility state drops the incomplete body rather than emitting broken clusters.

## Normalization policies

| Pair | Policy |
| --- | --- |
| é / e + combining acute | NFC canonical equivalent; source spelling retained |
| Korean syllables / canonical Jamo sequence | NFC canonical equivalent |
| Case, Greek final sigma / sigma | Deliberate case equivalence (Greek accents retained) |
| I / ı and İ / i with validated tr/az hint | Locale case equivalence; the two groups remain distinct |
| I / i without that hint | Default Unicode lowercasing; dotted İ retains its dot; prefixes cannot cut that grapheme |
| café / cafe; selected Latin vowels with acute, grave, circumflex, diaeresis, tilde or ring; ç / c | Explicit relaxed whole-token aliases |
| ñ / n | Distinct; no blanket Latin-mark removal |
| ß / ss | Relaxed whole-token alias, not typo |
| Full-width Latin letters/digits / ordinary forms | Explicit relaxed alias only; no global NFKC |
| Arabic U+064B–0652, U+0670 | Optional-mark relaxed alias; other Arabic marks are retained |
| Hebrew U+0591–05BD, 05BF, 05C1–05C2, 05C4–05C5, 05C7 | Optional cantillation/niqqud relaxed alias; other marks retained |
| Hindi vowel signs and virama; Japanese voicing | Significant and retained |
| Simplified / Traditional Chinese | Distinct text; no conversion |
| Latin / Cyrillic lookalikes | Distinct scripts |
| Straight / curly apostrophe | Literal, distinct punctuation; both are searchable |

The exact alias character set is explicit in `relaxed()`, not an assertion that every accent in a language is optional. Canonical matches rank above relaxed aliases. Relaxed aliases are not labeled typing mistakes. Prefixes require a canonical grapheme boundary; relaxed prefix expansion is not implemented. URL fields use canonical case/NFC and canonical prefix search only, with no prose alias, typo or morphology policy. URL routing and host filters still use actual URLs and `new URL`, independently of search forms. URL search uses the stored URL representation: percent-encoded Unicode paths and punycode hostnames do not gain decoded Unicode query aliases in this release. Raw Unicode URL-field unit fixtures test the supplied representation, not Chrome’s encoded URL serialization. ASCII/literal encoded URL search is preserved; international body/title retrieval does not imply decoded-URL retrieval. Numeric/underscore/punctuation identifiers receive no English approximation. User content and URLs never enter translation files.

## Query, ranking and bounds

Only ASCII double quote (`"`) is query syntax. An unmatched quote consumes the remainder as a phrase. Curly quotation marks and other Unicode punctuation are ordinary input. Quoted phrases preserve source order, literal punctuation (including leading/trailing punctuation), joiners and zero-width characters; whitespace runs are interchangeable. Leading/trailing whitespace inside delimiters is ignored. No arbitrary punctuation gap, stemming or typo recovery is allowed in phrases. Latin-space phrases can use the deliberate whole-token aliases above. Context-sensitive-script phrases use canonical source sequences. Structural/PDF breaks always prohibit phrase bridging.

Queries retain the 500 UTF-16 limit, 12 components/terms after deduplication and 80 units/term. A contiguous no-space input run counts as one term rather than hundreds of generated dictionary words. Turkish-sensitive source forms participate in deduplication so `I i` remains an AND of distinct case groups under a Turkish hint. Punctuation-only queries preserve recent-tab behavior. Terms over 180 source units are not displayed as ordinary-word evidence; verified no-space subranges stay bounded by query length.

Approximation requires a validated **English** content hint. Unknown/missing language, non-English hints and URLs do not stem or typo-correct. Existing English tests now declare English explicitly; fixture HTML does likewise. This intentionally removes the old unsafe behavior of stemming any ASCII text. No additional stemmers ship. English rules remain the existing small plural/-ed/-ing set. Bare lowercase ASCII queries of 4–40 characters use the existing bounded Damerau/Levenshtein-style code-point comparison (ASCII code points are graphemes), one edit or two for length >=8. Numbers, punctuation/URL identifiers, capitalized queries and shorter words receive no expansion.

The existing vocabulary limits remain 500 eligible English tabs, 2M text units, 12,000 words and eight approximate expansions/term. These are approximate-recovery coverage limits, not caps on exact/relaxed/no-space candidate verification. Approximate results remain visibly grouped and name the original wording.

Ranking prefers canonical evidence, relaxed aliases, canonical prefix, English variants, then typo evidence. Per-tab weakest component quality sorts before relevance. Exact candidate scores are retained rather than replaced by an expanded query's score; weak candidates do not gain MiniSearch score by having more expansion alternatives. Distinct field evidence retains title/body/URL weights 3/2/1. Passage score retains distinct component coverage, explicit phrase evidence and proximity. Recency/id resolve remaining ties. Existing occurrence/context cap 2,000, 32 passages/tab, 100 tab groups and capped indicators remain.

## Validation matrix

R = representative basic source retrieval in Node **and Chrome**. C = Node canonical/case assertions where listed. P = Node canonical prefix fixture (for no-space scripts, verified source substring instead). Q = Node exact whole-phrase fixture. H = Node original offsets/grapheme boundaries plus Chrome source passages. “Disabled” means intentionally unsupported, not untested success.

| Language | R | Case / canonical checks | Relaxed policy fixture | P / Q / H | Typos / word variants | RTL UI | PDF fixture |
| --- | --- | --- | --- | --- | --- | --- | --- |
| English | yes | case; existing regressions | — | yes / yes / yes | tested with en hint | LTR | existing pages/navigation |
| Spanish | yes | NFC é; source accent spelling | café; ñ stays distinct | yes / yes / yes | disabled | LTR | not separately tested |
| French | yes | composed/decomposed é | café and Latin acute | yes / yes / yes | disabled | LTR | café extraction |
| German | yes | case via Straße query | ß / ss | yes / yes / yes | disabled | LTR | Straße / Strasse |
| Portuguese | yes | source science/heart accents | explicit Latin alias policy, not exhaustive | yes / yes / yes | disabled | LTR | not tested |
| Turkish | yes | I, İ, ı, i positives/negatives; AND semantics | no dotless/dotted conflation | yes / yes / yes | disabled | LTR | not tested |
| Russian | yes | lowercase retrieval; broader case quality unreviewed | no aliases; lookalikes distinct | yes / yes / yes | disabled | LTR | not tested |
| Greek | yes | uppercase query, sigma equivalence | accents retained | yes / yes / yes | disabled | LTR | not tested |
| Arabic | yes | marks retained in canonical form | optional vowel marks | yes / yes / yes | disabled | Chrome mixed Latin/digits, 360px | explicit Unicode CMap extraction |
| Hebrew | yes | marks retained in canonical form | niqqud/cantillation | yes / yes / yes | disabled | Chrome mixed Latin/digits, 360px | explicit Unicode CMap extraction |
| Hindi | yes | vowel-sign negative; grapheme ranges | none | yes / yes / yes | disabled | LTR | जानकारी extraction |
| Chinese Simplified | yes | original characters | no Traditional conversion | substring / yes / yes | disabled | LTR | 科学研究 extraction |
| Chinese Traditional | yes | distinct original characters | no Simplified conversion | substring / yes / yes | disabled | LTR | not separately tested |
| Japanese | yes | voiced/unvoiced distinction; decomposed voicing offsets | none | substring / yes / yes | disabled | LTR | Japanese text / が |
| Korean | yes | canonical Jamo/syllable equivalence | none | yes / yes / yes | disabled | LTR | not tested |
| Thai | yes | contextual substring retrieval | none | substring / yes / yes | disabled | LTR | not tested |

These fixtures do not establish general stemming, spelling correction, linguistic token quality, or natural phrasing quality in those languages. Portuguese/German/French lexical aliases are bounded character policies, not dictionaries. Native-speaker review has not occurred. Casing outside the explicit tests remains implementation behavior, not a native-quality support claim.

## UI, accessibility and localization

The English shell remains LTR. Titles/snippets use `dir=auto`; metadata, source labels, shortcut hints and match controls use direction isolation. No row or string is reversed. Page-supplied bidi formatting characters are replaced with one UTF-16 replacement character **for display only**, preserving evidence coordinate lengths and preventing controls from rearranging adjacent chrome. Source bodies, quotes and DOM matches remain unchanged. Grapheme truncation iterates only through the requested prefix; an oversized PDF item does not allocate a grapheme array for its complete source. Clipping below the numeric text cap still preserves partial-coverage flags. All content is rendered with text nodes/constructed elements. Logical CSS properties and wrapping keep longer labels inside narrow settings layouts.

Composition start invalidates in-flight UI responses. While composing, search returns early, Enter does not activate and candidate arrows remain native. Composition end issues the committed query. Real Chrome tests dispatch synthetic composition/input/key events and verify this contract; **physical OS IMEs and live screen readers are unverified**. No script-derived language attribute is invented. Existing English UI ARIA and keyboard/focus contracts remain.

`_locales/en/messages.json`, manifest `default_locale`/`__MSG_...__` and the `t()` wrapper use [Chrome's localization format](https://developer.chrome.com/docs/extensions/how-to/ui/localization-message-formats). Buttons, settings, coverage, announcements, errors/notices, navigation and PDF messages are cataloged, with stable keys, translator context and placeholders. Production bundles call Chrome i18n; the English fallback is unit-test-only and removed from shipped JS. Offscreen documents expose [only the runtime extension API](https://developer.chrome.com/docs/extensions/reference/api/offscreen), so the trusted background worker passes a bounded whitelist of localized PDF templates through the existing extraction message. That bridge contains interface text only and is validated before use. Only English ships. Dynamic result announcements have one/other keys. Before another UI locale ships, extend count-message selection using `Intl.PluralRules` and its required CLDR categories for results, coverage, passages and PDF counts; obtain translator review. Do not build translated sentences from fragments. The one existing site-label/count grouping is a UI label, not a grammatical plural sentence.

The browser smoke test replaces `chrome.i18n.getMessage` only in its disposable renderer to lengthen labels, then checks container overflow and screenshots. No pseudo-locale or machine-translated pack ships. It also checks mixed-direction titles, long URL labels, highlighted spans, hostile controls and narrow layouts. Actual 200%/400% browser zoom, ellipsis aesthetics under all RTL fonts, physical IME and screen reader announcements remain manual release checks.

## PDF limits

Shared search analysis runs over PDF.js output while physical pages, source offsets, column separators, permissions, fetch limits and native-reader navigation remain intact. Existing PDF permission, cancellation, scanned, column-boundary and page-jump tests pass. The new Unicode CMap PDF tests real PDF.js extraction for Latin, Chinese/Japanese, Hindi, Arabic and Hebrew. Its Helvetica glyphs are placeholders: it is **not** a visual shaping/font test. RTL fixture glyph drawing order is supplied explicitly, as required by PDF.js's bidi processing.

An initial synthetic logical-order Arabic/Hebrew stream was extracted in reversed character order by PDF.js. That is an extraction-order limitation, not evidence that the search layer should reverse strings or guess reading order. Real PDFs can have visual-order text, missing Unicode maps, separate glyphs or unexpected columns; those can still defeat retrieval. No automatic string reversal, OCR or remote recovery was added. Scanned/image-only and known malformed/limited sources use existing coverage states. Visible U+FFFD replacement characters or unpaired surrogates mark extraction partial with a localized explanation while preserving original extracted text; this is tested in Node and the synthetic Chrome PDF. Arbitrary incorrect Unicode maps that produce ordinary letters cannot reliably be detected automatically. PDF destinations promise page navigation, not DOM text highlighting.

## Session migration and privacy

The record storage schema remains 3; optional locale hints are validated on extraction/recovery and old records without hints remain searchable. A session `analysisVersion` records the policy; all MiniSearch state, token maps, projections and query caches are **derived in memory** and rebuilt on every worker recovery from reconciled session records. No old serialized normalization/index is reused. Cache keys include policy version/query/filters; sync invalidates on locale, text, metadata, coverage or recency changes. The page observer watches lang changes; a real Chrome fixture changes tr → en → tr and verifies that query results follow fresh analysis without changing page text. The agent source hash includes analysis, localization catalog and distance helpers so older injected agents are replaced.

HTML/PDF source bodies remain session-only, under existing 60k/tab and 2M aggregate source/location budgets. Derived maps are bounded by those retained sources and are included in measured JS heap and ArrayBuffer memory; they are not free quota space. There is no new storage.sync, external dictionary, telemetry, fetch destination, permission, or wake-up behavior. URL revalidation, generation checks, exclusions, revocation, Clear Data & Pause, stale worker jobs and nearest-source relocation retain the existing paths and regression coverage.

## Reproduction and evidence

- `npm run check` — TypeScript, ESLint and all unit/integration tests.
- `npm run build` — bundled Chrome 120 target; English catalog copied to dist.
- `npm run test:multilingual` — isolated real Chrome, local synthetic HTTP/PDF fixtures; native permission prompts not exercised.
- `npm run test:overlay`, `npm run test:access`, `npm run test:features`, `npm run test:passages` — existing browser regression suites.
- `node scripts/multilingual-benchmark.mjs` — same-machine original `c4d6f6b` vs current implementation (override with `TABSCOPE_BENCHMARK_BASE`), fresh Node process/scenario with explicit GC; raw report under `work/multilingual-benchmark/result.json`.
- `npm run benchmark` — existing exact/phrase/approximate stress harness; cache disabled; English fixtures declare en.

Versioned measured results and final verification are recorded in [TESTING.md](TESTING.md). Runtime-specific ICU segmentation can vary; Node results alone do not establish Chrome support. Chrome 120 hardware, Windows/Linux, native-speaker review, physical IMEs, live screen readers and actual browser zoom remain unverified.
