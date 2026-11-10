import { pdfPageURL } from "./pdf";
import { extractReadable } from "./extract";
import { SearchIndex, matchesFilters } from "./search";
import {
  DEFAULTS,
  MAX_TEXT,
  excluded,
  normalizeHost,
  enforceBudget,
  validCommit,
  type Preferences,
  type TabRecord,
  type SearchFilters,
  type PDFInfo,
} from "./types";
const records = new Map<number, TabRecord>();
const generations = new Map<number, number>();
const search = new SearchIndex();
let prefs: Preferences = { ...DEFAULTS };
let ready = false;
let popup: number | undefined;
let fallbackSource: number | undefined;
let fallbackFlight: Promise<void> | undefined;
let invocation = 0;
let originWindow: number | undefined;
let overlayTab: number | undefined;
const overlayWaits = new Map<
  string,
  {
    tab: number;
    url: string;
    documentId?: string;
    uiInvocation?: string;
    resolve: (ready: boolean) => void;
  }
>();
const recency = new Map<number, number>();
const retries = new Map<number, number>();
const pending = new Set<number>();
const loadingRetries = new Map<number, number>();
const rerun = new Set<number>();
const pdfJobs = new Map<
  number,
  { token: string; url: string; generation: number; revision: number }
>();
let pdfFlight = Promise.resolve();
const bump = (id: number) => {
  generations.set(id, (generations.get(id) ?? 0) + 1);
  const job = pdfJobs.get(id);
  if (job) {
    pdfJobs.delete(id);
    void chrome.runtime
      .sendMessage({ type: "pdf-cancel", token: job.token })
      .catch(() => {});
  }
};
async function startPDF(id: number, url: string, generation: number) {
  if (pdfJobs.has(id)) return;
  const token = crypto.randomUUID();
  const job = { token, url, generation, revision: Date.now() };
  pdfJobs.set(id, job);
  pdfFlight = pdfFlight
    .catch(() => {})
    .then(async () => {
      if (pdfJobs.get(id) !== job) return;
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      });
      if (!contexts.length)
        await chrome.offscreen.createDocument({
          url: "pdf-offscreen.html",
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification:
            "Extract permitted PDFs locally with a bundled PDF.js worker",
        });
      if (pdfJobs.get(id) !== job) return;
      const result = await chrome.runtime.sendMessage({
        type: "pdf-extract",
        url,
        token,
      });
      if (!result || result.error)
        await enqueue(async () => {
          if (pdfJobs.get(id) !== job) return;
          const r = records.get(id);
          if (r) {
            r.pdf = {
              pages: r.pdf?.pages ?? [],
              total: r.pdf?.total ?? 0,
              searched: r.pdf?.searched ?? 0,
              textPages: r.pdf?.textPages ?? 0,
              status: String(
                result?.error ??
                  "PDF extraction was interrupted. Retry page text.",
              ).slice(0, 200),
            };
            r.coverage = r.text ? "partial" : "failure";
            await persist();
          }
        });
    })
    .catch(async () => {
      await enqueue(async () => {
        const r = records.get(id);
        if (r && pdfJobs.get(id) === job) {
          r.coverage = "failure";
          await persist();
        }
      });
    })
    .finally(() => {
      if (pdfJobs.get(id) === job) pdfJobs.delete(id);
    });
}
const urgent: (() => Promise<void>)[] = [];
const background: (() => Promise<void>)[] = [];
let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (urgent.length || background.length)
      await (urgent.shift() ?? background.shift())!();
  } finally {
    draining = false;
  }
}
function enqueue<T>(fn: () => Promise<T>, interactive = true): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    (interactive ? urgent : background).push(async () => {
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    });
    void drain();
  });
}
function invalidateViews() {
  for (const id of records.keys())
    void chrome.tabs
      .sendMessage(id, { type: "clear-highlights" })
      .catch(() => {});
  void chrome.runtime
    .sendMessage({ type: "index-invalidated" })
    .catch(() => {});
}
const safeURL = (url = "") => /^https?:\/\//.test(url);
const restricted = (url: string) =>
  !safeURL(url) ||
  /^https:\/\/(chromewebstore\.google\.com(?:\/|$)|chrome\.google\.com\/webstore(?:\/|$))/.test(
    url,
  );
