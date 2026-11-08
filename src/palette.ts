import {
  shouldExplainAccess,
  dismissAccessExplanation,
  allowAllWebsites,
} from "./access";
import { BRAND } from "./brand";
import {
  normalizeHost,
  type Hit,
  type SearchResponse,
  type Preferences,
} from "./types";
import { normalize, tokenize, snippet as sourceSnippet } from "./search";
const overlay =
  location.pathname.endsWith("/overlay.html") ||
  new URLSearchParams(location.search).has("overlay");
if (overlay) {
  document.documentElement.classList.add("overlay");
  document.body.classList.add("overlay");
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
) {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}
async function request<T>(message: Record<string, unknown>): Promise<T> {
  const data = await chrome.runtime.sendMessage(message);
  if (data?.error) throw Error(data.error);
  return data as T;
}
const dialog = el("dialog");
dialog.setAttribute("aria-label", BRAND);
const top = el("div", "top");
const logo = el("span", "logo");
const searchGlyph = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "svg",
);
searchGlyph.setAttribute("viewBox", "0 0 24 24");
searchGlyph.setAttribute("fill", "none");
searchGlyph.setAttribute("stroke", "currentColor");
searchGlyph.setAttribute("stroke-width", "1.7");
searchGlyph.setAttribute("stroke-linecap", "round");
const lens = document.createElementNS("http://www.w3.org/2000/svg", "circle");
lens.setAttribute("cx", "10.5");
lens.setAttribute("cy", "10.5");
lens.setAttribute("r", "6.5");
const handle = document.createElementNS("http://www.w3.org/2000/svg", "path");
handle.setAttribute("d", "m15.5 15.5 4.5 4.5");
searchGlyph.append(lens, handle);
logo.append(searchGlyph);
logo.setAttribute("aria-hidden", "true");
const input = el("input", "field");
input.placeholder = "Search your open tabs…";
input.maxLength = 500;
input.setAttribute("aria-label", "Search open tabs");
input.setAttribute("role", "combobox");
input.setAttribute("aria-autocomplete", "list");
input.setAttribute("aria-controls", "results");
input.setAttribute("aria-expanded", "true");
input.autocomplete = "off";
input.spellcheck = false;
const exit = el("button", "close");
exit.setAttribute("aria-label", "Close search");
exit.append(el("kbd", "", "esc"));
top.append(logo, input, exit);
const accessPrompt = el("section", "access-prompt");
accessPrompt.hidden = true;
accessPrompt.setAttribute("aria-labelledby", "access-heading");
const accessHeading = el("strong", "", "Search inside your tabs");
accessHeading.id = "access-heading";
const accessActions = el("div", "actions");
accessActions.append(
  button("Allow all websites", chooseAllWebsites),
  button("Titles & URLs only", async () => {
    await dismissAccessExplanation();
    hideAccessExplanation();
    input.focus();
  }),
);
accessPrompt.append(
  accessHeading,
  el(
    "p",
    "",
    "Allow website access once to search readable text across your open tabs, including new sites. This can include sensitive text. Search stays on your device. You can change access in Settings.",
  ),
  accessActions,
);
const list = el("ul", "list");
list.id = "results";
list.setAttribute("role", "listbox");
list.setAttribute("aria-label", "Matching tabs");
const state = el("div", "state");
const settings = el("section", "settings");
settings.hidden = true;
const alert = el("div", "notice");
alert.setAttribute("role", "alert");
alert.hidden = true;
const footer = el("footer");
const coverage = el("button", "coverage quiet", "Reading open tabs…");
coverage.setAttribute("aria-expanded", "false");
const coverageDetails = el("section", "coverage-details");
coverageDetails.hidden = true;
coverageDetails.id = "coverage-details";
coverageDetails.setAttribute("aria-label", "Page text coverage and recovery");
coverage.setAttribute("aria-controls", coverageDetails.id);
coverage.onclick = () => {
  coverageDetails.hidden = !coverageDetails.hidden;
  coverage.setAttribute("aria-expanded", String(!coverageDetails.hidden));
};
const filterBar = el("details", "filters");
const filterSummary = el("summary", "", "Filters");
const filterControls = el("div", "filter-controls");
const windowFilter = el("input");
windowFilter.type = "checkbox";
const bodyFilter = el("input");
bodyFilter.type = "checkbox";
const exactFilter = el("input");
exactFilter.type = "checkbox";
const domainFilter = el("input");
domainFilter.placeholder = "example.com";
domainFilter.maxLength = 253;
domainFilter.setAttribute(
  "aria-label",
  "Website hostname (includes subdomains unless Exact host is selected)",
);
function checkbox(input: HTMLInputElement, text: string) {
  const label = el("label", "filter-check");
  label.append(input, text);
  return label;
}
function clearFilters() {
  windowFilter.checked = bodyFilter.checked = exactFilter.checked = false;
  domainFilter.value = "";
  input.focus();
  void update();
}
filterControls.append(
  checkbox(windowFilter, "This window"),
  checkbox(bodyFilter, "Page text"),
  domainFilter,
  checkbox(exactFilter, "Exact host"),
  button("Clear filters", async () => clearFilters()),
);
filterBar.append(filterSummary, filterControls);
const filters = () => ({
  thisWindow: windowFilter.checked,
  pageText: bodyFilter.checked,
  domain: domainFilter.value.trim(),
  exactHost: exactFilter.checked,
});
const activeFilters = () =>
  windowFilter.checked || bodyFilter.checked || !!domainFilter.value.trim();
