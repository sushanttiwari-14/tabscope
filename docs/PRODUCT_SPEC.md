# Product specification

## Journey and scope

Chrome desktop, current profile, normal windows: command/icon → immediate input → ranked title/URL/body results → window/tab activation → best effort scroll/highlight. One result per tab. Empty input lists tabs by tab ID. No accounts, network search, history, bookmarks, AI, dashboard, or sync. Incognito disabled.

## Interaction

Suggested shortcut Control+Space on Mac (manifest MacCtrl+Space), Ctrl+Shift+Space on Windows/default; assignment may conflict and is not guaranteed. Change at chrome://extensions/shortcuts. Reinvoke refocuses, never duplicates. Arrow keys select, Enter jumps, Escape closes/restores focus. IME and normal editing remain native. Newest request alone may render. Settings remains within palette. Restricted pages use an extension-owned popup window.

## Support

Top-level rendered HTTP(S) DOM text, including below viewport; scripts/styles/forms/editable/hidden regions omitted. No cross-origin frames, closed/open shadow tree traversal, unloaded/virtualized text, canvas, images/OCR, built-in PDFs, browser-internal pages, Web Store protected pages, file pages, or incognito. Restricted and unpermitted tabs retain metadata. Discarded tabs are never woken for indexing. Their prior content is removed and metadata is labeled unavailable. Loaded content capped at 60,000 UTF-16 units and 20,000 visited text nodes; truncation labeled. Whole-index cap 2,000,000 text units, oldest bodies evicted to metadata-only.

## Acceptance

1. npm ci && npm run check && npm run build produces a loadable MV3 dist.
2. Multiword AND query with title/URL absent finds a real body passage.
3. Actual Chrome exercises input, keyboard, overlay/fallback, cross-window activation and highlight.
4. Permission changes/navigation/closures reconcile before search; worker restart recovers session records.
5. Exclusion/revocation/clear cannot be undone by late extraction. Clear pauses until Resume, retains preferences.
6. System/light/dark, reduced motion, focus containment and narrow viewport follow design system.
7. Tests, benchmark methodology and unverified manual checks are recorded honestly.

Search Latin-space-delimited words (Unicode letters/numbers supported). Case/diacritics folded; prefixes accepted. No stemming or language segmentation for CJK. All terms required across fields. Body weight 2, title 3, URL 1; phrase match body boost 1.5; no additional distance/proximity boost; deterministic tab ID tie. Snippet uses actual indexed text around first query occurrence, emphasizing all matched terms. Navigation uses excerpt context, tolerates split nodes, and reports if passage changed.

First-open access: show a one-time inline explanation with an all-websites button and metadata-only alternative. Request access only on button activation. Remember grant, deny, or skip; never repeatedly request new-site permission after an all-websites grant. Existing all-site grants bypass the explanation; later changes belong in Settings.

Shortcut defaults apply to new installs only; existing assignments are managed through Chrome’s shortcuts UI. Settings displays the actual registered assignment. Invocation is scoped to Chrome being focused. macOS input-source shortcuts can take priority; no OS shortcuts are disabled by TabScope.

Overlay dismissal: a primary pointer press and release on the backdrop closes search or Settings, restores previous page focus, and consumes the gesture. Inside clicks and dragging from inside to outside do not dismiss. Escape remains available. This is page-backdrop behavior, not an OS-wide outside-window listener.