async function allowed(url: string) {
  if (!safeURL(url)) return false;
  try {
    return await chrome.permissions.contains({
      origins: [new URL(url).protocol + "//" + new URL(url).hostname + "/*"],
    });
  } catch {
    return false;
  }
}
async function persist() {
  enforceBudget(records);
  search.sync(records);
  await chrome.storage.session.set({
    schema: 3,
    recency: [...recency],
    records: [...records.values()],
  });
}
async function initialize() {
  if (ready) return;
  // A restarted worker cannot authenticate a former extraction job token.
  if (chrome.offscreen && (await chrome.offscreen.hasDocument()))
    await chrome.offscreen.closeDocument();
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
  const saved = await chrome.storage.session.get([
    "schema",
    "records",
    "recency",
    "paletteContext",
  ]);
  if (saved.schema === 3 && Array.isArray(saved.records))
    for (const r of saved.records as TabRecord[]) {
      if (r.pdf && r.coverage === "indexing") {
        r.coverage = "partial";
        r.indexedAt = 0;
        r.pdf.status = `Searched ${r.pdf.searched} of ${r.pdf.total} pages · interrupted`;
      }
      records.set(r.id, r);
    }
  if (Array.isArray(saved.recency))
    for (const pair of saved.recency) {
      if (
        Array.isArray(pair) &&
        Number.isInteger(pair[0]) &&
        Number.isFinite(pair[1])
      )
        recency.set(pair[0], Math.max(recency.get(pair[0]) ?? 0, pair[1]));
    }
  const paletteContext = saved.paletteContext as
    { popup?: unknown; source?: unknown } | undefined;
  if (
    popup === undefined &&
    Number.isInteger(paletteContext?.popup) &&
    Number.isInteger(paletteContext?.source)
  ) {
    popup = paletteContext!.popup as number;
    fallbackSource = paletteContext!.source as number;
  }
  search.rebuild(records);
  ready = true;
  await reconcile();
}
async function reconcile() {
  const before = JSON.stringify([...records.values()]);
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const ids = new Set(tabs.filter((t) => !t.incognito).map((t) => t.id));
  for (const id of records.keys()) if (!ids.has(id)) records.delete(id);
  for (const id of recency.keys()) if (!ids.has(id)) recency.delete(id);
  const accessByOrigin = new Map<string, Promise<boolean>>();
  for (const tab of tabs)
    if (safeURL(tab.url)) {
      const origin = new URL(tab.url!).origin;
      if (!accessByOrigin.has(origin))
        accessByOrigin.set(origin, allowed(tab.url!));
    }
  await Promise.all(accessByOrigin.values());
  for (const t of tabs) {
    if (t.id === undefined || t.incognito) continue;
    const old = records.get(t.id);
    const url = t.url ?? "";
    const deny = excluded(url, prefs.exclusions);
    const access = safeURL(url)
      ? await accessByOrigin.get(new URL(url).origin)
      : false;
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
      indexedAt: keep ? old.indexedAt : undefined,
      breaks: keep ? old.breaks : undefined,
      pdf: keep ? old.pdf : undefined,
      state: prefs.paused
        ? "metadata-only"
        : deny
          ? "excluded"
          : t.discarded
            ? "unavailable"
            : keep
              ? old.state
              : "metadata-only",
      truncated: keep ? old.truncated : false,
      lastActive: recency.get(t.id) ?? t.lastAccessed ?? 0,
      coverage: prefs.paused
        ? "paused"
        : deny
          ? "excluded"
          : restricted(url)
            ? "restricted"
            : t.discarded
              ? "sleeping"
              : !access
                ? "permission"
                : (pending.has(t.id) || pdfJobs.has(t.id)) &&
                    (!keep || !old.indexedAt)
                  ? "indexing"
                  : keep
                    ? (old.coverage ?? (old.text ? "ready" : "failure"))
                    : "indexing",
    });
  }
  if (before !== JSON.stringify([...records.values()])) await persist();
}
async function inject(id: number) {
  return chrome.scripting.executeScript({
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
  if (tab.status === "loading") {
    const attempt = loadingRetries.get(id) ?? 0;
    if (attempt < 10) {
      loadingRetries.set(id, attempt + 1);
      setTimeout(() => {
        if ((generations.get(id) ?? 0) === generation) schedule(id);
      }, 500);
    }
    return;
  }
  loadingRetries.delete(id);
  if (
    pdfJobs.has(id) ||
    prefs.paused ||
    tab.incognito ||
    restricted(url) ||
    tab.discarded ||
    excluded(url, prefs.exclusions) ||
    !(await allowed(url))
  )
    return;
  try {
    if (/\.pdf$/i.test(new URL(url).pathname)) {
      await startPDF(id, url, generation);
      return;
    }
    const result = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: extractReadable,
    });
    const data = result[0]?.result;
    if (!data || typeof data.text !== "string")
      throw Error("Unsupported extraction");
    if (data.pdf) {
      await startPDF(id, url, generation);
      return;
    }
    if (!data.text) {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          redirect: "error",
          credentials: "include",
          signal: AbortSignal.timeout(3000),
        });
        if (
          response.ok &&
          /^application\/pdf(?:;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        ) {
          await startPDF(id, url, generation);
          return;
        }
      } catch {
        /* Empty HTML and inaccessible PDF keep metadata. */
      }
    }
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
    const previous = records.get(id);
    const text = data.text.slice(0, MAX_TEXT);
    records.set(id, {
      id,
      windowId: current.windowId,
      url,
      title: current.title ?? url,
      text,
      breaks: data.breaks,
      updated:
        previous?.url === url &&
        previous.text === text &&
        JSON.stringify(previous.breaks) === JSON.stringify(data.breaks)
          ? previous.updated
          : Date.now(),
      indexedAt: Date.now(),
      state: "content",
      lastActive: recency.get(id) ?? tab.lastAccessed ?? 0,
      coverage: data.unsupported
        ? "restricted"
        : data.truncated
          ? "partial"
          : data.text
            ? "ready"
            : "empty",
      truncated: data.truncated,
    });
    await persist();
    await inject(id);
  } catch {
    if (
      generation === (generations.get(id) ?? 0) &&
      !prefs.paused &&
      (await allowed(url))
    ) {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          redirect: "error",
          credentials: "include",
          signal: AbortSignal.timeout(3000),
        });
        if (
          response.ok &&
          /^application\/pdf(?:;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        ) {
          await startPDF(id, url, generation);
          return;
        }
      } catch {
        /* Inaccessible sources retain metadata. */
      }
    }
    const r = records.get(id);
    if (
      r &&
      generation === (generations.get(id) ?? 0) &&
      !prefs.paused &&
      r.url === url &&
      !excluded(url, prefs.exclusions) &&
      (await allowed(url))
    ) {
      r.coverage = r.text ? "stale" : "failure";
      r.state = r.text ? "stale" : "unavailable";
      await persist();
    }
  }
}
function schedule(id: number) {
  if (pending.has(id)) {
    rerun.add(id);
    return;
  }
  pending.add(id);
  void enqueue(async () => {
    try {
      await indexTab(id);
    } finally {
      pending.delete(id);
      if (rerun.delete(id)) schedule(id);
    }
  }, false);
}
async function refresh() {
  await initialize();
  await reconcile();
  for (const [id, record] of records)
    if (
      !prefs.paused &&
      !["budget", "failure", "restricted", "sleeping"].includes(
        record.coverage ?? "",
      ) &&
      (record.state !== "content" ||
        Date.now() - (record.indexedAt ?? record.updated) > 300_000)
    )
      schedule(id);
}
function fallback(notice?: string): Promise<void> {
  fallbackSource = originWindow;
  if (fallbackFlight) return fallbackFlight;
  fallbackFlight = openFallback(notice).finally(() => {
    fallbackFlight = undefined;
  });
  return fallbackFlight;
}
async function savePaletteContext() {
  if (popup !== undefined && fallbackSource !== undefined)
    await chrome.storage.session.set({
      paletteContext: { popup, source: fallbackSource },
    });
}
async function openFallback(notice?: string) {
  fallbackSource = originWindow;
  if (popup === undefined) {
    const windows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ["popup"],
    });
    popup = windows.find((w) =>
      w.tabs?.some(
        (t) => t.url?.split("?")[0] === chrome.runtime.getURL("palette.html"),
      ),
    )?.id;
  }
  if (popup !== undefined) {
    try {
      await chrome.windows.update(popup, { focused: true });
      await savePaletteContext();
      return;
    } catch {
      popup = undefined;
    }
  }
  const win = await chrome.windows.create({
    url:
      chrome.runtime.getURL("palette.html") +
      `?window=${originWindow ?? ""}${notice ? "&notice=" + encodeURIComponent(notice) : ""}`,
    type: "popup",
    width: 700,
    height: 700,
  });
  popup = win?.id;
  await savePaletteContext();
}
async function bounded<T>(work: Promise<T>, ms = 1800): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("UI unavailable")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function invoke(tab?: chrome.tabs.Tab) {
  const serial = ++invocation;
  const token = crypto.randomUUID();
  let target: chrome.tabs.Tab | undefined;
  try {
    target =
      tab ??
      (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (serial !== invocation) return;
    originWindow =
      target?.windowId === popup ? fallbackSource : target?.windowId;
    if (overlayTab !== undefined && overlayTab !== target?.id) {
      await bounded(
        chrome.tabs.sendMessage(overlayTab, { type: "close" }),
      ).catch(() => {});
      overlayTab = undefined;
      if (serial !== invocation) return;
    }
    if (!target?.id || !safeURL(target.url) || target.discarded) throw Error();
    const id = target.id;
    const injected = await bounded(inject(id));
    const documentId = injected[0]?.documentId;
    if (serial !== invocation) return;
    const current = await chrome.tabs.get(id);
    if (current.url !== target.url) throw Error();
    overlayTab = id;
    const ready = new Promise<boolean>((resolve) => {
      overlayWaits.set(token, {
        tab: id,
        url: target!.url!,
        documentId,
        uiInvocation: token,
        resolve,
      });
    });
    // The content agent returns the frame's persistent invocation on refocus.
    const response = await bounded(
      chrome.tabs.sendMessage(
        id,
        { type: "open", invocation: token, windowId: target.windowId },
        documentId ? { documentId } : undefined,
      ),
    );
    const wait = overlayWaits.get(token);
    if (wait && typeof response?.pendingInvocation === "string")
      wait.uiInvocation = response.pendingInvocation;
    if (response?.ready === true) overlayWaits.get(token)?.resolve(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const usable = await Promise.race([
      ready,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 1800);
      }),
    ]);
    clearTimeout(timer);
    overlayWaits.delete(token);
    if (serial !== invocation) return;
    if (!usable) throw Error();
  } catch {
    overlayWaits.delete(token);
    if (serial !== invocation) return;
    if (target?.id)
      await bounded(
        chrome.tabs.sendMessage(target.id, { type: "close" }),
      ).catch(() => {});
    overlayTab = undefined;
    await fallback();
  }
  void enqueue(refresh);
}
chrome.tabs.onActivated.addListener(({ tabId }) => {
  recency.set(tabId, Date.now());
  void enqueue(async () => {
    await initialize();
    await reconcile();
    await persist();
  });
});
chrome.action.onClicked.addListener((t) => {
  void invoke(t);
});
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-search") void invoke();
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  bump(removed);
  bump(added);
  void enqueue(async () => {
    await initialize();
    records.delete(removed);
    await reconcile();
  });
  schedule(added);
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
  invalidateViews();
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
function readFilters(
  value: unknown,
  sender: chrome.runtime.MessageSender,
): SearchFilters {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid filters");
  const f = value as Record<string, unknown>;
  if (
    (f.pageText !== undefined && typeof f.pageText !== "boolean") ||
    (f.thisWindow !== undefined && typeof f.thisWindow !== "boolean") ||
    (f.exactHost !== undefined && typeof f.exactHost !== "boolean") ||
    (f.domain !== undefined &&
      (typeof f.domain !== "string" || f.domain.length > 253))
  )
    throw Error("Invalid filters");
  const sourceWindow = new URL(sender.url!).searchParams.get("window");
  const fallbackOrigin =
    sender.tab?.windowId === popup ? fallbackSource : undefined;
  return {
    pageText: f.pageText === true,
    domain: f.domain as string | undefined,
    exactHost: f.exactHost === true,
    windowId: f.thisWindow
      ? fallbackOrigin !== undefined
        ? fallbackOrigin
        : sourceWindow && /^\d+$/.test(sourceWindow)
          ? Number(sourceWindow)
          : (sender.tab?.windowId ?? originWindow ?? -1)
      : undefined,
  };
}
function coverageFilter(r: TabRecord, f: SearchFilters) {
  // Coverage includes missing bodies even with the Page text filter enabled.
  return matchesFilters(r, { ...f, pageText: false });
}
async function destinationNotice(id: number, text: string) {
  try {
    await inject(id);
    const delivered = await chrome.tabs.sendMessage(id, {
      type: "notice",
      text,
    });
    if (delivered !== true) throw Error();
  } catch {
    await chrome.action.setBadgeText({ tabId: id, text: "!" }).catch(() => {});
    await chrome.action.setTitle({ tabId: id, title: text }).catch(() => {});
    setTimeout(() => {
      void chrome.action.setBadgeText({ tabId: id, text: "" }).catch(() => {});
      void chrome.action
        .setTitle({ tabId: id, title: "TabScope" })
        .catch(() => {});
    }, 8000);
  }
}
function uiSender(sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id) return false;
  const documentURL = (sender.url ?? "").split("?")[0].split("#")[0];
  return ["palette.html", "overlay.html"].some(
    (page) => documentURL === chrome.runtime.getURL(page),
  );
}

chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  const m = message as Record<string, unknown>;
  if (m.type === "pdf-progress") {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("pdf-offscreen.html") ||
      sender.tab ||
      typeof m.token !== "string" ||
      typeof m.text !== "string" ||
      m.text.length > MAX_TEXT ||
      !m.info ||
      typeof m.info !== "object"
    )
      return;
    const found = [...pdfJobs.entries()].find(
      ([, job]) => job.token === m.token,
    );
    if (!found) {
      reply(false);
      return;
    }
    const [id, job] = found;
    void enqueue(async () => {
      const tab = await chrome.tabs.get(id).catch(() => undefined);
      if (
        !tab ||
        tab.discarded ||
        !validCommit(
          job.generation,
          generations.get(id) ?? 0,
          job.url,
          tab.url ?? "",
          prefs.paused,
          excluded(job.url, prefs.exclusions) || !(await allowed(job.url)),
        ) ||
        pdfJobs.get(id) !== job
      )
        return false;
      const info = m.info as PDFInfo;
      if (
        !Array.isArray(info.pages) ||
        info.pages.length > 40 ||
        !Number.isInteger(info.total) ||
        typeof info.status !== "string" ||
        info.status.length > 200 ||
        !Number.isInteger(info.searched) ||
        info.searched < 0 ||
        info.searched > 40 ||
        !Number.isInteger(info.textPages) ||
        info.textPages < 0 ||
        info.textPages > info.searched ||
        info.total < info.searched ||
        (info.identity !== undefined &&
          (typeof info.identity !== "string" || info.identity.length > 128)) ||
        !info.pages.every(
          (p, i) =>
            p &&
            Number.isInteger(p.page) &&
            p.page === i + 1 &&
            Number.isInteger(p.start) &&
            Number.isInteger(p.end) &&
            p.start >= 0 &&
            p.end >= p.start &&
            p.end <= (m.text as string).length &&
            (p.label === undefined ||
              (typeof p.label === "string" && p.label.length <= 128)),
        )
      )
        return false;
      const old = records.get(id);
      records.set(id, {
        id,
        windowId: tab.windowId,
        title: tab.title ?? job.url,
        url: job.url,
        text: m.text as string,
        updated:
          old &&
          old.pdf?.identity === info.identity &&
          (old.text.startsWith(m.text as string) ||
            (m.text as string).startsWith(old.text))
            ? old.updated
            : job.revision,
        indexedAt: Date.now(),
        state: "content",
        pdf: info,
        lastActive: old?.lastActive,
        coverage: m.done
          ? !info.textPages
            ? "empty"
            : info.truncated ||
                info.searched < info.total ||
                info.textPages < info.searched
              ? "partial"
              : "ready"
          : "indexing",
        truncated: info.truncated || info.searched < info.total,
      });
      await persist();
      return true;
    }).then(reply, () => reply(false));
    return true;
  }
  if (m.type === "overlay-ready") {
    const wait =
      typeof m.invocation === "string" && /^[a-f0-9-]{36}$/.test(m.invocation)
        ? [...overlayWaits.values()].find(
            (w) => w.uiInvocation === m.invocation && w.tab === sender.tab?.id,
          )
        : undefined;
    if (
      wait &&
      uiSender(sender) &&
      sender.tab?.id === wait.tab &&
      sender.frameId !== 0 &&
      typeof sender.documentId === "string"
    ) {
      // Verify the current top document, not a page-supplied URL.
      void chrome.tabs
        .get(wait.tab)
        .then(async (tab) => {
          const top = await chrome.scripting.executeScript({
            target: { tabId: wait.tab },
            func: () => location.href,
          });
          if (
            tab.url === wait.url &&
            (!wait.documentId || top[0]?.documentId === wait.documentId) &&
            [...overlayWaits.values()].includes(wait)
          ) {
            await chrome.tabs
              .sendMessage(wait.tab, {
                type: "ui-ready",
                invocation: m.invocation,
              })
              .catch(() => {});
            for (const w of overlayWaits.values())
              if (
                w.tab === wait.tab &&
                w.uiInvocation === m.invocation &&
                w.documentId === wait.documentId
              )
                w.resolve(true);
            reply(true);
          } else reply(false);
        })
        .catch(() => reply(false));
      return true;
    }
    reply(false);
    return;
  }
  if (m.type === "dirty") {
    if (
      sender.id === chrome.runtime.id &&
      sender.tab?.id !== undefined &&
      sender.frameId === 0 &&
      typeof m.url === "string" &&
      m.url === sender.url
    ) {
      bump(sender.tab.id);
      const r = records.get(sender.tab.id);
      if (r?.text) r.coverage = "stale";
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
        const filters = readFilters(m.filters, sender);
        return {
          hits: search.search(m.query, filters),
          coverage: [...records.values()]
            .filter((r) => coverageFilter(r, filters))
            .map((r) => ({
              id: r.id,
              title: r.title,
              url: r.url,
              reason: r.coverage ?? "failure",
              detail: r.pdf?.status,
            })),
          total: [...records.values()].filter((r) => coverageFilter(r, filters))
            .length,
          searchable: [...records.values()].filter(
            (r) =>
              !!r.text && r.coverage !== "stale" && coverageFilter(r, filters),
          ).length,
          indexing: [...records.values()].filter(
            (r) => pending.has(r.id) && coverageFilter(r, filters),
          ).length,
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
        invalidateViews();
        for (const id of records.keys()) schedule(id);
        return prefs;
      }
      case "clear": {
        invalidateViews();
        prefs.paused = true;
        records.clear();
        search.rebuild(records);
        await chrome.storage.local.set({ preferences: prefs });
        await chrome.storage.session.clear();
        await savePaletteContext();
        return prefs;
      }
      case "resume": {
        prefs.paused = false;
        await chrome.storage.local.set({ preferences: prefs });
        await refresh();
        return prefs;
      }
      case "recover": {
        if (
          !Number.isInteger(m.id) ||
          !["retry", "load", "include"].includes(String(m.action))
        )
          throw Error("Invalid recovery");
        const id = m.id as number;
        await reconcile();
        const r = records.get(id);
        if (!r || r.url !== m.url)
          throw Error("That page changed. Search again.");
        if (prefs.paused) throw Error("Resume indexing first.");
        if (m.action === "include") {
          if (r.coverage !== "excluded")
            throw Error("This site is already included.");
          prefs.exclusions = prefs.exclusions.filter(
            (host) => !excluded(r.url, [host]),
          );
          await chrome.storage.local.set({ preferences: prefs });
          bump(id);
          await reconcile();
        } else if (m.action === "load") {
          if (r.coverage !== "sleeping")
            throw Error("This tab is already loaded.");
          await chrome.windows.update(r.windowId, { focused: true });
          await chrome.tabs.update(id, { active: true });
          return true; // onUpdated schedules extraction after loading.
        } else if (!["failure", "budget", "stale"].includes(r.coverage ?? ""))
          throw Error("Retry is unavailable for this tab.");
        if (excluded(r.url, prefs.exclusions) || !(await allowed(r.url)))
          throw Error("Website access is required.");
        if (Date.now() - (retries.get(id) ?? 0) < 30_000)
          throw Error("Please wait before retrying this tab.");
        retries.set(id, Date.now());
        schedule(id);
        return true;
      }
      case "refresh":
        await refresh();
        return prefs;
      case "close": {
        if (
          sender.tab?.id !== undefined &&
          (sender.url ?? "").includes("/overlay.html")
        )
          await chrome.tabs
            .sendMessage(sender.tab.id, {
              type: "close",
              invocation: new URL(sender.url!).searchParams.get("invocation"),
            })
            .catch(() => {});
        return true;
      }
      case "navigate": {
        if (
          !Number.isInteger(m.id) ||
          typeof m.query !== "string" ||
          m.query.length > 500 ||
          (m.passageId !== undefined &&
            (typeof m.passageId !== "string" || m.passageId.length > 100))
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
        const changed =
          tab.url !== r.url ||
          (m.url !== undefined && m.url !== tab.url) ||
          (m.updated !== undefined && m.updated !== r.updated);
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(id, { active: true });
        if (changed) {
          await destinationNotice(
            id,
            "Tab opened. The original passage could not be located because the page changed.",
          );
          return { activated: true };
        }
        if (!m.query || !r.text) return { activated: true };
        const hit = search
          .search(m.query, readFilters(m.filters, sender))
          .find((h) => h.id === id);
        const target =
          m.passageId === undefined
            ? hit?.passage
            : hit?.passages?.find((p) => p.id === m.passageId);
        if (m.passageId !== undefined && !target) {
          await destinationNotice(
            id,
            "This page changed. The passage could not be located.",
          );
          return { activated: true, highlighted: false };
        }
        if (r.pdf && target?.page) {
          if (
            prefs.paused ||
            excluded(r.url, prefs.exclusions) ||
            !(await allowed(r.url))
          )
            throw Error("Website access is required.");
          const nextURL = pdfPageURL(tab.url!, target.page);
          // Native viewer does not consistently apply fragment-only changes.
          // Reload the same tab at the new fragment; no duplicate reader tab.
          await chrome.tabs.update(id, { url: nextURL });
          // Wait until Chrome commits the hash before reloading the PDF reader.
          for (let attempt = 0; attempt < 20; attempt++) {
            if ((await chrome.tabs.get(id)).url === nextURL) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          await chrome.tabs.reload(id);

          return { activated: true, page: target.page, highlighted: false };
        }
        try {
          await inject(id);
          const hit = search
            .search(m.query, readFilters(m.filters, sender))
            .find((h) => h.id === id);
          if (!target) return { activated: true, highlighted: false };
          const found = await chrome.tabs.sendMessage(id, {
            type: "navigate-match-v2",
            excerpt: target.text,
            passages: hit?.passages,
            passageId: target.id,
            matchesCapped: hit?.passagesCapped,
            query: hit?.matchedTerms?.join(" ") ?? m.query,
            expectedURL: tab.url,
            start: target.start,
          });
          if (hit?.passage && !found)
            await destinationNotice(
              id,
              "Tab opened. The original passage could not be located on this page.",
            );
          return { activated: true, highlighted: found === true };
        } catch {
          await destinationNotice(
            id,
            "Tab opened. Passage highlighting is unavailable on this page.",
          );
          return { activated: true };
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
