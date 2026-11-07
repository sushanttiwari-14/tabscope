import { extractReadable } from "./extract";
import { SearchIndex } from "./search";
import {
  DEFAULTS,
  MAX_TEXT,
  excluded,
  normalizeHost,
  enforceBudget,
  validCommit,
  type Preferences,
  type TabRecord,
} from "./types";
const records = new Map<number, TabRecord>();
const generations = new Map<number, number>();
const search = new SearchIndex();
let prefs: Preferences = { ...DEFAULTS };
let ready = false;
let chain: Promise<unknown> = Promise.resolve();
let popup: number | undefined;
const pending = new Set<number>();
const bump = (id: number) =>
  generations.set(id, (generations.get(id) ?? 0) + 1);
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}
const safeURL = (url = "") => /^https?:\/\//.test(url);
async function allowed(url: string) {
  if (!safeURL(url)) return false;
  try {
    return await chrome.permissions.contains({
      origins: [new URL(url).origin + "/*"],
    });
  } catch {
    return false;
  }
}
async function persist() {
  enforceBudget(records);
  search.rebuild(records);
  await chrome.storage.session.set({
    schema: 1,
    records: [...records.values()],
  });
}
async function initialize() {
  if (ready) return;
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const local = await chrome.storage.local.get("preferences");
  if (local.preferences) {
    const p = local.preferences as Preferences;
    prefs = {
      theme: ["system", "light", "dark"].includes(p.theme) ? p.theme : "system",
      exclusions: Array.isArray(p.exclusions)
        ? p.exclusions.filter(
            (s: unknown) => typeof s === "string" && normalizeHost(s) === s,
          )
        : [],
      paused: p.paused === true,
    };
  }
  const saved = await chrome.storage.session.get(["schema", "records"]);
  if (saved.schema === 1 && Array.isArray(saved.records))
    for (const r of saved.records as TabRecord[]) records.set(r.id, r);
  search.rebuild(records);
  ready = true;
  await reconcile();
}
async function reconcile() {
  const before = JSON.stringify([...records.values()]);
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const ids = new Set(tabs.filter((t) => !t.incognito).map((t) => t.id));
  for (const id of records.keys()) if (!ids.has(id)) records.delete(id);
  for (const t of tabs) {
    if (t.id === undefined || t.incognito) continue;
    const old = records.get(t.id);
    const url = t.url ?? "";
    const deny = excluded(url, prefs.exclusions);
    const access = await allowed(url);
    const keep =
      old &&
      old.url === url &&
      !t.discarded &&
      access &&
      !deny &&
      !prefs.paused;
    records.set(t.id, {
      id: t.id,
      windowId: t.windowId,
      url,
      title: t.title ?? url,
      text: keep ? old.text : "",
      updated: keep ? old.updated : 0,
      state: deny
        ? "excluded"
        : t.discarded
          ? "unavailable"
          : keep
            ? old.state
            : "metadata-only",
      truncated: keep ? old.truncated : false,
    });
  }
  if (before !== JSON.stringify([...records.values()])) await persist();
}
async function inject(id: number) {
  await chrome.scripting.executeScript({
    target: { tabId: id },
    files: ["content.js"],
  });
}
async function indexTab(id: number) {
  await initialize();
  const generation = generations.get(id) ?? 0;
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(id);
  } catch {
    return;
  }
  const url = tab.url ?? "";
  if (
    prefs.paused ||
    tab.incognito ||
    tab.discarded ||
    tab.status === "loading" ||
    excluded(url, prefs.exclusions) ||
    !(await allowed(url))
  )
    return;
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: extractReadable,
    });
    const data = result[0]?.result;
    if (!data || typeof data.text !== "string") return;
    const current = await chrome.tabs.get(id);
    if (
      !validCommit(
        generation,
        generations.get(id) ?? 0,
        data.url,
        current.url ?? "",
        prefs.paused,
        excluded(url, prefs.exclusions) || !(await allowed(url)),
      )
    )
      return;
    records.set(id, {
      id,
      windowId: current.windowId,
      url,
      title: current.title ?? url,
      text: data.text.slice(0, MAX_TEXT),
      updated: Date.now(),
      state: "content",
      truncated: data.truncated,
    });
    await persist();
    await inject(id);
  } catch {
    const r = records.get(id);
    if (r) {
      r.state = r.text ? "stale" : "unavailable";
      await persist();
    }
  }
}
function schedule(id: number) {
  if (pending.has(id)) return;
  pending.add(id);
  void enqueue(async () => {
    try {
      await indexTab(id);
    } finally {
      pending.delete(id);
    }
  });
}
async function refresh() {
  await initialize();
  await reconcile();
  for (const id of records.keys()) schedule(id);
}
async function fallback() {
  if (popup !== undefined) {
    try {
      await chrome.windows.update(popup, { focused: true });
      return;
    } catch {
      popup = undefined;
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("palette.html"),
    type: "popup",
    width: 700,
    height: 700,
  });
  popup = win?.id;
}
async function invoke(tab?: chrome.tabs.Tab) {
  try {
    const t =
      tab ??
      (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!t?.id || !safeURL(t.url) || t.discarded) throw Error();
    await inject(t.id);
    await chrome.tabs.sendMessage(t.id, { type: "open" });
  } catch {
    await fallback();
  }
  void enqueue(refresh);
}
chrome.action.onClicked.addListener((t) => {
  void invoke(t);
});
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-search") void invoke();
});
chrome.tabs.onRemoved.addListener((id) => {
  bump(id);
  void enqueue(async () => {
    await initialize();
    records.delete(id);
    await persist();
  });
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url || change.status === "loading" || change.discarded) {
    bump(id);
    void enqueue(async () => {
      await initialize();
      records.delete(id);
      await reconcile();
    });
  }
  if (change.status === "complete" || change.url) schedule(id);
});
chrome.permissions.onRemoved.addListener(() => {
  for (const id of records.keys()) bump(id);
  void enqueue(async () => {
    await initialize();
    await reconcile();
  });
});
chrome.permissions.onAdded.addListener(() => {
  void enqueue(refresh);
});
chrome.runtime.onStartup.addListener(() => {
  void enqueue(refresh);
});
chrome.runtime.onInstalled.addListener(() => {
  void enqueue(refresh);
});
function uiSender(sender: chrome.runtime.MessageSender) {
  return (
    sender.id === chrome.runtime.id &&
    (sender.url ?? "").split("?")[0].split("#")[0] ===
      chrome.runtime.getURL("palette.html")
  );
}
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  const m = message as Record<string, unknown>;
  if (m.type === "dirty") {
    if (
      sender.id === chrome.runtime.id &&
      sender.tab?.id !== undefined &&
      sender.frameId === 0 &&
      typeof m.url === "string" &&
      m.url === sender.url
    ) {
      bump(sender.tab.id);
      schedule(sender.tab.id);
    }
    return;
  }
  if (!uiSender(sender)) {
    reply({ error: "Unauthorized request" });
    return;
  }
  if (m.type === "clear" || m.type === "save")
    for (const id of records.keys()) bump(id);
  void enqueue(async () => {
    await initialize();
    switch (m.type) {
      case "search": {
        if (typeof m.query !== "string" || m.query.length > 500)
          throw Error("Invalid query");
        await reconcile();
        return {
          hits: search.search(m.query),
          total: records.size,
          searchable: [...records.values()].filter((r) => r.state === "content")
            .length,
          indexing: pending.size,
          paused: prefs.paused,
          theme: prefs.theme,
        };
      }
      case "settings":
        return prefs;
      case "save": {
        if (
          !["system", "light", "dark"].includes(String(m.theme)) ||
          !Array.isArray(m.exclusions) ||
          m.exclusions.length > 200 ||
          !m.exclusions.every(
            (x) => typeof x === "string" && normalizeHost(x) === x,
          )
        )
          throw Error("Use hostnames only, for example example.com");
        prefs = {
          ...prefs,
          theme: m.theme as Preferences["theme"],
          exclusions: m.exclusions as string[],
        };
        await chrome.storage.local.set({ preferences: prefs });
        await reconcile();
        for (const id of records.keys()) schedule(id);
        return prefs;
      }
      case "clear": {
        prefs.paused = true;
        records.clear();
        search.rebuild(records);
        await chrome.storage.local.set({ preferences: prefs });
        await chrome.storage.session.clear();
        return prefs;
      }
      case "resume": {
        prefs.paused = false;
        await chrome.storage.local.set({ preferences: prefs });
        await refresh();
        return prefs;
      }
      case "refresh":
        await refresh();
        return prefs;
      case "close": {
        if (sender.tab?.id !== undefined)
          await chrome.tabs
            .sendMessage(sender.tab.id, { type: "close" })
            .catch(() => {});
        return true;
      }
      case "navigate": {
        if (
          !Number.isInteger(m.id) ||
          typeof m.query !== "string" ||
          m.query.length > 500
        )
          throw Error("Invalid selection");
        const id = m.id as number;
        const r = records.get(id);
        if (!r) throw Error("That tab is no longer open. Search again.");
        let tab: chrome.tabs.Tab;
        try {
          tab = await chrome.tabs.get(id);
        } catch {
          records.delete(id);
          await persist();
          throw Error("That tab has closed. Search again.");
        }
        if (tab.url !== r.url) throw Error("That page changed. Search again.");
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(id, { active: true });
        if (!m.query || !r.text) return { activated: true };
        try {
          await inject(id);
          const hit = search.search(m.query).find((h) => h.id === id);
          const found = await chrome.tabs.sendMessage(id, {
            type: "highlight",
            excerpt: hit?.snippet ?? "",
            query: m.query,
          });
          return {
            activated: true,
            warning: found
              ? undefined
              : "Tab opened. The exact passage could not be located on the changed page.",
          };
        } catch {
          return {
            activated: true,
            warning:
              "Tab opened. Passage highlighting is unavailable on this page.",
          };
        }
      }
      default:
        throw Error("Unknown request");
    }
  }).then(reply, (e) =>
    reply({
      error: e instanceof Error ? e.message : "The request failed. Try again.",
    }),
  );
  return true;
});