for (const control of [windowFilter, bodyFilter, exactFilter, domainFilter])
  control.addEventListener("input", (event) => {
    if (!(event instanceof InputEvent) || !event.isComposing) void update();
  });
domainFilter.addEventListener("compositionend", () => {
  void update();
});
const hints = el("span", "hint");
hints.append(el("kbd", "", "↑↓"), " select  ", el("kbd", "", "↵"), " jump");
const settingsButton = el("button", "quiet", "Settings");
const live = el("span", "sr");
live.setAttribute("aria-live", "polite");
footer.append(coverage, hints, settingsButton);
dialog.append(
  top,
  accessPrompt,
  filterBar,
  coverageDetails,
  list,
  state,
  settings,
  alert,
  footer,
  live,
);
document.body.append(dialog);
dialog.showModal();
input.focus();
let hits: Hit[] = [];
let selected = 0;
let sequence = 0;
let inSettings = false;
let composing = false;
let explainAccess = false;
let renderedQuery = "";
let coverageSignature = "";
function hideAccessExplanation() {
  explainAccess = false;
  accessPrompt.hidden = true;
}
async function chooseAllWebsites() {
  const granted = await allowAllWebsites();
  hideAccessExplanation();
  if (!granted)
    throw Error(
      "Website access was not granted. Titles and URLs still work. You can change access in Settings.",
    );
  alert.hidden = true;
  await request({ type: "refresh" });
  if (!inSettings) {
    input.focus();
    await update();
  }
}
const error = (e: unknown) => {
  alert.hidden = false;
  alert.textContent = e instanceof Error ? e.message : String(e);
};
async function close() {
  await request({ type: "close" }).catch(() => {});
  if (!overlay) window.close();
}
exit.onclick = () => {
  void close();
};
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  if (inSettings) {
    showSearch();
  } else void close();
});
// A native dialog retargets backdrop events to itself. Use viewport bounds,
// and require the press to start outside so dragging out of the input is safe.
if (overlay) {
  let outsidePointer: number | null = null;
  const isOutside = (event: MouseEvent) => {
    const box = dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  };
  document.addEventListener(
    "pointerdown",
    (event) => {
      outsidePointer =
        event.isPrimary && event.button === 0 && isOutside(event)
          ? event.pointerId
          : null;
    },
    true,
  );
  document.addEventListener(
    "pointercancel",
    () => {
      outsidePointer = null;
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      const dismiss =
        outsidePointer === event.pointerId &&
        event.button === 0 &&
        isOutside(event);
      outsidePointer = null;
      if (!dismiss) return;
      // Consume the outside release before removal; do not activate the page.
      event.preventDefault();
      event.stopImmediatePropagation();
      void close();
    },
    true,
  );
}
function select(index: number) {
  selected = Math.max(0, Math.min(index, hits.length - 1));
  [...list.children].forEach((row, i) =>
    row.setAttribute("aria-selected", String(i === selected)),
  );
  if (hits.length) {
    input.setAttribute("aria-activedescendant", "hit-" + hits[selected].id);
    list.children[selected]?.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}
function highlighted(text: string, query: string) {
  const frag = document.createDocumentFragment();
  const terms = tokenize(query);
  const segments = text.split(/([\p{L}\p{N}\p{M}]+)/u);
  for (const s of segments) {
    if (terms.some((t) => normalize(s).startsWith(t)))
      frag.append(el("mark", "", s));
    else frag.append(document.createTextNode(s));
  }
  return frag;
}
async function activate() {
  const hit = hits[selected];
  if (!hit) return;
  try {
    await request<{ activated?: boolean }>({
      type: "navigate",
      id: hit.id,
      query: input.value,
      url: hit.url,
      updated: hit.updated,
      filters: filters(),
    });
    await close();
  } catch (e) {
    error(e);
    void update();
  }
}
function render(response: SearchResponse) {
  const priorId =
    renderedQuery === input.value ? hits[selected]?.id : undefined;
  renderedQuery = input.value;
  hits = response.hits;
  if (priorId !== undefined && hits.some((h) => h.id === priorId))
    selected = hits.findIndex((h) => h.id === priorId);
  list.replaceChildren();
  const hasQuery = tokenize(input.value).length > 0;
  const stateLabels: Record<Hit["state"], string> = {
    content: "",
    "metadata-only": "Title & URL",
    indexing: "Indexing",
    unavailable: "Unavailable",
    stale: "Stale text",
    excluded: "Excluded",
  };
  for (const [i, h] of hits.entries()) {
    const row = el("li", "row");
    row.id = "hit-" + h.id;
    row.setAttribute("role", "option");
    let host = "";
    try {
      host = new URL(h.url).hostname || h.url;
    } catch {
      host = h.url;
    }
    const icon = el("span", "site", (host[0] || "↗").toUpperCase());
    icon.setAttribute("aria-hidden", "true");
    const copy = el("div", "copy");
    const title = el("div", "title");
    title.title = h.title;
    title.append(
      highlighted(h.title, h.matchedTerms?.join(" ") ?? input.value),
    );
    const label = stateLabels[h.state];
    const meta = el(
      "div",
      "meta",
      [
        host,
        h.approximate ? "Close match" : "",
        label,
        h.truncated && (h.state === "content" || h.state === "stale")
          ? "Partial text"
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    meta.title = h.url;
    copy.append(title, meta);
    const urlEvidence =
      hasQuery && !h.snippet
        ? sourceSnippet(h.url, h.matchedTerms?.join(" ") ?? input.value)
        : "";
    if (hasQuery && (h.snippet || urlEvidence)) {
      const snippet = el("p", "snippet");
      snippet.append(
        highlighted(
          h.snippet || "URL · " + urlEvidence,
          h.matchedTerms?.join(" ") ?? input.value,
        ),
      );
      copy.append(snippet);
    }
    const actionHint = el("span", "row-action", "↵");
    actionHint.setAttribute("aria-hidden", "true");
    row.append(icon, copy, actionHint);
    row.onpointermove = () => {
      if (selected !== i) select(i);
    };
    row.onclick = () => {
      select(i);
      void activate();
    };
    list.append(row);
  }
  state.hidden = hits.length > 0;
  state.replaceChildren(
    el(
      "strong",
      "",
      activeFilters()
        ? "No tabs match these filters"
        : input.value
          ? "No matching tabs"
          : "No open tabs to search",
    ),
    el(
      "span",
      "",
      input.value
        ? "Try different words. Only permitted, loaded text is searched."
        : "Open a website, then return here.",
    ),
  );
  if (activeFilters())
    state.append(button("Clear filters", async () => clearFilters()));
  filterSummary.textContent =
    "Filters" +
    (activeFilters()
      ? ` · ${[windowFilter.checked && "This window", bodyFilter.checked && "Page text", domainFilter.value.trim() && domainFilter.value.trim() + (exactFilter.checked ? " (exact)" : " + subdomains")].filter(Boolean).join(" · ")}`
      : "");
  const nextCoverage = JSON.stringify([response.coverage, response.paused]);
  if (nextCoverage !== coverageSignature) {
    coverageSignature = nextCoverage;
    const restoreCoverageFocus = coverageDetails.contains(
      document.activeElement,
    );
    coverageDetails.replaceChildren(
      el("strong", "", "Page text coverage"),
      el(
        "p",
        "",
        "Only loaded, permitted page text is searched. Unloaded sections, frames, PDFs and images are not included.",
      ),
    );
    const descriptions = {
      permission: "Website access missing or withheld",
      excluded: "Excluded by you",
      sleeping: "Sleeping tab",
      restricted: "Browser-restricted or unsupported page",
      indexing: "Indexing in progress",
      failure: "Text extraction failed or is unsupported",
      stale: "Previously indexed text may be out of date",
      budget: "Text removed to keep the local index bounded",
      partial: "Partial text — page extraction limit reached",
      paused: "Indexing paused",
      ready: "Page text searchable",
      empty: "No readable page text found",
    };
    const entries = response.coverage ?? [];
    const summary = new Map<string, number>();
    for (const entry of entries)
      summary.set(entry.reason, (summary.get(entry.reason) ?? 0) + 1);
    coverageDetails.append(
      el(
        "p",
        "",
        [...summary]
          .map(
            ([reason, count]) =>
              `${count} · ${descriptions[reason as keyof typeof descriptions]}`,
          )
          .join("; "),
      ),
    );
    if (response.paused)
      coverageDetails.append(
        button("Resume indexing", async () => {
          await request({ type: "resume" });
          await update();
        }),
      );
    // Details remain bounded even with many open tabs; choose a result's domain filter to narrow.
    for (const entry of entries
      .filter((e) => e.reason !== "ready")
      .slice(0, 100)) {
      const row = el("div", "coverage-row");
      row.append(
        el(
          "span",
          "",
          `${entry.title || entry.url} · ${descriptions[entry.reason]}`,
        ),
      );
      const recover = async (action: string) => {
        await request({
          type: "recover",
          id: entry.id,
          url: entry.url,
          action,
        });
        await update();
      };
      if (entry.reason === "permission")
        row.append(
          button("Allow this site", async () => {
            const u = new URL(entry.url);
            const granted = await chrome.permissions.request({
              origins: [u.protocol + "//" + u.hostname + "/*"],
            });
            if (!granted)
              throw Error(
                "Access was not granted. Titles and URLs still work.",
              );
            await request({ type: "refresh" });
            await update();
          }),
        );
      if (entry.reason === "excluded")
        row.append(button("Include this site", async () => recover("include")));
      if (entry.reason === "sleeping")
        row.append(
          button("Load and search this tab", async () => {
            await recover("load");
            await close();
          }),
        );
      if (["failure", "budget", "stale"].includes(entry.reason))
        row.append(button("Retry page text", async () => recover("retry")));
      coverageDetails.append(row);
    }
    if (entries.filter((e) => e.reason !== "ready").length > 100)
      coverageDetails.append(
        el(
          "p",
          "",
          "Showing the first 100 tabs needing attention. Use the window or website filters to narrow the list.",
        ),
      );
    if (restoreCoverageFocus) coverage.focus();
  }
  coverage.textContent = response.paused
    ? "Indexing paused"
    : `Page text · ${response.searchable} of ${response.total} tabs${response.indexing ? " · Indexing…" : ""}`;
  const announcement = `${hits.length} ${hits[0]?.approximate ? "close matches" : "results"}.`;
  if (live.textContent !== announcement) live.textContent = announcement;
  document.documentElement.dataset.theme = response.theme;
  select(Math.min(selected, hits.length - 1));
}
async function update() {
  if (inSettings || composing) return;
  const version = ++sequence;
  try {
    const response = await request<SearchResponse>({
      type: "search",
      query: input.value,
      filters: filters(),
    });
    if (version === sequence && !inSettings) render(response);
  } catch (e) {
    if (version === sequence) error(e);
  }
}
input.oninput = () => {
  selected = 0;
  alert.hidden = true;
  void update();
};
input.addEventListener("compositionstart", () => {
  composing = true;
});
input.addEventListener("compositionend", () => {
  composing = false;
  void update();
});
input.onkeydown = (e) => {
  if (e.isComposing || composing) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    select(selected + (e.key === "ArrowDown" ? 1 : -1));
  } else if (e.key === "Enter") {
    e.preventDefault();
    void activate();
  }
};
function showSearch() {
  inSettings = false;
  filterBar.hidden = false;
  accessPrompt.hidden = !explainAccess;
  settings.hidden = true;
  list.hidden = false;
  top.hidden = false;
  state.hidden = hits.length > 0;
  settingsButton.hidden = false;
  input.focus();
  void update();
}
function button(text: string, fn: () => Promise<unknown>) {
  const b = el("button", "", text);
  b.onclick = () => {
    void fn().catch(error);
  };
  return b;
}
async function showSettings() {
  inSettings = true;
  filterBar.hidden = true;
  coverageDetails.hidden = true;
  coverage.setAttribute("aria-expanded", "false");
  accessPrompt.hidden = true;
  ++sequence;
  list.hidden = true;
  state.hidden = true;
  top.hidden = true;
  settings.hidden = false;
  settingsButton.hidden = true;
  settings.replaceChildren();
  try {
    const p = await request<Preferences>({ type: "settings" });
    const back = button("← Back to search", async () => showSearch());
    back.className = "back";
    settings.append(back, el("h2", "", BRAND + " settings"));
    const theme = el("select");
    theme.id = "theme";
    for (const t of ["system", "light", "dark"]) {
      const option = el("option", "", t[0].toUpperCase() + t.slice(1));
      option.value = t;
      theme.append(option);
    }
    theme.value = p.theme;
    const themeLabel = el("label", "", "Appearance");
    themeLabel.htmlFor = theme.id;
    settings.append(themeLabel, theme);
    settings.append(
      el("label", "", "Website access"),
      el(
        "p",
        "",
        "Page contents stay on this device. Access is optional: titles and URLs remain searchable without it. All-site access allows reading sensitive readable text across your open websites.",
      ),
    );
    const origin = el("input");
    origin.id = "site-access";
    origin.placeholder = "example.com";
    origin.setAttribute("aria-label", "Website hostname for access");
    settings.append(origin, el("div", "actions"));
    const access = el("div", "actions");
    access.append(
      button("Allow this site", async () => {
        const host = normalizeHost(origin.value.trim());
        if (!host) throw Error("Enter a hostname, for example example.com");
        const granted = await chrome.permissions.request({
          origins: ["https://" + host + "/*", "http://" + host + "/*"],
        });
        if (!granted)
          throw Error(
            "Access was not granted. Metadata search is still available.",
          );
        await request({ type: "refresh" });
      }),
      button("Allow all websites", chooseAllWebsites),
      button("Revoke website access", async () => {
        const all = await chrome.permissions.getAll();
        if (all.origins?.length)
          await chrome.permissions.remove({ origins: all.origins });
        await request({ type: "refresh" });
      }),
    );
    settings.append(access);
    const exclusions = el("textarea");
    exclusions.id = "exclusions";
    exclusions.value = p.exclusions.join("\n");
    const exclusionLabel = el("label", "", "Excluded sites");
    exclusionLabel.htmlFor = exclusions.id;
    settings.append(
      exclusionLabel,
      el(
        "p",
        "",
        "One hostname per line. example.com includes all subdomains; sub.example.com includes only itself and its subdomains. Saving removes matching indexed text immediately.",
      ),
      exclusions,
      button("Save preferences", async () => {
        const raw = exclusions.value
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        const hosts = raw.map(normalizeHost);
        if (hosts.some((h) => !h))
          throw Error("Use hostnames only, without paths or wildcards.");
        await request({
          type: "save",
          theme: theme.value,
          exclusions: [...new Set(hosts)],
        });
        document.documentElement.dataset.theme = theme.value;
        alert.hidden = true;
      }),
    );
    settings.append(
      el("label", "", "Local data"),
      el(
        "p",
        "",
        "Extracted text is held for this browser session. Clearing removes text and pauses indexing until you resume. Theme and exclusions are retained.",
      ),
    );
    const data = el("div", "actions");
    data.append(
      button("Clear data & pause", async () => {
        await request({ type: "clear" });
        coverage.textContent = "Indexing paused";
        alert.hidden = true;
      }),
      button("Resume indexing", async () => {
        await request({ type: "resume" });
        coverage.textContent = "Indexing…";
      }),
    );
    const shortcut = (await chrome.commands.getAll()).find(
      (command) => command.name === "open-search",
    )?.shortcut;
    settings.append(
      data,
      el("label", "", "Keyboard shortcut"),
      el(
        "p",
        "",
        `Current shortcut: ${shortcut || "Not assigned"}. Suggested: Control+Space (⌃Space) on Mac; Ctrl+Shift+Space on Windows. Works while Chrome is focused. Change it at chrome://extensions/shortcuts. macOS may reserve Control+Space for input sources; choose another shortcut there if needed.`,
      ),
      el(
        "p",
        "",
        "Only loaded, permitted top-level website text is searched. PDFs, browser pages, embedded frames, images and unloaded content are not content-searchable.",
      ),
    );
    back.focus();
  } catch (e) {
    error(e);
  }
}
settingsButton.onclick = () => {
  void showSettings();
};
void shouldExplainAccess()
  .then((show) => {
    explainAccess = show;
    accessPrompt.hidden = inSettings || !show;
  })
  .catch(error);
void request({ type: "refresh" }).then(update).catch(error);
const polling = setInterval(() => {
  if (!document.hidden && !inSettings) void update();
}, 2000);
window.addEventListener("pagehide", () => clearInterval(polling));

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "index-invalidated")
    return;
  ++sequence;
  hits = [];
  selected = 0;
  list.replaceChildren();
  input.removeAttribute("aria-activedescendant");
  if (!inSettings) void update();
});

// The handshake originates only after the actual modal and input are usable.
if (overlay) {
  const invocation = new URLSearchParams(location.search).get("invocation");
  if (invocation)
    requestAnimationFrame(() => {
      if (dialog.open && input.isConnected)
        void request({ type: "overlay-ready", invocation }).catch(error);
    });
}
const destinationNotice = new URLSearchParams(location.search).get("notice");
if (destinationNotice) error(destinationNotice.slice(0, 200));
window.addEventListener("focus", () => {
  if (!inSettings) input.focus();
});
