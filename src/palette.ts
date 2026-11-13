import { t } from "./i18n";
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
import { tokenize, displayText } from "./analysis";
document.documentElement.dir = "ltr";
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
  e.textContent = displayText(text);
  if (["title", "snippet"].includes(className)) e.dir = "auto";
  return e;
}
function icon(name: "filters" | "settings" | "close" | "arrow") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.65");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const paths = {
    filters: ["M4 7h16M4 17h16M9 4v6M15 14v6"],
    settings: [
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
      "m10 3-.6 2-2 .9-1.9-.5-2 3.4L5 10.2v3.6l-1.5 1.4 2 3.4 1.9-.5 2 .9.6 2h4l.6-2 2-.9 1.9.5 2-3.4-1.5-1.4v-3.6l1.5-1.4-2-3.4-1.9.5-2-.9-.6-2z",
    ],
    close: ["m7 7 10 10M17 7 7 17"],
    arrow: ["M19 5v7a3 3 0 0 1-3 3H5m4-4-4 4 4 4"],
  };
  for (const d of paths[name]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
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
input.placeholder = t("search_tabs");
input.maxLength = 500;
input.setAttribute("aria-label", t("search_open_tabs"));
input.setAttribute("role", "combobox");
input.setAttribute("aria-autocomplete", "list");
input.setAttribute("aria-controls", "results");
input.setAttribute("aria-expanded", "false");
input.autocomplete = "off";
input.spellcheck = false;
const clearSearch = el("button", "icon-button clear-search");
clearSearch.setAttribute("aria-label", t("clear_search"));
clearSearch.title = t("clear_search");
clearSearch.hidden = true;
clearSearch.append(icon("close"));
clearSearch.onclick = () => {
  input.value = "";
  showRecent = false;
  selected = 0;
  input.focus();
  void update();
};
const exit = el("button", "close");
exit.setAttribute("aria-label", t("close_search"));
exit.append(el("kbd", "", "esc"));
top.append(logo, input, clearSearch, exit);
const accessPrompt = el("section", "access-prompt");
accessPrompt.hidden = true;
accessPrompt.setAttribute("aria-labelledby", "access-heading");
const accessHeading = el("strong", "", t("search_inside_your_tabs"));
accessHeading.id = "access-heading";
const accessActions = el("div", "actions");
accessActions.append(
  button(t("allow_all_websites"), chooseAllWebsites),
  button(t("titles_urls_only"), async () => {
    await dismissAccessExplanation();
    hideAccessExplanation();
    input.focus();
  }),
);
accessActions.firstElementChild?.classList.add("primary");
accessActions.lastElementChild?.classList.add("text-button");
accessPrompt.append(
  accessHeading,
  el("p", "", t("find_words_inside_pages_too_website_access_can_include")),
  accessActions,
);
const list = el("ul", "list");
list.id = "results";
list.setAttribute("role", "listbox");
list.setAttribute("aria-label", t("matching_tabs"));
const passageControls = el("div", "passage-controls");
passageControls.setAttribute("role", "group");
passageControls.setAttribute("aria-label", t("selected_tab_passages"));
passageControls.hidden = true;
const passageChoice = new Map<number, string>();
let showRecent = false;
const recentToggle = el("button", "quiet recent-toggle", t("recent_tabs"));
recentToggle.onclick = () => {
  showRecent = true;
  input.focus();
  void update();
};
function syncPassages() {
  const h = hits[selected];
  const ps = h?.passages ?? [];
  passageControls.hidden = ps.length < 2;
  const signature = JSON.stringify([
    h?.id,
    h?.passage?.id,
    ps.length,
    h?.passagesCapped,
  ]);
  if (passageControls.dataset.signature === signature) return;
  passageControls.dataset.signature = signature;
  const focused = passageControls.contains(document.activeElement)
    ? document.activeElement?.textContent
    : undefined;
  passageControls.replaceChildren();
  if (ps.length < 2) return;
  const index = ps.findIndex((p) => p.id === h.passage?.id);
  const change = (delta: number) => {
    const next = ps[index + delta];
    if (!next) return;
    passageChoice.set(h.id, next.id);
    const current = hits[selected];
    if (current?.id !== h.id) return;
    current.passage = next;
    current.snippet = next.text;
    const snippet = list
      .querySelectorAll(".row")
      .item(selected)
      ?.querySelector(".snippet");
    if (snippet) snippet.replaceChildren(passageExcerpt(current));
    syncPassages();
  };
  const prev = button(t("previous"), async () => change(-1));
  prev.disabled = index <= 0;
  const next = button(t("next"), async () => change(1));
  next.disabled = index >= ps.length - 1;
  for (const b of [prev, next]) b.onpointerdown = (e) => e.preventDefault();
  passageControls.append(
    prev,
    el(
      "span",
      "",
      t("passage_position", [
        index + 1,
        ps.length,
        h.passagesCapped ? "+" : "",
      ]),
    ),
    next,
  );
  if (focused)
    (
      [prev, next].find((b) => b.textContent === focused && !b.disabled) ??
      [prev, next].find((b) => !b.disabled)
    )?.focus();
}
function passageExcerpt(h: Hit) {
  const frag = document.createDocumentFragment();
  const p = h.passage;
  if (!p) return highlighted(h.snippet);
  if (p.start) frag.append(document.createTextNode("…"));
  frag.append(
    highlighted(
      p.text,
      p.ranges.map((r) => ({ start: r.start - p.start, end: r.end - p.start })),
    ),
  );
  if (p.after) frag.append(document.createTextNode("…"));
  if (p.kind === "variant" || p.kind === "typo")
    frag.append(
      el(
        "span",
        "match-quality",
        t(p.kind === "variant" ? "variant_evidence" : "typo_evidence", [
          p.ranges
            .map((r) => p.text.slice(r.start - p.start, r.end - p.start))
            .join(" · "),
        ]),
      ),
    );
  if (p.page)
    frag.append(
      el(
        "span",
        "match-quality",
        p.pageLabel && p.pageLabel !== String(p.page)
          ? t("opens_page_label", [p.page, p.pageLabel])
          : t("opens_page_number", [p.page]),
      ),
    );
  return frag;
}
const state = el("div", "state");
const settings = el("section", "settings");
settings.hidden = true;
const alert = el("div", "notice");
alert.setAttribute("role", "alert");
alert.hidden = true;
const footer = el("footer");
const coverage = el("button", "coverage quiet", t("reading_open_tabs"));
coverage.setAttribute("aria-expanded", "false");
const coverageDetails = el("section", "coverage-details");
coverageDetails.hidden = true;
coverageDetails.id = "coverage-details";
coverageDetails.setAttribute(
  "aria-label",
  t("page_text_coverage_and_recovery"),
);
coverage.setAttribute("aria-controls", coverageDetails.id);
coverage.onclick = () => {
  coverageDetails.hidden = !coverageDetails.hidden;
  if (!coverageDetails.hidden) {
    filterControls.hidden = true;
    filterBar.setAttribute("aria-expanded", "false");
  }
  coverage.setAttribute("aria-expanded", String(!coverageDetails.hidden));
};
const filterBar = el("button", "icon-button filter-toggle");
filterBar.setAttribute("aria-label", t("filters"));
filterBar.title = t("filter_tabs");
filterBar.setAttribute("aria-expanded", "false");
filterBar.setAttribute("aria-controls", "filter-controls");
filterBar.append(icon("filters"));
const filterControls = el("section", "filter-controls");
filterControls.id = "filter-controls";
filterControls.setAttribute("aria-label", t("search_filters"));
filterControls.hidden = true;
filterBar.onclick = () => {
  filterControls.hidden = !filterControls.hidden;
  filterBar.setAttribute("aria-expanded", String(!filterControls.hidden));
  if (!filterControls.hidden) {
    coverageDetails.hidden = true;
    coverage.setAttribute("aria-expanded", "false");
  }
};
const activeChips = el("div", "active-filters");
activeChips.hidden = true;
activeChips.setAttribute("aria-label", t("active_filters"));
const resultsHeader = el("div", "results-header");
const resultsLabel = el("span", "", t("recent_tabs_2"));
const resultsCount = el("span", "result-count");
resultsHeader.append(resultsLabel, resultsCount);
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
  t("website_hostname_includes_subdomains_unless_exact_host_is_selected"),
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
  checkbox(windowFilter, t("this_window")),
  checkbox(bodyFilter, t("page_text")),
  domainFilter,
  checkbox(exactFilter, t("exact_host")),
);
top.insertBefore(filterBar, exit);
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
hints.append(el("kbd", "", "↑↓"), t("select"), el("kbd", "", "↵"), t("jump"));
const settingsButton = el("button", "icon-button settings-toggle");
settingsButton.setAttribute("aria-label", t("settings"));
settingsButton.title = t("settings");
settingsButton.append(icon("settings"));
const privacyNote = el("span", "local-note", t("on_this_device"));
privacyNote.hidden = true;
const live = el("span", "sr");
live.setAttribute("aria-live", "polite");
footer.append(coverage, hints, privacyNote);
// Keep settings reachable even when the palette is just a search field.
top.insertBefore(settingsButton, exit);
const body = el("div", "palette-body");
const bodyContent = el("div", "palette-body-content");
const results = el("section", "search-results");
results.hidden = true;
results.append(resultsHeader, list, passageControls, state);
footer.hidden = true;
bodyContent.append(
  accessPrompt,
  filterControls,
  activeChips,
  coverageDetails,
  recentToggle,
  results,
  settings,
  alert,
  footer,
);
body.append(bodyContent);
dialog.append(top, body, live);
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
let renderedFilters = "";
let coverageSignature = "";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let bodyAnimation: Animation | undefined;
let bodyHeight = 0;
// Measure natural content, then grow the shell downward without scaling text.
// Start interruptions at the current visible height, including rapid clear/type.
const resizeBody = () => {
  dialog.style.setProperty(
    "--search-height",
    `${top.getBoundingClientRect().height}px`,
  );
  const target = bodyContent.getBoundingClientRect().height;
  if (Math.abs(target - bodyHeight) < 0.5) return;
  const current = body.getBoundingClientRect().height;
  bodyAnimation?.cancel();
  bodyHeight = target;
  body.style.height = `${target}px`;
  if (!reducedMotion.matches) {
    bodyAnimation = body.animate(
      [{ height: `${current}px` }, { height: `${target}px` }],
      {
        duration: target > current ? 260 : 180,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    );
  }
};
const bodyObserver = new ResizeObserver(resizeBody);
bodyObserver.observe(bodyContent);
bodyObserver.observe(top);
reducedMotion.addEventListener("change", () => bodyAnimation?.cancel());
function syncSearchVisibility() {
  const expanded =
    !inSettings && (!!input.value.trim() || activeFilters() || showRecent);
  recentToggle.hidden =
    inSettings || !!input.value.trim() || activeFilters() || showRecent;
  const revealing = expanded && results.hidden;
  results.hidden = !expanded;
  if (revealing) {
    results
      .getAnimations({ subtree: true })
      .forEach((animation) => animation.cancel());
    results.animate(
      reducedMotion.matches
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(-4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
      { duration: reducedMotion.matches ? 100 : 180, easing: "ease-out" },
    );
  }
  footer.hidden = !inSettings && !expanded;
  accessPrompt.hidden = !expanded || !explainAccess;
  clearSearch.hidden = !input.value;
  input.setAttribute("aria-expanded", String(expanded && hits.length > 0));
  if (!expanded) input.removeAttribute("aria-activedescendant");
  return expanded;
}

function hideAccessExplanation() {
  explainAccess = false;
  accessPrompt.hidden = true;
}
async function chooseAllWebsites() {
  const granted = await allowAllWebsites();
  hideAccessExplanation();
  if (!granted)
    throw Error(t("website_access_was_not_granted_titles_and_urls_still"));
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
  } else if (!filterControls.hidden) {
    filterControls.hidden = true;
    filterBar.setAttribute("aria-expanded", "false");
    filterBar.focus();
  } else if (!coverageDetails.hidden) {
    coverageDetails.hidden = true;
    coverage.setAttribute("aria-expanded", "false");
    coverage.focus();
  } else if (showRecent && !input.value) {
    showRecent = false;
    syncSearchVisibility();
    input.focus();
  } else void close();
});
// Keep keyboard traversal in the palette, including when the browser would
// otherwise move focus from the last native control into its toolbar.
dialog.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.isComposing) return;
  const controls = [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
    ),
  ].filter((control) => control.getClientRects().length > 0);
  const first = controls[0],
    last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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
