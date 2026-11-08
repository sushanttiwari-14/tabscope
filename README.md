# TabScope

**Shortcut → Type → Find → Jump.** A compact Manifest V3 extension that finds readable passages in your open Chrome tabs. Search stays on your device.

## Install locally

Requirements: Chrome 120+; Node.js 22.12+ (Node 24 LTS tested); npm; Git for checkout.

```sh
git clone https://github.com/sushanttiwari-14/tabscope.git
cd tabscope
npm ci
npm run check
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist` directory. The repository is private; cloning requires your GitHub access. Routine build output is intentionally not committed.

Click the extension icon, or try **Control+Space (⌃Space) on Mac**, or **Ctrl+Shift+Space on Windows**. Assignment can conflict; set your preferred command at `chrome://extensions/shortcuts`. Chrome does not allow extensions to change your command assignment programmatically. Updated suggested defaults do not override an existing assignment. These shortcuts work while Chrome is focused. macOS can reserve Control+Space for input-source switching; if it conflicts, select a different TabScope shortcut. Windows uses Ctrl+Shift+Space to avoid the Ctrl+Space IME toggle. Settings shows the actual assigned shortcut.

On first opening, choose **Allow all websites** to enable content search across current and future sites, or **Titles & URLs only** to continue without website access. Chrome asks for an explicit grant once; it is never granted silently. The choice is remembered. You can also open **Settings** to grant a single hostname, change access, or revoke it. With no website access, titles and URLs still work. Coverage shows how many tabs are content-searchable. The opening view shows compact titles and sites, ordered by recent use; type keywords to reveal matching excerpts. Use ↑/↓ and Return to jump, or Escape to close. Reinvoking refocuses the existing palette. On supported pages, the palette floats above the current tab while the page remains visible behind a dimmed, softly blurred backdrop. Escape or a click on the dimmed backdrop closes the palette and restores page focus. Browser-internal/protected pages use a separate extension window. You can also open the extension's **Options** page from Chrome's extension details.

## Privacy and limits

No backend, analytics, remote fonts, favicon lookup, AI, history or accounts. Incognito is disabled. Text is held in Chrome session storage, not synchronized, and clears on browser restart/extension reload. Readable page text can still be sensitive. Exclude hostnames in Settings; an exclusion includes subdomains. **Clear data & pause** removes page text and pauses indexing until **Resume indexing**. Preferences are retained.

Only permitted, loaded, top-level HTTP(S) DOM text is indexed. Browser pages, PDFs, embedded frames, shadow trees, images, canvas, and unloaded/virtualized text are unsupported. Discarded tabs are metadata-only and never woken by indexing. Text is capped at 60,000 UTF-16 units per tab and 2,000,000 overall; capped/evicted records are labeled. Highlighting is best effort; tab activation works independently. Up to 100 ranked results are displayed. Exact/prefix search runs first; when it finds nothing, bounded typo recovery shows clearly labeled close matches. Use Filters for This window, Page text (all query terms must match body text), or a website hostname. Website filters include subdomains unless Exact host is selected; internationalized hostnames are parsed by the browser. Filters last for the current palette session. Click the page-text coverage summary for reasons and explicit recovery actions. Permission requests always need a button click. Retry is rate-limited per tab and budget evictions are not automatically refreshed. English/space-delimited keyword behavior is best supported; there is no stemming or CJK segmentation.

## Development and checks

```sh
npm run dev          # watch TypeScript; rebuild for CSS/manifest edits
npm run typecheck
npm run lint
npm test
npm run build
npm run benchmark    # controlled in-process synthetic 5/20/50/100/150-tab benchmark
npm run test:browser # isolated Chrome test profile; see docs/TESTING.md
npm run test:access  # first-open choice; no website grant or native prompt
npm run test:overlay # transparent floating overlay, light/dark, CSP and Escape
npm run test:features # real body search/recovery/filter fixture; localhost-only install grant
```

Reload the extension at `chrome://extensions` after rebuilding. Reload tested web pages to replace old injected agents after updating content scripts.

## Troubleshooting

- No shortcut response: check Chrome's shortcut assignment and extension enabled state; try the icon. Loading the extension from a different folder can create a separate installation with an unassigned shortcut and fresh website permissions. Check the current shortcut in TabScope Settings, disable obsolete copies, and assign Search open tabs at chrome://extensions/shortcuts.
- Metadata-only: check website access and exclusions. Use Load and search this tab in the coverage details if discarded. Reload once after granting access if a site restricts injection.
- No content matches: check coverage; try fewer keyword prefixes; text beyond caps or unloaded content cannot be searched.
- Highlight missing: the page may have changed or prevented injection. The target tab still opens; a short destination notice explains a missing passage. If page injection is blocked, the extension icon briefly shows a ! badge with explanatory hover text.
- Index paused: explicitly Resume in Settings. Reloading does not override pause.
- Worker restarted: session records recover and reconcile automatically; browser restarts require reindexing.
- TLS errors during npm install: repair your Node trust configuration. This environment used `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem npm ci`; do not disable certificate validation.

Design and implementation: [Product spec](docs/PRODUCT_SPEC.md), [Design system](docs/DESIGN_SYSTEM.md), [Architecture](docs/ARCHITECTURE.md), [Privacy](docs/PRIVACY.md), [Testing and limitations](docs/TESTING.md).
