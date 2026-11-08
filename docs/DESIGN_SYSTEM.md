# TabScope design system

Brand lives in manifest.json, src/brand.ts, and this document. Compact, calm, content first. No promotional screen.

## References and decisions

Reviewed official [Spotlight guidance](https://support.apple.com/en-ke/guide/mac-help/mchlp1008/mac), [Raycast quickstart](https://manual.raycast.com/quickstart), and [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui). Borrow immediate keyboard focus and a single task from Spotlight; predictable arrow/return interaction from Raycast; quiet surfaces and consistent alignment from Linear. These are design references, not usability research.

## Typography

System fonts only: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif. Input 19/28px weight 400, tracking -.3px; title 14/20 weight 600 tracking -.1px; snippet 13/20 weight 400; metadata 12/16 weight 400; footer/shortcuts 11/16 weight 400; state heading 16/24 weight 600; state copy 13/20. Shortcut labels use ui-monospace, monospace. Body 13/20. No downloaded fonts.

## Tokens and themes

`src/styles/tokens.css` is the source for exact values. Light: canvas #f3f4f7, surface #fff, text #242831, muted #606875, border #e7e9ee, selected #f1f3f7, accent/focus #5366b5, match #fff0b3, error #b12d3c, success #28704d. Dark: canvas #191c21, surface #24272d, text #f0f2f6, muted #a6adba, border #353a43, selected #30353e, accent/focus #b0bde8, match #66551b, error #ff9aa6, success #8bd5aa. Focus 2px solid accent with 2px offset on controls; the main search field uses a visible 2px accent rule under the header instead of a rectangular input outline. Match uses normal theme text. Dim backdrop black 35% with 6px backdrop blur; layered shadow 0 24px 80px black 20% plus 0 4px 16px black 8% (dark: 40% / 15%). Opaque content ensures predictable readability. Follow system unless preference light/dark selected. Text targets WCAG AA 4.5:1 normal / 3:1 large; visible focus and selected outline do not depend on color alone.

## Geometry

4px scale: 4, 8, 12, 16, 20, 24, 32. Palette 640px wide max, viewport minus 24px at narrow sizes; top 14vh with max height min(680px, 80vh). Search padding 20px, input minimum height 32; list padding 12px; row padding 12px, icon 32px, gap 12px, row radius 14px. Palette radius 24px, separator 1px. The page stays visible behind the palette; only the modal surface is opaque. Result title single line ellipsis; snippet two lines; URL one line. Metadata wraps if necessary. Footer padding 8px 16px. Settings is a view inside the same palette, scrollable. Buttons minimum 32px high. Narrow widths hide secondary footer hints; no horizontal scroll. All layout/color/type styles consume semantic tokens (including size tokens).

## Motion

Opening opacity and translateY(4px) 140ms ease-out. Selection/hover background 120ms; status opacity 140ms. Closing immediate to preserve focus. Results update immediately; never animate reordering or delay input/navigation. prefers-reduced-motion disables transitions and entrance animation. No spring or decorative effects.

## States and examples

Main: [scope glyph] [Search your open tabs…] [esc]\nseparator\n[32px neutral site initial] Title / hostname / two-line real snippet when searching / selected return hint\nseparator\n[Page text · 12 of 18 tabs] [↑↓ select] [↵ jump] [Settings]. Empty input lists compact title/hostname rows without page excerpts; snippets appear when a keyword query is entered. No synthetic results. No results: “No matching tabs” / “Try different words. Only permitted, loaded text is searched.” Permission: coverage remains visible, Settings offers explicit per-site/all-site access. Indexing: “Indexing…” alongside coverage. Metadata-only / stale / unavailable / excluded are row labels. Error uses concise text and retry through the next query. Paused: persistent “Indexing paused” and Resume. Settings: theme, access explanation, origin input and grant buttons, exclusions textarea, clear and pause, resume, shortcut guidance.

## Accessibility and behavior

Native modal dialog in extension document, with visible product label. Search combobox controls listbox with aria-activedescendant; options expose selected state. Polite live count/coverage; alert for navigation failures. Keyboard arrows only intercepted outside IME; Enter activates selected result; Escape exits settings then closes. Tab stays within native modal, close restores page focus through content controller. Pointer hover changes selection only on actual pointer move, click activates. Input receives immediate focus; repeated invocation refocuses existing palette. At 200% zoom and narrow viewports list and settings scroll, controls wrap. UI iframe has descriptive title. Host page can interfere with overlay: fallback extension window offers an isolated surface.

## First-open access choice

One inline section below the search field explains local content search and the sensitivity of readable text. Uses surface/canvas/text tokens, 16px/20px padding, 14px semibold heading, 13/20 body, and existing 32px buttons. “Allow all websites” and “Titles & URLs only” are explicit choices. No automatic permission request, blocking welcome screen, focus theft, or recurring prompt. A grant, denial, or metadata-only choice is remembered; existing all-site users see no prompt. Settings remains the place to change or revoke access.

Palette uses a flex column: search, access explanation and footer stay visible; result/settings lists shrink with min-height:0 and scroll within the remaining height. This prevents the one-time access explanation from clipping the footer on narrow viewports.

## Floating overlay surface

The injected iframe uses a dedicated overlay.html with transparent root and body from first paint. Both iframe element and embedded overlay document use normal color-scheme to prevent Chrome from painting an opaque dark canvas when schemes differ; palette colors still follow shared semantic theme tokens. Only the host backdrop dims/blurs the underlying page (black 35%, blur 6px). Inline host layout/backdrop values are read from the bundled shared tokens so host CSP/style rules cannot hide the overlay. Dialog-container outline is suppressed while input/button focus indicators stay visible. No new tab or navigation on supported pages; Chrome toolbar and other applications remain outside the page overlay. Restricted pages retain the extension-window fallback.

## Outside-click dismissal

Clicking the dimmed page backdrop dismisses the overlay from search or Settings and restores previous page focus. Clicking inside or dragging from an input to outside does not dismiss it. Only a primary-button press and release that both occur outside the dialog count; canceled pointers are ignored. The backdrop consumes the click so controls on the page underneath are not accidentally activated. Escape remains available. Standalone fallback windows are unaffected by clicks in other applications.

## Minimal visual refinement

Use a 24px outer radius, 14px result rows, 10px controls/site icons, and 6px shortcut keys. Surfaces are neutral rather than saturated blue: selected light #f1f3f7 / dark #30353e, selected border #dde2eb / #434b59, hover #f5f6f9 / #2c3038, site tiles #f0f2f6 / #2c3139, selected tiles #e5e9f2 / #3b4350, footer #fafbfc / #21242a, keys #f0f2f5 / #2d323a, scrollbar #c4cad4 / #535d6b. A right-aligned return glyph appears on the selected row, supplementing color and aria-selected. Search uses a locally constructed 20px SVG magnifier; no remote icons. Empty-query rows omit snippets to reduce visual noise; keyword results retain two-line source excerpts. Content rows show hostname without repeated Content labels; limited text is labeled Partial text and metadata-only is Title & URL. Preserve coverage as Page text · X of Y tabs. Existing shortcuts, dismissal, permissions and ranking remain unchanged.


## Search recovery and filters (2026-11-08)

A compact collapsed Filters disclosure sits below search. It offers This window, Page text, a hostname and Exact host; the summary names active filters and Clear filters preserves the query. Controls wrap at narrow widths, use theme surfaces/focus indicators, and stay within the native dialog. No persistent advanced panel or query language is added. Close matches are labeled per row; highlighting marks the actual matched alternative words.

The existing coverage summary is now a button with aria-expanded/aria-controls. It reveals a small scrollable explanation, grouped reason counts and at most 100 tab recovery rows. Normal rows remain quiet; detailed reasons belong in the disclosure. Live result counts update only when the count/match mode changes. Destination feedback uses a short-lived dismissible status without reopening search; prohibited injection uses the extension action badge/title. Filter and coverage disclosures share the existing rounded neutral visual language.
