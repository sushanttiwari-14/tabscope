# Privacy and security

TabScope has no accounts, backend, analytics, tracking, remote AI, cloud index, or external favicon/font services. Executable code is bundled locally. Neutral site initials avoid favicon network requests. Incognito is disabled.

## Website access

`tabs` provides title/URL metadata and tab coordination, not DOM permission. `scripting` runs local extraction and the overlay agent. `storage` holds preferences/index; `activeTab` provides temporary access after invocation. Optional HTTP/HTTPS website access can be granted to a hostname through Settings, to all websites, or through Chrome's extension site controls. All-site access allows reading sensitive readable text in open websites. ActiveTab cannot automatically search other tabs. Denial leaves metadata search usable. Revoke Website Access removes optional grants; Chrome's own controls allow partial grants and withholding.

## Data and lifetime

Only tab ID/window ID, current URL/title, up to 60,000 UTF-16 units of readable text, status/truncation and update time are retained. Total text budget is 2,000,000 units, roughly 4MB before metadata/index overhead. Oldest body records are evicted to metadata. Page text and records are held in `storage.session`, restricted to trusted extension contexts. They survive service-worker suspension but clear on browser restart, extension disable/reload/update. Chrome may implement memory backing internally; this is not secure erasure or an encryption guarantee. Preferences (theme, exclusions, paused state) persist in local storage. No sync is used.

Closure, navigation and revocation remove obsolete text. Generation checks stop late extraction responses restoring removed text. Queries reconcile URLs and permissions before returning results. A worker wake reconciles session records; tab IDs are never persisted across browser sessions. Content may be stale between a DOM mutation and the debounced reindex (at least 1.5 seconds, at most one request per 5 seconds). Extractions already running finish before a queued deletion completes, but cannot commit after an invalidating generation change. Closed/discarded tabs are never woken for indexing.

## Exclusions and clearing

`example.com` matches itself and all subdomains, never `notexample.com` or `example.com.evil.org`. `docs.example.com` does not exclude its parent. Hostnames are case-insensitive, converted by URL parsing (including IDN punycode); paths, ports, credentials and wildcards are rejected. Saving exclusions immediately drops matching text; excluded tabs can retain title/URL metadata.

Clear Data & Pause deletes records/text, resets the in-memory search index, and invalidates snippets in open UI instances. Indexing and search remain paused until explicit Resume; theme/exclusions stay. While paused no metadata index is recreated. Removed data is not recoverable through TabScope. Session disappearance on browser restart does not clear a saved paused preference.

## Extraction boundaries

Form values, password fields, contenteditable regions, scripts, styles, hidden content and TabScope UI are excluded. Ordinary readable text may still contain medical, financial, personal or business information. Filtering forms does not make text non-sensitive. Only loaded, top-level HTTP(S) DOM text is supported. No embedded frames, shadow tree traversal, virtualized/unloaded text, image/OCR/canvas, built-in PDF reader or browser-internal page content. A malicious page can put text in arbitrary DOM structures or change its content after extraction.

## Trust boundaries

The worker owns data. Content agents only report dirty state; privileged UI messages require an exact extension URL and runtime ID. Dirty messages require extension sender, top frame, tab and matching URL. Requests validate type/shape/length and selected tab identity. Extracted HTML is never rendered: titles/snippets use textContent and constructed text nodes. Index values and page text are not logged. An extension-origin iframe holds the palette inside Shadow DOM. Shadow DOM isolates styles, not confidentiality: a host page can observe focus/keys outside the iframe, remove/cover the overlay or spoof surrounding UI. Use extension Options/fallback window on untrusted pages. The extension has no external messaging or page postMessage API and does not send the full index to content scripts.

## Remaining limits

No cryptographic deletion guarantee. Memory/search-library copies are reclaimed by JavaScript garbage collection, whose timing is outside the extension's control. Exclusion changes cannot remove information already copied by the user or captured outside the extension. CSS Highlight is non-destructive and removed after five seconds, but site styles/content changes can interfere. Permission prompts and browser security controls are owned by Chrome.

## First-open explanation

On first opening the palette, a compact explanation offers an all-websites grant or titles/URLs-only search. A permission request occurs only from the grant button’s user gesture; nothing is granted by default. Grant, denial, or metadata-only choice saves a local `contentAccessExplained` flag so it does not recur. Existing all-site grants suppress the explanation. Chrome retains the actual website permissions. The explanation flag is retained by Clear Data alongside other preferences.
