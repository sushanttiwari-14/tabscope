# Privacy and security

TabScope has no accounts, backend, analytics, tracking, remote AI, cloud index, or external favicon/font services. Executable code is bundled locally. Neutral site initials avoid favicon network requests. Incognito is disabled.

## Website access

`tabs` provides title/URL metadata and tab coordination, not DOM permission. `scripting` runs local extraction and the overlay agent. `storage` holds preferences/index; `activeTab` provides temporary access after invocation. Optional HTTP/HTTPS website access can be granted to a hostname through Settings, to all websites, or through Chrome's extension site controls. All-site access allows reading sensitive readable text in open websites. ActiveTab cannot automatically search other tabs. Denial leaves metadata search usable. Revoke Website Access removes optional grants; Chrome's own controls allow partial grants and withholding.

## Data and lifetime

Only tab ID/window ID, current URL/title, up to 60,000 UTF-16 units of readable text, coverage/status/truncation, content/indexing timestamps, an optional validated document language hint and session activation recency are retained. Total text budget is 2,000,000 units, roughly 4MB before metadata/index overhead. Oldest body records are evicted to metadata. Page text and records are held in `storage.session`, restricted to trusted extension contexts. They survive service-worker suspension but clear on browser restart, extension disable/reload/update. Chrome may implement memory backing internally; this is not secure erasure or an encryption guarantee. Preferences (theme, exclusions, paused state) persist in local storage. No sync is used.

Closure, navigation and revocation remove obsolete text. Generation checks stop late extraction responses restoring removed text. Queries reconcile URLs and permissions before returning results. A worker wake reconciles session records; tab IDs are never persisted across browser sessions. Content may be stale between a DOM mutation and the debounced reindex (at least 1.5 seconds, at most one request per 5 seconds). Extractions already running finish before a queued deletion completes, but cannot commit after an invalidating generation change. Discarded tabs are never woken automatically; loading one is a deliberate recovery action. Recency tracks only currently open tab IDs for this browser session, not visited URLs or closed-tab history. The fallback popup also keeps its invoking window ID in session storage so filtering survives worker suspension.

## Exclusions and clearing

`example.com` matches itself and all subdomains, never `notexample.com` or `example.com.evil.org`. `docs.example.com` does not exclude its parent. Hostnames are case-insensitive, converted by URL parsing (including IDN punycode); paths, ports, credentials and wildcards are rejected. Saving exclusions immediately drops matching text; excluded tabs can retain title/URL metadata.

Clear Data & Pause deletes records/text, resets the in-memory search index, and invalidates snippets in open UI instances. Indexing remains paused until explicit Resume; theme/exclusions stay. Current open-tab metadata is reconciled again so title/URL search stays usable while paused. No body text is recreated. Session-only open-tab recency and the fallback window context may be retained. Removed data is not recoverable through TabScope. Session disappearance on browser restart does not clear a saved paused preference.

## Extraction boundaries

Form values, password fields, contenteditable regions, scripts, styles, hidden content and TabScope UI are excluded. Ordinary readable text may still contain medical, financial, personal or business information. Filtering forms does not make text non-sensitive. Loaded, top-level HTTP(S) DOM text and supported HTTP(S) text PDFs are supported. No embedded frames, shadow tree traversal, virtualized/unloaded text, image/OCR/canvas, browser-internal page content. Supported HTTP(S) PDF text is extracted locally as described below. A malicious page can put text in arbitrary DOM structures or change its content after extraction.

## Trust boundaries

The worker owns data. Content agents only report dirty state; privileged UI messages require an exact extension URL and runtime ID. Dirty messages require extension sender, top frame, tab and matching URL. Requests validate type/shape/length and selected tab identity. Extracted HTML is never rendered: titles/snippets use textContent and constructed text nodes. Index values and page text are not logged. An extension-origin iframe holds the palette inside Shadow DOM. Shadow DOM isolates styles, not confidentiality: a host page can observe focus/keys outside the iframe, remove/cover the overlay or spoof surrounding UI. Use extension Options/fallback window on untrusted pages. The extension has no external messaging or page postMessage API and does not send the full index to content scripts.

## Remaining limits

No cryptographic deletion guarantee. Memory/search-library copies are reclaimed by JavaScript garbage collection, whose timing is outside the extension's control. Exclusion changes cannot remove information already copied by the user or captured outside the extension. CSS Highlight is non-destructive and retained until an outside page click, dismissal, reopening, or document navigation; unrelated page updates preserve navigation, but site styles/content changes can interfere. Permission prompts and browser security controls are owned by Chrome.

## First-open explanation

On first opening the palette, a compact explanation offers an all-websites grant or titles/URLs-only search. A permission request occurs only from the grant button’s user gesture; nothing is granted by default. Grant, denial, or metadata-only choice saves a local `contentAccessExplained` flag so it does not recur. Existing all-site grants suppress the explanation. Chrome retains the actual website permissions. The explanation flag is retained by Clear Data alongside other preferences.

## PDF fetch and retained data (2026-11-09)

PDF support makes bounded HEAD/GET requests to the already-open source URL, using existing optional host permission and ordinary browser credentials. These requests may reach the source site's logs or consume a signed link. No uploads, parsing service, telemetry or backend is involved. Redirects are refused; permission is never expanded automatically. POST-only, non-repeatable, blob/file/internal and download-only workflows are unsupported. Error statuses include authentication failure; TabScope cannot unlock protected documents.

A local offscreen worker holds at most one 12 MiB PDF download transiently, then destroys the parser. No PDF binary is written to session/local storage. Only bounded text, fingerprint, source URL, physical page offsets, printed labels and coverage remain in trusted-context session storage under schema 3. Pause/clear/exclusion/revocation cancel work and reject stale page commits. Restarted workers close orphan jobs before recovery. Clearing text also drops PDF page metadata and dismisses destination highlights/navigators. Ordinary metadata-only tab search remains available. PDF page jumps reload the existing native reader and can reset unsaved annotations; no annotation data is read or retained by TabScope.

## Multilingual analysis

Language hints come from the page lang attribute and are not detected remotely. Canonical/relaxed forms, token positions and grapheme projections are bounded derived memory rebuilt on worker recovery, never a permanent page-body store. Analysis policy version is recorded in session state. English UI catalog strings contain no source titles, URLs, browsing text or queries. No cloud language detection, translation, dictionaries, analytics, accounts or additional fetch endpoints were added. Display-only bidi sanitization does not modify source content or the webpage.
