# Architecture

## Contexts and flow

MV3 service worker owns records, MiniSearch index and settings; synchronous top-level event registrations survive suspension. Extension-owned UI reused in a Shadow DOM iframe overlay and fallback popup window. Content agent only observes dirty state, manages overlay focus, and highlights; extraction is a locally bundled isolated-world function invoked by worker. No webpage postMessage bridge. Search responses go only to extension-origin documents, never arbitrary content scripts. Shadow DOM isolates styles, not host-page observation of interaction. All extracted data rendered with textContent.

## Permissions and API floor

Chrome 120 minimum: modern MV3 promises, storage.session (102+, 10MB since 112), trusted storage access controls, scripting and CSS Highlight support. APIs checked against official [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [commands](https://developer.chrome.com/docs/extensions/reference/api/commands), [permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) documentation on 2026-11-07.

Required tabs (metadata, not DOM access), scripting (execute local code), storage, activeTab (user-invoked overlay). Optional http://*/* and https://*/* requested only from Settings user gesture. activeTab alone cannot automatically read other tabs. No permissions named windows/commands/permissions; these namespaces do not require such declarations. Extension UI is a web-accessible iframe resource; privileged messages require exact extension document URL and runtime ID. Content dirty messages require own extension ID, top frame, tab identity, and matching URL. Content cannot request search/settings/navigation. Permission grants can be partial; contains checked per URL. Revocation purges bodies. Incognito not_allowed.

## Lifecycle and persistence

Version 1 records in storage.session (trusted contexts only), preferences in storage.local (trusted contexts only). Session records survive worker suspension, disappear on browser restart/extension reload, so tab IDs never cross browser sessions. Reconcile tab ID and exact URL on recovery and before searches. Navigation immediately increments per-tab generation and removes records through serialized operations. Each extraction checks generation, current URL, permission, exclusion and paused state before commit. Serialized writes prevent stale persistence races. Interactive requests take priority over queued extraction work; one in-progress bounded extraction completes first. Origin permission checks are deduplicated per reconciliation. Dirty observer is debounced 1500ms and throttled to 5s; extraction concurrency one; no DOM extraction on query. Queries reconcile metadata only. SPA routes trigger onUpdated plus dirty URL checks. No content data logs.

Whole-body cap 60k UTF-16 units/tab (roughly 120KB), 20k text nodes; aggregate 2M units (~4MB) leaves room under session quota. Oldest bodies lose text when over budget. MiniSearch adds in-memory overhead; benchmark is observational. A page can use more CPU for computed style; extraction deliberately bounded. No full scans on each mutation: observer sends dirty only, scans after debounce. Search index updated only for changed/removed records, rebuilt once from persisted records on recovery; never scans DOM on typing. MiniSearch chosen for AND/prefix/field weighting and small locally bundled implementation; no remote executable code.

## Message contracts

UI: {type:'search',query:string<=500}; {type:'navigate',id:number,query:string}; {type:'settings'}; {type:'save',theme:'system'|'light'|'dark',exclusions:string[]}; {type:'clear'|'resume'|'refresh'|'close'}. Content: {type:'dirty',url:string}. Worker-to-content: {type:'open'|'close'} or {type:'highlight',excerpt:string,query:string}. Responses use {error:string} or typed data; invalid sender/shape rejected. Page URL/title/text always untrusted; no innerHTML or remote assets. No full-index response API.

## Navigation and fallback

Activate window then tab independently of highlighting. Fresh injection attempts best effort range location over normalized whitespace across text nodes, using excerpt and query fallback; CSS Highlight API paints temporary non-destructive ranges. Missing passage yields inline warning and keeps palette open. Closed tab yields recovery error. Discarded tab activation is explicit user navigation; indexing never wakes it. Failed injection on invocation opens/reuses extension popup page. Existing overlay iframe refocuses. UI Escape message removes host and restores previous focus. Host can remove/obscure overlays; fallback accessible via extension options page as well.

## Shortcut defaults

Chrome’s [commands documentation](https://developer.chrome.com/docs/extensions/reference/api/commands) permits Space and requires `MacCtrl` to represent physical Control on macOS (`Ctrl` otherwise maps to Command). The Mac suggestion is `MacCtrl+Space`; Windows/default is `Ctrl+Shift+Space`. No global scope. Existing preferences must be changed in chrome://extensions/shortcuts, not through an API. Settings reads commands.getAll to show the actual assignment. OS shortcuts take priority. [Apple](https://support.apple.com/en-us/102650) documents Control+Space as an input-source shortcut; [Microsoft](https://support.microsoft.com/en-au/accessibility/windows/keyboard-shortcuts-in-windows) documents Ctrl+Space as a Chinese IME toggle. Windows uses the extra Shift modifier to avoid that specific toggle; compatibility is still subject to the user’s OS/apps/extensions.