function select(index: number, scroll = true) {
  selected = Math.max(0, Math.min(index, hits.length - 1));
  [...list.querySelectorAll(".row")].forEach((row, i) =>
    row.setAttribute("aria-selected", String(i === selected)),
  );
  syncPassages();
  if (hits.length) {
    input.setAttribute("aria-activedescendant", "hit-" + hits[selected].id);
    if (scroll)
      list
        .querySelectorAll(".row")
        .item(selected)
        ?.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}
function highlighted(
  text: string,
  ranges: { start: number; end: number }[] = [],
) {
  const frag = document.createDocumentFragment();
  const merged: { start: number; end: number }[] = [];
  for (const range of [...ranges].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end > text.length ||
      range.end <= range.start
    )
      continue;
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end)
      previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  let cursor = 0;
  for (const range of merged) {
    frag.append(
      document.createTextNode(displayText(text.slice(cursor, range.start))),
      el("mark", "", text.slice(range.start, range.end)),
    );
    cursor = range.end;
  }
  frag.append(document.createTextNode(displayText(text.slice(cursor))));
  return frag;
}
async function activate() {
  const hit = hits[selected];
  if (
    !hit ||
    results.hidden ||
    composing ||
    renderedQuery !== input.value ||
    renderedFilters !== JSON.stringify(filters())
  )
    return;
  try {
    await request<{ activated?: boolean }>({
      type: "navigate",
      id: hit.id,
      query: input.value,
      url: hit.url,
      updated: hit.updated,
      passageId: hit.passage?.id,
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
  if (renderedQuery !== input.value) passageChoice.clear();
  const oldScroll = list.scrollTop;
  renderedQuery = input.value;
  renderedFilters = JSON.stringify(filters());
  list.removeAttribute("aria-busy");
  hits =
    input.value.trim() || activeFilters()
      ? response.hits
      : showRecent
        ? response.hits.slice(0, 6)
        : [];
  if (priorId !== undefined && hits.some((h) => h.id === priorId))
    selected = hits.findIndex((h) => h.id === priorId);
  for (const h of hits) {
    const p = h.passages?.find((p) => p.id === passageChoice.get(h.id));
    if (p) {
      h.passage = p;
      h.snippet = p.text;
    }
  }
  list.replaceChildren();
  const hasQuery = tokenize(input.value).length > 0;
  clearSearch.hidden = !input.value;
  const stateLabels: Record<Hit["state"], string> = {
    content: "",
    "metadata-only": "",
    indexing: t("indexing"),
    unavailable: t("unavailable"),
    stale: t("stale_text"),
    excluded: t("excluded"),
  };
  for (const [i, h] of hits.entries()) {
    if (h.approximate && (i === 0 || !hits[i - 1].approximate)) {
      const group = el("li", "approximate-heading", t("approximate_matches"));
      group.setAttribute("role", "presentation");
      list.append(group);
    }
    const row = el("li", "row");
    row.id = "hit-" + h.id;
    row.setAttribute("role", "option");
    let host = "";
    try {
      host = new URL(h.url).hostname || h.url;
    } catch {
      host = h.url;
    }
    const siteIcon = el("span", "site", (host[0] || "↗").toUpperCase());
    siteIcon.setAttribute("aria-hidden", "true");
    const copy = el("div", "copy");
    const title = el("div", "title");
    title.title = displayText(h.title);
    title.append(highlighted(h.title, h.titleRanges));
    const label = stateLabels[h.state];
    const meta = el(
      "div",
      "meta",
      [
        host,
        h.approximate && !h.passage ? t("close_match") : "",
        label,
        h.truncated && (h.state === "content" || h.state === "stale")
          ? t("partial_text")
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    meta.title = displayText(h.url);
    meta.dir = "ltr";
    copy.append(title, meta);
    const bodyEvidence = h.snippet;
    if (hasQuery && (bodyEvidence || h.urlRanges?.length)) {
      const snippet = el("p", "snippet");
      if (bodyEvidence) snippet.append(passageExcerpt(h));
      else {
        const label = el("bdi", "", t("url"));
        label.dir = "ltr";
        const url = el("bdi");
        url.dir = "ltr";
        const excerpt = h.urlExcerpt;
        if (excerpt) {
          if (excerpt.start) url.append("…");
          url.append(
            highlighted(
              excerpt.text,
              excerpt.ranges.map((r) => ({
                start: r.start - excerpt.start,
                end: r.end - excerpt.start,
              })),
            ),
          );
          if (excerpt.end < h.url.length) url.append("…");
        } else url.append(highlighted(h.url, h.urlRanges));
        snippet.append(label, url);
      }
      copy.append(snippet);
    }
    const actionHint = el("span", "row-action");
    actionHint.append(icon("arrow"));
    actionHint.setAttribute("aria-hidden", "true");
    row.append(siteIcon, copy, actionHint);
    row.onpointermove = () => {
      if (selected !== i) select(i);
    };
    row.onclick = () => {
      select(i);
      void activate();
    };
    list.append(row);
  }
  list.scrollTop = oldScroll;
  state.hidden = hits.length > 0;
  state.replaceChildren(
    el(
      "strong",
      "",
      activeFilters()
        ? t("no_tabs_match_these_filters")
        : input.value
          ? t("no_matching_tabs")
          : t("no_open_tabs_to_search"),
    ),
    el(
      "span",
      "",
      input.value
        ? t("try_different_words_only_permitted_loaded_text_is_searched")
        : t("open_a_website_then_return_here"),
    ),
  );
  if (activeFilters())
    state.append(button(t("clear_filters"), async () => clearFilters()));
  resultsLabel.textContent = hasQuery
    ? t("search_results")
    : t("recent_tabs_2");
  resultsCount.textContent =
    String(hits.length) + (hits.some((h) => h.resultsCapped) ? "+" : "");
  resultsHeader.hidden = !hits.length;
  // Keep focused chips stable across polling; only rebuild when filter values change.
  const chipSignature = JSON.stringify(filters());
  if (activeChips.dataset.signature !== chipSignature) {
    const hadChipFocus = activeChips.contains(document.activeElement);
    activeChips.dataset.signature = chipSignature;
    activeChips.replaceChildren();
    const addChip = (label: string, remove: () => void) => {
      const chip = button(label, async () => {
        remove();
        input.focus();
        await update();
      });
      chip.className = "filter-chip";
      chip.setAttribute("aria-label", t("remove_filter", [label]));
      chip.append(icon("close"));
      activeChips.append(chip);
    };
    if (windowFilter.checked)
      addChip(t("this_window"), () => {
        windowFilter.checked = false;
      });
    if (bodyFilter.checked)
      addChip(t("page_text"), () => {
        bodyFilter.checked = false;
      });
    if (domainFilter.value.trim())
      addChip(
        domainFilter.value.trim() +
          (exactFilter.checked
            ? t("exact_host_suffix")
            : t("subdomains_suffix")),
        () => {
          domainFilter.value = "";
          exactFilter.checked = false;
        },
      );
    if (activeFilters()) {
      const clear = button(t("clear_filters"), async () => clearFilters());
      clear.className = "clear-filters quiet";
      activeChips.append(clear);
    }
    activeChips.hidden = !activeFilters();
    if (hadChipFocus) input.focus();
  }
  filterBar.dataset.active = String(activeFilters());
  exactFilter.disabled = !domainFilter.value.trim();
  const nextCoverage = JSON.stringify([response.coverage, response.paused]);
  if (nextCoverage !== coverageSignature) {
    coverageSignature = nextCoverage;
    const restoreCoverageFocus = coverageDetails.contains(
      document.activeElement,
    );
    const coverageHeading = el("div", "panel-heading");
    const closeCoverage = button("", async () => {
      coverageDetails.hidden = true;
      coverage.setAttribute("aria-expanded", "false");
      coverage.focus();
    });
    closeCoverage.className = "icon-button";
    closeCoverage.setAttribute("aria-label", t("close_coverage_details"));
    closeCoverage.append(icon("close"));
    coverageHeading.append(
      el("strong", "", t("page_text_coverage")),
      closeCoverage,
    );
    coverageDetails.replaceChildren(
      coverageHeading,
      el(
        "p",
        "",
        t("only_loaded_permitted_page_text_is_searched_unloaded_sections"),
      ),
    );
    const descriptions = {
      permission: t("website_access_missing_or_withheld"),
      excluded: t("excluded_by_you"),
      sleeping: t("sleeping_tab"),
      restricted: t("browser_restricted_or_unsupported_page"),
      indexing: t("indexing_in_progress"),
      failure: t("text_extraction_failed_or_is_unsupported"),
      stale: t("previously_indexed_text_may_be_out_of_date"),
      budget: t("text_removed_to_keep_the_local_index_bounded"),
      partial: t("partial_text_page_extraction_limit_reached"),
      paused: t("indexing_paused"),
      ready: t("page_text_searchable"),
      empty: t("no_readable_page_text_found"),
    };
    const entries = response.coverage ?? [];
    const summary = new Map<string, number>();
    for (const entry of entries)
      summary.set(entry.reason, (summary.get(entry.reason) ?? 0) + 1);
    const coverageCounts = el("div", "coverage-counts");
    for (const [reason, count] of summary) {
      const pill = el(
        "span",
        "coverage-count",
        t("coverage_reason_count", [
          count,
          descriptions[reason as keyof typeof descriptions],
        ]),
      );
      coverageCounts.append(pill);
    }
    coverageDetails.append(coverageCounts);
    if (response.paused)
      coverageDetails.append(
        button(t("resume_indexing"), async () => {
          await request({ type: "resume" });
          await update();
        }),
      );
    // Details remain bounded even with many open tabs; choose a result's domain filter to narrow.
    for (const entry of entries
      .filter((e) => !["ready", "paused"].includes(e.reason))
      .slice(0, 100)) {
      const row = el("div", "coverage-row");
      row.append(
        el(
          "span",
          "",
          `${entry.title || entry.url} · ${entry.detail ?? descriptions[entry.reason]}`,
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
          button(t("allow_this_site"), async () => {
            const u = new URL(entry.url);
            const granted = await chrome.permissions.request({
              origins: [u.protocol + "//" + u.hostname + "/*"],
            });
            if (!granted)
              throw Error(
                t("access_was_not_granted_titles_and_urls_still_work"),
              );
            await request({ type: "refresh" });
            await update();
          }),
        );
      if (entry.reason === "excluded")
        row.append(
          button(t("include_this_site"), async () => recover("include")),
        );
      if (entry.reason === "sleeping")
        row.append(
          button(t("load_and_search_this_tab"), async () => {
            await recover("load");
            await close();
          }),
        );
      if (["failure", "budget", "stale"].includes(entry.reason))
        row.append(button(t("retry_page_text"), async () => recover("retry")));
      coverageDetails.append(row);
    }
    if (entries.filter((e) => e.reason !== "ready").length > 100)
      coverageDetails.append(
        el("p", "", t("showing_the_first_100_tabs_needing_attention_use_the")),
      );
    if (restoreCoverageFocus) coverage.focus();
  }
  coverage.textContent = response.paused
    ? t("indexing_paused")
    : t(response.indexing ? "page_coverage_indexing" : "page_coverage", [
        response.searchable,
        response.total,
      ]);
  coverage.dataset.status = response.paused
    ? "paused"
    : response.searchable === response.total && response.total > 0
      ? "ready"
      : "partial";
  const announcement = t(
    hits[0]?.approximate
      ? hits.length === 1
        ? "close_result_one"
        : "close_result_other"
      : hits.length === 1
        ? "result_one"
        : "result_other",
    [hits.length],
  );
  if (live.textContent !== announcement) live.textContent = announcement;
  document.documentElement.dataset.theme = response.theme;
  const expanded = syncSearchVisibility();
  if (expanded) select(Math.min(selected, hits.length - 1), false);
  else live.textContent = "";
}
async function update() {
  if (inSettings || composing) return;
  // Clearing must collapse immediately, even while a search is in flight.
  if (!input.value.trim() && !activeFilters()) {
    hits = [];
    list.replaceChildren();
    syncSearchVisibility();
  }
  const version = ++sequence;
  if (
    renderedQuery !== input.value ||
    renderedFilters !== JSON.stringify(filters())
  ) {
    resultsLabel.textContent = t("searching");
    list.setAttribute("aria-busy", "true");
  }
  try {
    const response = await request<SearchResponse>({
      type: "search",
      query: input.value,
      filters: filters(),
    });
    if (version === sequence && !inSettings) render(response);
  } catch (e) {
    if (version === sequence) {
      list.removeAttribute("aria-busy");
      resultsLabel.textContent = t("search_unavailable");
      error(e);
    }
  }
}
input.oninput = () => {
  selected = 0;
  if (input.value) showRecent = false;
  alert.hidden = true;
  void update();
};
input.addEventListener("compositionstart", () => {
  composing = true;
  ++sequence;
});
input.addEventListener("compositionend", () => {
  composing = false;
  void update();
});
input.onkeydown = (e) => {
  if (e.isComposing || composing) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (results.hidden && !input.value && e.key === "ArrowDown") {
      showRecent = true;
      void update();
    } else if (!results.hidden)
      select(selected + (e.key === "ArrowDown" ? 1 : -1));
  } else if (e.key === "Enter") {
    e.preventDefault();
    void activate();
  }
};
function showSearch() {
  inSettings = false;
  hints.hidden = false;
  coverage.hidden = false;
  privacyNote.hidden = true;
  filterBar.hidden = false;
  resultsHeader.hidden = false;
  activeChips.hidden = !activeFilters();
  accessPrompt.hidden = !explainAccess;
  settings.hidden = true;
  list.hidden = false;
  top.hidden = false;
  state.hidden = hits.length > 0;
  settingsButton.hidden = false;
  syncSearchVisibility();
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
  results.hidden = true;
  footer.hidden = false;
  input.setAttribute("aria-expanded", "false");
  hints.hidden = true;
  coverage.hidden = true;
  privacyNote.hidden = false;
  filterBar.hidden = true;
  filterControls.hidden = true;
  filterBar.setAttribute("aria-expanded", "false");
  activeChips.hidden = true;
  resultsHeader.hidden = true;
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
    const back = button(t("back_to_search"), async () => showSearch());
    back.className = "back";
    settings.append(back, el("h2", "", t("settings")));
    const feedback = el("div", "settings-feedback");
    feedback.setAttribute("role", "status");
    const confirm = (message: string) => {
      feedback.textContent = message;
    };
    function group(title: string, copy: string) {
      const section = el("details", "settings-group");
      section.append(el("summary", "", title), el("p", "", copy));
      settings.append(section);
      return section;
    }
    const appearance = el("div", "settings-group setting-row");
    const themeLabel = el("label", "", t("appearance"));
    themeLabel.htmlFor = "theme";
    const theme = el("select");
    theme.id = "theme";
    for (const themeValue of ["system", "light", "dark"]) {
      const option = el(
        "option",
        "",
        (
          {
            system: t("theme_system"),
            light: t("theme_light"),
            dark: t("theme_dark"),
          } as Record<string, string>
        )[themeValue],
      );
      option.value = themeValue;
      theme.append(option);
    }
    theme.value = p.theme;
    theme.onchange = () => {
      void (async () => {
        const saved = await request<Preferences>({
          type: "save",
          theme: theme.value,
          exclusions: p.exclusions,
        });
        p.theme = saved.theme;
        document.documentElement.dataset.theme = saved.theme;
        confirm(t("appearance_updated"));
      })().catch(error);
    };
    appearance.append(themeLabel, theme);
    settings.append(appearance);

    const shortcut = (await chrome.commands.getAll()).find(
      (c) => c.name === "open-search",
    )?.shortcut;
    const shortcutCard = el(
      "section",
      "settings-group" + (!shortcut ? " shortcut-missing" : ""),
    );
    const shortcutRow = el("div", "setting-row");
    const shortcutActions = el("div", "shortcut-actions");
    shortcutActions.append(
      el("kbd", "shortcut-key", shortcut || t("not_assigned")),
      button(shortcut ? t("change") : t("set_shortcut"), async () => {
        await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      }),
    );
    shortcutRow.append(el("span", "", t("keyboard_shortcut")), shortcutActions);
    shortcutCard.append(shortcutRow);
    if (!shortcut)
      shortcutCard.append(
        el("p", "", t("choose_a_shortcut_to_open_search_from_any_chrome")),
      );
    const shortcutHelp = el("details", "shortcut-help");
    shortcutHelp.append(
      el("summary", "", t("shortcut_help")),
      el("p", "", t("suggested_control_space_on_mac_ctrl_shift_space_on")),
    );
    shortcutCard.append(shortcutHelp);
    settings.append(shortcutCard);

    const website = group(
      t("website_access"),
      t("optional_access_lets_you_search_readable_page_text_which"),
    );
    const origin = el("input");
    origin.id = "site-access";
    origin.placeholder = "example.com";
    origin.setAttribute("aria-label", t("website_hostname_for_access"));
    const access = el("div", "actions");
    access.append(
      button(t("allow_this_site"), async () => {
        const host = normalizeHost(origin.value.trim());
        if (!host) throw Error(t("enter_a_hostname_for_example_example_com"));
        const granted = await chrome.permissions.request({
          origins: ["https://" + host + "/*", "http://" + host + "/*"],
        });
        if (!granted)
          throw Error(t("access_was_not_granted_titles_and_urls_still_work"));
        await request({ type: "refresh" });
        confirm(t("website_access_updated"));
      }),
      button(t("allow_all_websites"), async () => {
        await chooseAllWebsites();
        confirm(t("website_access_updated"));
      }),
      button(t("revoke_website_access"), async () => {
        const all = await chrome.permissions.getAll();
        if (all.origins?.length)
          await chrome.permissions.remove({ origins: all.origins });
        await request({ type: "refresh" });
        confirm(t("website_access_removed_titles_and_urls_still_work"));
      }),
    );
    website.append(origin, access);

    const excludedSites = group(
      t("excluded_sites"),
      t("keep_selected_sites_out_of_page_text_search_one"),
    );
    const exclusions = el("textarea");
    exclusions.id = "exclusions";
    exclusions.value = p.exclusions.join("\n");
    exclusions.setAttribute("aria-label", t("excluded_sites"));
    excludedSites.append(
      exclusions,
      button(t("save_excluded_sites"), async () => {
        const hosts = exclusions.value
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map(normalizeHost);
        if (hosts.some((h) => !h))
          throw Error(t("use_hostnames_only_without_paths_or_wildcards"));
        const saved = await request<Preferences>({
          type: "save",
          theme: p.theme,
          exclusions: [...new Set(hosts)],
        });
        p.exclusions = saved.exclusions;
        alert.hidden = true;
        confirm(t("excluded_sites_saved"));
      }),
    );

    const local = group(
      t("local_data"),
      t("page_text_is_kept_for_this_browser_session_clearing"),
    );
    const data = el("div", "actions");
    const clear = button(t("clear_data_pause"), async () => {
      await request({ type: "clear" });
      coverage.textContent = t("indexing_paused");
      alert.hidden = true;
      confirm(t("page_text_cleared_indexing_is_paused"));
    });
    clear.className = "danger";
    data.append(
      clear,
      button(t("resume_indexing"), async () => {
        await request({ type: "resume" });
        coverage.textContent = "Indexing…";
        confirm(t("indexing_resumed"));
      }),
    );
    local.append(data);
    website.append(
      el(
        "p",
        "settings-limit",
        t("only_loaded_permitted_page_text_is_searched_frames_images"),
      ),
    );
    settings.append(feedback);
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
    syncSearchVisibility();
  })
  .catch(error);
void request({ type: "refresh" }).then(update).catch(error);
const polling = setInterval(() => {
  if (!document.hidden && !inSettings) void update();
}, 2000);
window.addEventListener("pagehide", () => {
  clearInterval(polling);
  bodyObserver.disconnect();
  bodyAnimation?.cancel();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id === chrome.runtime.id &&
    message?.type === "toggle-search" &&
    !overlay
  ) {
    void close();
    return;
  }
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
  window.addEventListener("message", (event) => {
    if (
      event.source === window.parent &&
      event.data?.type === "tabscope-focus-search" &&
      event.data.invocation === invocation &&
      dialog.open &&
      !inSettings
    )
      input.focus({ preventScroll: true });
  });
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
