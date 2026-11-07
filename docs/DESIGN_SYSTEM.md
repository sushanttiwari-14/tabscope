# TabScope design system

Brand lives in manifest.json, src/brand.ts, and this document. Compact, calm, content first. No promotional screen.

## References and decisions

Reviewed official [Spotlight guidance](https://support.apple.com/en-ke/guide/mac-help/mchlp1008/mac), [Raycast quickstart](https://manual.raycast.com/quickstart), and [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui). Borrow immediate keyboard focus and a single task from Spotlight; predictable arrow/return interaction from Raycast; quiet surfaces and consistent alignment from Linear. These are design references, not usability research.

## Typography

System fonts only: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif. Input 20/28px weight 400, tracking -.3px; title 14/20 weight 600 tracking -.1px; snippet 13/20 weight 400; metadata/footer/shortcuts 11/16 weight 400; state heading 16/24 weight 600; state copy 13/20. Shortcut labels use ui-monospace, monospace. Body 13/20. No downloaded fonts.

## Tokens and themes

`src/styles/tokens.css` is the source for exact values. Light: canvas #f3f4f6, surface #fff, text #202329, muted #626976, border #e4e6eb, selected #edf1ff, accent/focus #445bcb, match #fff0b3, error #b12d3c, success #28704d. Dark: canvas #18191c, surface #242529, text #f0f1f3, muted #a8adb8, border #3a3d44, selected #303950, accent/focus #a7b8ff, match #66551b, error #ff9aa6, success #8bd5aa. Focus 2px solid accent with 2px offset. Match uses normal theme text. Dim backdrop black 28%; shadow 0 24px 80px black 24%. Opaque content ensures predictable readability. Follow system unless preference light/dark selected. Text targets WCAG AA 4.5:1 normal / 3:1 large; visible focus and selected outline do not depend on color alone.

## Geometry

4px scale: 4, 8, 12, 16, 20, 24, 32. Palette 640px wide max, viewport minus 24px at narrow sizes; top 14vh with max height min(680px, 80vh). Search padding 20px, input minimum height 32; list padding 8px; row padding 12px, icon 28px, gap 12px, radius 8px. Palette radius 16px, separator 1px. Result title single line ellipsis; snippet two lines; URL one line. Metadata wraps if necessary. Footer padding 12px 20px. Settings is a view inside the same palette, scrollable. Buttons minimum 32px high. Narrow widths hide secondary footer hints; no horizontal scroll. All layout/color/type styles consume semantic tokens (including size tokens).

## Motion

Opening opacity and translateY(4px) 140ms ease-out. Selection/hover background 120ms; status opacity 140ms. Closing immediate to preserve focus. Results update immediately; never animate reordering or delay input/navigation. prefers-reduced-motion disables transitions and entrance animation. No spring or decorative effects.

## States and examples

Main: [scope glyph] [Search anything in your tabs…] [esc]\nseparator\n[28px neutral site initial] Title / hostname · Content / two-line real snippet\nseparator\n[12 of 18 content-searchable] [↑↓ select] [↵ jump] [Settings]. Empty input lists open tabs; no synthetic results. No results: “No matching tabs” / “Try different words. Only permitted, loaded text is searched.” Permission: coverage remains visible, Settings offers explicit per-site/all-site access. Indexing: “Indexing…” alongside coverage. Metadata-only / stale / unavailable / excluded are row labels. Error uses concise text and retry through the next query. Paused: persistent “Indexing paused” and Resume. Settings: theme, access explanation, origin input and grant buttons, exclusions textarea, clear and pause, resume, shortcut guidance.

## Accessibility and behavior

Native modal dialog in extension document, with visible product label. Search combobox controls listbox with aria-activedescendant; options expose selected state. Polite live count/coverage; alert for navigation failures. Keyboard arrows only intercepted outside IME; Enter activates selected result; Escape exits settings then closes. Tab stays within native modal, close restores page focus through content controller. Pointer hover changes selection only on actual pointer move, click activates. Input receives immediate focus; repeated invocation refocuses existing palette. At 200% zoom and narrow viewports list and settings scroll, controls wrap. UI iframe has descriptive title. Host page can interfere with overlay: fallback extension window offers an isolated surface.

## First-open access choice

One inline section below the search field explains local content search and the sensitivity of readable text. Uses surface/canvas/text tokens, 16px/20px padding, 14px semibold heading, 13/20 body, and existing 32px buttons. “Allow all websites” and “Titles & URLs only” are explicit choices. No automatic permission request, blocking welcome screen, focus theft, or recurring prompt. A grant, denial, or metadata-only choice is remembered; existing all-site users see no prompt. Settings remains the place to change or revoke access.

Palette uses a flex column: search, access explanation and footer stay visible; result/settings lists shrink with min-height:0 and scroll within the remaining height. This prevents the one-time access explanation from clipping the footer on narrow viewports.
