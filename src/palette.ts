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
import { normalize, tokenize } from "./search";
const overlay = new URLSearchParams(location.search).has("overlay");
if (overlay) document.body.classList.add("overlay");
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
const logo = el("span", "logo", "◉");
logo.setAttribute("aria-hidden", "true");
const input = el("input", "field");
input.placeholder = "Search anything in your tabs…";
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
const coverage = el("span", "coverage", "Reading open tabs…");
const hints = el("span", "hint");
hints.append(el("kbd", "", "↑↓"), " select  ", el("kbd", "", "↵"), " jump");
const settingsButton = el("button", "quiet", "Settings");
const live = el("span", "sr");
live.setAttribute("aria-live", "polite");
footer.append(coverage, hints, settingsButton);
dialog.append(top, accessPrompt, list, state, settings, alert, footer, live);
document.body.append(dialog);
dialog.showModal();
input.focus();
let hits: Hit[] = [];
let selected = 0;
let sequence = 0;
let inSettings = false;
let composing = false;
let explainAccess = false;
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
    const r = await request<{ warning?: string }>({
      type: "navigate",
      id: hit.id,
      query: input.value,
    });
    if (r.warning) {
      error(r.warning);
    } else await close();
  } catch (e) {
    error(e);
    void update();
  }
}
function render(response: SearchResponse) {
  hits = response.hits;
  list.replaceChildren();
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
    title.append(highlighted(h.title, input.value));
    const label = h.state === "content" ? "Content" : h.state.replace("-", " ");
    const meta = el(
      "div",
      "meta",
      host + " · " + label + (h.truncated ? " · text capped" : ""),
    );
    const snippet = el("p", "snippet");
    snippet.append(highlighted(h.snippet, input.value));
    copy.append(title, meta, snippet);
    row.append(icon, copy);
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
      input.value ? "No matching tabs" : "No open tabs to search",
    ),
    el(
      "span",
      "",
      input.value
        ? "Try different words. Only permitted, loaded text is searched."
        : "Open a website, then return here.",
    ),
  );
  coverage.textContent = response.paused
    ? "Indexing paused"
    : `${response.searchable} of ${response.total} content-searchable${response.indexing ? " · Indexing…" : ""}`;
  live.textContent = `${hits.length} results. ${coverage.textContent}`;
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
    settings.append(
      data,
      el("label", "", "Keyboard shortcut"),
      el(
        "p",
        "",
        "Suggested: Ctrl+Shift+K (⌘⇧K on Mac). Chrome may leave it unassigned if there is a conflict. Change it at chrome://extensions/shortcuts.",
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
