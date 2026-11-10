# TabScope design system

## Direction

A calm search palette: one obvious field, useful results, secondary controls revealed when needed. Borrow clarity, hierarchy and compact scope controls from [Apple’s search-field guidance](https://developer.apple.com/design/human-interface-guidelines/search-fields) and [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/). This is an adaptation for a Chrome extension, not a claim of native Apple UI or conformance certification. Keep all assets local and all search on-device.

## Surface and typography

`src/styles/tokens.css` is authoritative. Use the system font stack, including the platform system font on macOS. The search field is 23px with slightly tightened tracking; result titles are 14px/20px at weight 500, metadata 12px/16px, snippets 12px/19px, and secondary controls 11px. Match emphasis uses a quiet blue-grey fill and semibold text.

Light surfaces use #fafafa, primary text #242426, secondary text #66666d and accent #0066cc. Dark surfaces use #252527, primary text #f5f5f7, secondary text #acacb4 and accent #91bcff. A very subtle highlight gradient, fine shell border and layered shadows provide depth. Content stays opaque for readable text; the existing page backdrop is 35% black with 6px blur. Never blur result text or animate the backdrop.

The palette is at most 660px wide with a 24px radius; result rows use 12px corners and 32px local site monograms. The header has 22px/24px padding and a large unboxed input. The list shrinks and scrolls independently; header and footer remain visible. At narrow widths, controls wrap, secondary keyboard hints disappear, and the dialog fits within the dynamic viewport.

## Search hierarchy

Default view: search icon, field, Filters icon and Escape; a quiet Recent tabs label and count; compact title/site rows; coverage and Settings in a small footer. No permanent filter bar, repetitive Title & URL badges, decorative dashboard or account controls. Empty queries never show body excerpts.

A Clear search control appears only while the query has text. Results update immediately. Search results and Close matches labels explain the current mode. Only the selected result exposes the return arrow. Titles that already explain every query term do not need a weak partial body excerpt or navigation target. URL evidence appears only when it helps explain a match.

## Progressive disclosure

Filters open from the header button. This window and Page text use native checkboxes in compact controls; the website field and Exact host remain simple parsed-host filters. Exact host is disabled until a hostname is entered. Active filters appear as individually removable chips; Clear filters preserves the query. Closing the filter controls leaves active chips visible. Escape closes the open panel first, restores its trigger, then dismisses the palette on a subsequent Escape.

The coverage footer is a button with an explicit expanded state and controls association. It opens a bounded explanation with compact reason counts and relevant tab recovery actions. Paused indexing offers one Resume action instead of repeating the same paused message for every tab. A close control and Escape return focus to coverage. Coverage and filters do not compete as simultaneously open panels.

Settings show Appearance and the actual assigned shortcut first. A missing assignment receives a clear Set shortcut action that opens Chrome’s own shortcut page on deliberate activation. Website access, excluded sites and local data are separate native disclosures. Appearance saves immediately with a short status; excluded sites have their own explicit Save action. Privacy and permission consequences remain visible beside their controls. Search query and filters survive returning from Settings.

## Motion and interaction

Use the springy-motion skill’s restrained Snap press recipe: a 0.97 press scale, 180ms ease-out recovery. Palette entrance is a small 5px/0.985 scale-and-fade over 180ms. Panels reveal by 3px/fade over 160ms. No bouncing result rows, animated ranking, staggered typing or delayed navigation. Reduced Motion removes travel and scaling, retaining only a 100ms dissolve and immediate state feedback. Animate transform and opacity only; no dependencies are needed.

## Accessibility

The native modal has an accessible name and an explicit Tab/Shift+Tab boundary loop. Search uses combobox/listbox semantics and aria-activedescendant. Icon controls have accessible names and native hover titles. Controls have a visible 2px focus ring; selection also has a return indicator and aria-selected. Main-field focus accents the search glyph without a distracting full-width rule. IME composition remains native; live counts only change when their information changes. Background clicks are consumed before dismissal and the original page focus is restored.

Measured text contrasts: light secondary on surface 5.46:1, selection 4.83:1, footer 5.19:1; dark secondary on surface 6.79:1 and selection 5.26:1; white primary-button text 4.70:1. These pairs are checks, not a complete accessibility audit. Native screen readers and actual 200%/400% browser zoom still need manual verification.

## Evidence

The feature smoke script uses real extension responses and a localhost-only fixture installation grant. It exercises chip removal, clear-query behavior, forward/reverse focus traversal, Escape hierarchy, grouped settings, theme persistence and search/navigation. Captures wait for animations to finish. See [light search](screenshots/palette-search-light.png), [dark search](screenshots/palette-search-dark.png), [narrow filters](screenshots/palette-filters-narrow.png) and [Settings](screenshots/palette-settings-dark.png). Images contain controlled fixtures, not personal browsing data.

## Passage controls and query quality (2026-11-09)

One result row per tab remains. Only the selected tab reveals shared Previous / Passage N of M / Next controls beneath the list; these are siblings outside listbox options. The count names passages rather than word occurrences; `+` discloses caps. Pointer preview preserves input focus and list scroll; native Tab reaches controls for keyboard activation. Endpoints disable; no wrap or new OS/browser shortcuts. Query changes reset previews; polling preserves valid source IDs. Empty input offers a quiet Recent tabs disclosure, also reachable with Down Arrow.

Approximate-only tabs appear beneath an explicit Approximate matches separator. The selected passage names Similar wording or Close match and the actual source wording; PDF excerpts say Opens page N, with differing printed labels separate. All source text uses text nodes. Unbroken snippets wrap, controls wrap at narrow widths, and native focus rings/tokens remain. Interaction follows the existing restrained Snap press recipe and reduced-motion variant, with immediate passage swaps and no animated ranking. The destination's compact HTML navigator is dismissible with Escape and has underlined CSS highlights; it does not replace links or page markup.

At short viewport heights (including actual 200%/400% Chrome zoom), content scrolls as a whole below the input. Rows and passage controls no longer compete for a fixed internal list height. This intentionally lets footer controls scroll while keeping results reachable.

Destination Previous/Next buttons expose ← / → keyboard hints and aria-keyshortcuts. Bare arrows act only while that navigator is open and focus is outside editable fields/keyboard widgets. They immediately re-highlight the new passage; disabled boundaries do not wrap.

Destination navigation now flattens validated, deduplicated source ranges from the returned passages into document-order individual matches (at most 2,048). The initial match belongs to the selected palette passage. The destination labels these as Match N of M; palette previews continue to count passages. Highlighting has no expiry timer. An outside page pointer/click clears both the highlight and navigator without consuming the underlying click; navigator clicks preserve the active session. Bare Left/Right keys then return to native page behavior until another result is opened.
