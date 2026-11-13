# Product specification

## Journey and scope

Chrome desktop, current profile, normal windows: command/icon → immediate input → ranked title/URL/body results → window/tab activation → selected-passage scroll/highlight, or native PDF page navigation. One result per tab with document-order passage previews. The empty-input Recent tabs disclosure lists six tabs by activation recency, then Chrome lastAccessed, then tab ID. Recency is session-scoped and reconciled with open tabs. No accounts, network search, history, bookmarks, AI, dashboard, or sync. Incognito disabled.

## Interaction

Suggested shortcut Control+Space on Mac (manifest MacCtrl+Space), Ctrl+Shift+Space on Windows/default; assignment may conflict and is not guaranteed. Change at chrome://extensions/shortcuts. Reinvoke refocuses, never duplicates. Arrow keys select, Enter jumps, Escape closes/restores focus. IME and normal editing remain native. Newest request alone may render. Settings remains within palette, with immediate Appearance saving, visible current-shortcut setup, and separate disclosures for access, exclusions and local data. Restricted pages use an extension-owned popup window.

## Support

Top-level rendered HTTP(S) DOM text, including below viewport; scripts/styles/forms/editable/hidden regions omitted. No cross-origin frames, closed/open shadow tree traversal, unloaded/virtualized text, canvas, images/OCR, unsupported PDFs, browser-internal pages, Web Store protected pages, file pages, or incognito. Restricted and unpermitted tabs retain metadata. Discarded tabs are never woken automatically; the coverage details offer an explicit Load and search this tab action. Their prior content is removed and metadata is labeled unavailable. Loaded content capped at 60,000 UTF-16 units and 20,000 visited text nodes; truncation labeled. Whole-index cap 2,000,000 text units, oldest bodies evicted to metadata-only.

## Acceptance

1. npm ci && npm run check && npm run build produces a loadable MV3 dist.
2. Multiword AND query with title/URL absent finds a real body passage.
3. Actual Chrome exercises input, keyboard, overlay/fallback, cross-window activation and highlight.
4. Permission changes/navigation/closures reconcile before search; worker restart recovers session records.
5. Exclusion/revocation/clear cannot be undone by late extraction. Clear pauses until Resume, retains preferences.
6. System/light/dark, reduced motion, focus containment and narrow viewport follow design system.
7. Tests, benchmark methodology and unverified manual checks are recorded honestly.

Search uses canonical Unicode forms, explicit relaxed whole-token aliases and shared Intl word/grapheme analysis. Chinese/Japanese/Thai source-substring verification handles contextual segmentation. Exact/canonical > relaxed > prefix > English variant > typo evidence; English approximation requires an explicit content hint and is disabled for unknown language and URLs. Field weights remain title 3, body 2, URL 1. All terms are required across fields; recency and ID break relevance ties. Existing query/result/extraction bounds remain. The interface ships English via Chrome localization and handles RTL content in isolated regions. The authoritative policy, feature-by-language validation and limitations are in [MULTILINGUAL.md](MULTILINGUAL.md).

Passages favor distinct terms, then adjacent query-order phrases, then tighter proximity, then earliest source position. Evidence uses original Unicode offsets and at most 240 source units plus clipping markers. Metadata-only matches show title/URL without unrelated body evidence. Navigation locates the selected exact passage nearest its original offset, with bounded DOM work; it never substitutes an unrelated query-word occurrence. Changed results still activate their tab and receive destination feedback. Injection-prohibited pages use a temporary extension-action badge/title. Successful activation closes the original palette.

Exact/prefix candidates remain visible while additional conservative English variation and typo candidates appear in a lower-priority Approximate matches group, one row per tab. Quoted phrases have literal normalized contiguous-word semantics; mixed components use AND. See README for precise query bounds and unsupported language behavior. Passage-level labels identify matched wording even when an exact tab also contains approximate passages.

Filters combine before result limits: This window captures the invoking browser window even for fallback; Page text requires every query term in the body; Website parses a hostname, includes real subdomains by default, and offers Exact host. Invalid host input produces a filtered-empty state. IDNs use URL hostname conversion. Filters are scoped to the palette session and can be cleared without clearing the query. A header button reveals their controls; active filters remain visible as removable chips. Escape dismisses the current filter/coverage panel before closing search. A Clear search button resets the query without clearing filters.

Coverage details distinguish permission missing/withheld (Chrome cannot tell those apart through contains), exclusion, sleeping tab, known restrictions/unsupported MIME type, pending extraction, failed extraction, stale text, budget eviction, extraction caps, and pause. Unknown injection failure is reported as failed or unsupported rather than inventing a cause. Recovery requests revalidate URL, permission, pause and exclusion; per-tab retries have a 30-second cooldown. Budget/failure records are not automatically refreshed. Clearing removes body text and pauses indexing while metadata search remains available.

First-open access: show a one-time inline explanation with an all-websites button and metadata-only alternative. Request access only on button activation. Remember grant, deny, or skip; never repeatedly request new-site permission after an all-websites grant. Existing all-site grants bypass the explanation; later changes belong in Settings.

Shortcut defaults apply to new installs only; existing assignments are managed through Chrome’s shortcuts UI. Settings displays the actual registered assignment. Invocation is scoped to Chrome being focused. macOS input-source shortcuts can take priority; no OS shortcuts are disabled by TabScope.

Overlay dismissal: a primary pointer press and release on the backdrop closes search or Settings, restores previous page focus, and consumes the gesture. Inside clicks and dragging from inside to outside do not dismiss. Escape remains available. This is page-backdrop behavior, not an OS-wide outside-window listener.

Opening the palette uses compact title/site rows. Keyword queries reveal two-line snippets from the indexed text. Content rows omit redundant Content labels; Partial text indicates capped body content, Title & URL marks metadata-only records, and the footer reports Page text · X of Y tabs. Long titles and URLs have native hover tooltips. Selected rows include a return-key hint alongside aria-selected.

## Passage and PDF acceptance

README is authoritative for new passage/query/PDF limits. Passage previews do not activate tabs, reset list scroll or steal input focus; Enter opens the current preview. Native buttons have disabled endpoints. A group counts passages, never occurrences. Empty query offers a compact Recent tabs disclosure. HTML destinations get a dismissible Previous/Next navigator; PDF destinations get page navigation without a text-highlight promise. Coverage and failures remain actionable without broadening optional permissions. Native viewer reload and conservative PDF layout/morphology limits are disclosed.
