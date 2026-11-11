import { wordSpans, tokenize } from "./search";
import { extractReadable } from "./extract";
import type { Passage } from "./types";
import tokensCSS from "./styles/tokens.css";
// Inline positioning survives host CSP; backdrop values share the UI tokens.
const backdrop = /--backdrop:\s*([^;]+)/.exec(tokensCSS)![1];
const backdropBlur = /--backdrop-blur:\s*([^;]+)/.exec(tokensCSS)![1];
// Isolated world singleton; reinjection must not duplicate observers/listeners.
declare const __TABSCOPE_AGENT_VERSION__: string;
const version =
  typeof __TABSCOPE_AGENT_VERSION__ === "string"
    ? __TABSCOPE_AGENT_VERSION__
    : "test";
const own = globalThis as typeof globalThis & {
  __tabscope?: boolean;
  __tabscopeAgent?: { version: string; dispose: () => void };
};
if (own.__tabscopeAgent?.version !== version) {
  own.__tabscopeAgent?.dispose();
  // Extension reloads invalidate the old isolated world, so its disposer may
  // no longer be reachable even though its overlay remains in the page.
  const orphan = document.getElementById("tabscope-root");
  if (orphan?.dataset.tabscopeBlockedBody === "true" && document.body)
    document.body.inert = false;
  orphan?.remove();
  own.__tabscope = true;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let sourceRevision = 0;
  let host: HTMLElement | null = null,
    prior: Element | null = null,
    timer: ReturnType<typeof setTimeout> | undefined,
    last = 0;
  let activeInvocation = "";
  let usable = false;
  let blockedBody: HTMLElement | null = null;
  const focusOverlay = () => {
    const frame = host?.shadowRoot?.querySelector("iframe");
    frame?.focus();
    // Focusing a cross-origin frame can leave its document focused without a
    // caret in the search field. Ask the frame to focus its actual input too.
    frame?.contentWindow?.postMessage(
      { type: "tabscope-focus-search", invocation: activeInvocation },
      chrome.runtime.getURL(""),
    );
  };
  const releasePage = () => {
    if (blockedBody) blockedBody.inert = false;
    blockedBody = null;
  };
  let closing: Animation | undefined;
  const close = (animate = true) => {
    if (closing && animate) return;
    const finish = () => {
      usable = false;
      host?.remove();
      host = null;
      closing = undefined;
      releasePage();
      if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
    };
    if (animate && host?.animate) {
      const current = getComputedStyle(host).opacity;
      host.getAnimations().forEach((animation) => animation.cancel());
      closing = host.animate([{ opacity: current }, { opacity: 0 }], {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 80
          : 120,
        easing: "ease-out",
        fill: "forwards",
      });
      void closing.finished.then(finish, () => {});
    } else {
      closing?.cancel();
      finish();
    }
  };
  document.addEventListener(
    "focusin",
    (event) => {
      // Page editors can request focus after the extension action opens. Keep
      // focus inside the modal iframe without interfering with its controls.
      if (host?.isConnected && !event.composedPath().includes(host))
        focusOverlay();
    },
    { capture: true, signal },
  );
  const open = (invocation: string, windowId: number) => {
    if (host?.isConnected) {
      if (closing) {
        const current = getComputedStyle(host).opacity;
        closing.cancel();
        closing = undefined;
        host.animate([{ opacity: current }, { opacity: 1 }], {
          duration: 140,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        });
      }
      focusOverlay();
      return;
    }
    activeInvocation = invocation;
    usable = false;
    prior = document.activeElement;
    host = document.createElement("div");
    host.id = "tabscope-root";
    host.style.cssText = `all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;isolation:isolate!important;background:${backdrop}!important;backdrop-filter:blur(${backdropBlur})!important`;
    const shadow = host.attachShadow({ mode: "open" });
    const frame = document.createElement("iframe");
    frame.title = "TabScope search";
    frame.src =
      chrome.runtime.getURL("overlay.html") +
      `?invocation=${encodeURIComponent(invocation)}&window=${windowId}`;
    frame.style.cssText =
      "display:block;width:100%;height:100%;border:0;outline:none;background:transparent;color-scheme:normal";
    frame.addEventListener("load", focusOverlay, { signal });
    shadow.append(frame);
    // The overlay is a sibling of body, so only the underlying page becomes
    // inert. Preserve a body that was already inert before opening.
    if (document.body && !document.body.inert) {
      blockedBody = document.body;
      blockedBody.inert = true;
      host.dataset.tabscopeBlockedBody = "true";
    }
    document.documentElement.append(host);
    if (host.animate)
      host.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 100
          : 160,
        easing: "ease-out",
      });
    focusOverlay();
  };
  let restoreActive: (() => boolean) | undefined;
  let restoreQueued = false;
  let activeRanges: { range: Range; text: string }[] = [];
  const clearInk = () => {
    (
      CSS as typeof CSS & { highlights?: Map<string, unknown> }
    ).highlights?.delete("tabscope-active-match");
    document.getElementById("tabscope-active-highlight-style")?.remove();
    activeRanges = [];
  };
  const cleanupHighlight = () => {
    restoreActive = undefined;
    clearInk();
    document.getElementById("tabscope-match-navigator")?.remove();
  };
  window.addEventListener("pagehide", cleanupHighlight, { signal });
  const dismissOutside = (event: Event) => {
    const nav = document.getElementById("tabscope-match-navigator");
    if (
      (activeRanges.length || nav) &&
      !event.composedPath().includes(nav as EventTarget)
    )
      cleanupHighlight();
  };
  document.addEventListener("pointerdown", dismissOutside, {
    capture: true,
    signal,
  });
  document.addEventListener("click", dismissOutside, { capture: true, signal });
  document.addEventListener(
    "keydown",
    (event) => {
      const nav = document.getElementById("tabscope-match-navigator");
      if (
        nav &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        // Keep caret movement, form controls, page widgets and browser history
        // shortcuts native. These arrows apply only to an active find session.
        const editing = event
          .composedPath()
          .some(
            (target) =>
              target instanceof Element &&
              target.closest(
                'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="tab"],[role="option"],[role="gridcell"],video,audio',
              ),
          );
        if (editing) return;
        event.preventDefault();
        event.stopPropagation();
        const control =
          nav.querySelectorAll("button")[event.key === "ArrowLeft" ? 0 : 1];
        if (control && !control.disabled) control.click();
        return;
      }
      if (
        event.key === "Escape" &&
        document.getElementById("tabscope-match-navigator")
      ) {
        event.preventDefault();
        event.stopPropagation();
        cleanupHighlight();
      }
    },
    { signal },
  );
  function highlight(
    excerpt: string,
    query: string,
    start: number,
    evidence?: Passage,
    data = extractReadable(true),
  ) {
    cleanupHighlight();
    const target = excerpt.trim();
    const combined = data.text;
    const nodes = data.segments ?? [];
    // Select the occurrence nearest its indexed source offset; never jump to a
    // random query word when the selected passage has disappeared.
    let at = -1;
    let cursor = 0;
    let distance = Infinity;
    for (let count = 0; count < 1000; count++) {
      const occurrence = combined.indexOf(target, cursor);
      if (occurrence < 0) break;
      const context = evidence
        ? Number(
            combined.slice(
              Math.max(0, occurrence - evidence.before.length),
              occurrence,
            ) === evidence.before,
          ) +
          Number(
            combined.slice(
              occurrence + target.length,
              occurrence + target.length + evidence.after.length,
            ) === evidence.after,
          )
        : 0;
      const delta = Math.abs(occurrence - start) - context * 200_000;
      if (delta < distance) {
        at = occurrence;
        distance = delta;
      }
      cursor = occurrence + Math.max(1, target.length);
    }
    let len = target.length;
    if (at < 0 || !len) return false;
    const terms = tokenize(query);
    const matches = wordSpans(combined.slice(at, at + len)).filter((w) =>
      terms.some((t) => w.term.startsWith(t)),
    );
    if (evidence?.ranges.length) {
      const offset = evidence.ranges[0].start - evidence.start;
      len = evidence.ranges.at(-1)!.end - evidence.start - offset;
      at += offset;
    } else if (matches.length) {
      const offset = matches[0].start;
      len = matches[matches.length - 1].end - offset;
      at += offset;
    }
    const relocatedStart =
      at -
      (evidence?.ranges.length ? evidence.ranges[0].start - evidence.start : 0);
    const end = at + len - 1;
    const first = nodes.find(
      (n) => n.start <= at && at < n.start + n.map.length,
    );
    const final = nodes.find(
      (n) => n.start <= end && end < n.start + n.map.length,
    );
    if (!first?.node || !final?.node) return false;
    const range = document.createRange();
    range.setStart(first.node, first.map[at - first.start]);
    range.setEnd(final.node, final.map[end - final.start] + 1);
    const css = CSS as typeof CSS & { highlights: Map<string, unknown> };
    const HighlightCtor = (
      globalThis as unknown as {
        Highlight: new (...ranges: Range[]) => unknown;
      }
    ).Highlight;
    if (!HighlightCtor || !css.highlights) return false;
    let style = document.getElementById("tabscope-active-highlight-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "tabscope-active-highlight-style";
      style.textContent =
        "::highlight(tabscope-active-match){background:#ffe18a;color:#222;text-decoration:underline;text-decoration-thickness:2px}";
      document.documentElement.append(style);
    }
    const ranges = evidence?.ranges.length
      ? evidence.ranges.flatMap((match) => {
          const a = relocatedStart + match.start - evidence.start,
            b = relocatedStart + match.end - evidence.start - 1;
          const f = nodes.find(
              (n) => n.start <= a && a < n.start + n.map.length,
            ),
            l = nodes.find((n) => n.start <= b && b < n.start + n.map.length);
          if (!f?.node || !l?.node) return [];
          const r = document.createRange();
          r.setStart(f.node, f.map[a - f.start]);
          r.setEnd(l.node, l.map[b - l.start] + 1);
          return [r];
        })
      : [range];
    if (!ranges.length) return false;
    css.highlights.set("tabscope-active-match", new HighlightCtor(...ranges));
    activeRanges = ranges.map((range) => ({ range, text: range.toString() }));
    first.node.parentElement?.scrollIntoView({
      block: "center",
      behavior: "instant",
    });
    // Center the actual range within each nested scroll container. Centering a
    // whole long paragraph can leave the words outside its visible portion.
    for (
      let parent = first.node.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (
        parent.scrollHeight > parent.clientHeight &&
        /(auto|scroll)/.test(getComputedStyle(parent).overflowY)
      ) {
        const box = parent.getBoundingClientRect(),
          match = range.getBoundingClientRect?.();
        if (match)
          parent.scrollTop += match.top - box.top - parent.clientHeight / 2;
      }
    }
    const rect = range.getBoundingClientRect?.();
    if (rect && (rect.top < 100 || rect.bottom > innerHeight - 80))
      window.scrollBy({ top: rect.top - innerHeight / 2, behavior: "instant" });
    return true;
  }
  const onMessage: Parameters<
    typeof chrome.runtime.onMessage.addListener
  >[0] = (m, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab ||
      !m ||
      typeof m !== "object"
    )
      return;
    if (m.type === "clear-highlights") {
      cleanupHighlight();
      reply(true);
    }
    if (m.type === "ui-ready" && m.invocation === activeInvocation) {
      usable = true;
      focusOverlay();
      reply(true);
    }
    if (
      m.type === "notice" &&
      typeof m.text === "string" &&
      m.text.length <= 200
    ) {
      document
        .querySelectorAll("#tabscope-notice")
        .forEach((note) => note.remove());
      const note = document.createElement("div");
      note.id = "tabscope-notice";
      note.setAttribute("role", "status");
      note.style.cssText =
        "position:fixed;bottom:24px;left:24px;max-width:calc(100vw - 64px);padding:12px 16px;background:#24272d;color:#fff;border-radius:12px;z-index:2147483647;font:14px/1.5 system-ui;box-shadow:0 4px 24px #0004";
      note.textContent = m.text;
      const dismiss = document.createElement("button");
      dismiss.textContent = "Dismiss";
      dismiss.style.cssText =
        "margin-left:12px;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;padding:4px";
      dismiss.onclick = () => note.remove();
      note.append(dismiss);
      document.documentElement.append(note);
      setTimeout(() => note.remove(), 7000);
      reply(true);
    }
    if (
      (m?.type === "open" || m?.type === "toggle") &&
      typeof m.invocation === "string" &&
      m.invocation.length <= 80 &&
      Number.isInteger(m.windowId)
    ) {
      if (m.type === "toggle" && host?.isConnected && !closing) {
        close();
        reply({ closed: true });
        return;
      }
      cleanupHighlight();
      open(m.invocation, m.windowId);
      reply({
        ready:
          usable && !!host?.shadowRoot?.querySelector("iframe")?.isConnected,
        pendingInvocation: activeInvocation,
      });
    }
    if (
      m?.type === "close" &&
      (!m.invocation || m.invocation === activeInvocation)
    ) {
      close();
      reply(true);
    }
    if (
      m?.type === "navigate-match-v2" &&
      typeof m.excerpt === "string" &&
      typeof m.query === "string" &&
      m.query.length <= 500 &&
      m.excerpt.length <= 300 &&
      m.expectedURL === location.href &&
      Number.isInteger(m.start)
    ) {
      close(false);
      const passages: Passage[] = Array.isArray(m.passages)
        ? m.passages
            .slice(0, 32)
            .filter(
              (p: Passage) =>
                p &&
                typeof p.text === "string" &&
                p.text.length <= 300 &&
                Array.isArray(p.ranges) &&
                typeof p.before === "string" &&
                typeof p.after === "string",
            )
        : [];
      // A passage can contain several matching words. Destination navigation
      // follows each distinct occurrence, not just each context paragraph.
      const seen = new Set<string>();
      const matches = passages
        .flatMap((p) =>
          p.ranges.slice(0, 240).flatMap((range) => {
            if (
              !Number.isInteger(range.start) ||
              !Number.isInteger(range.end) ||
              range.start < p.start ||
              range.end > p.end ||
              range.end <= range.start
            )
              return [];
            const key = `${range.start}:${range.end}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [
              {
                ...p,
                passageId: p.id,
                ranges: [range],
                matchStart: range.start,
              },
            ];
          }),
        )
        .sort((a, b) => a.matchStart - b.matchStart)
        .slice(0, 2048);
      let index = Math.max(
        0,
        matches.findIndex((p) => p.passageId === m.passageId),
      );
      let cachedSource: ReturnType<typeof extractReadable> | undefined;
      let cachedRevision = -1;
      const show = () => {
        if (!cachedSource || cachedRevision !== sourceRevision) {
          cachedSource = extractReadable(true);
          cachedRevision = sourceRevision;
        }
        const focused = document
          .getElementById("tabscope-match-navigator")
          ?.contains(document.activeElement)
          ? document.activeElement?.textContent
          : undefined;
        const p = matches[index];
        const found = highlight(
          p?.text ?? m.excerpt,
          m.query,
          p?.start ?? m.start,
          p,
          cachedSource,
        );
        if (found) restoreActive = show;
        if (matches.length && found) {
          const nav = document.createElement("div");
          nav.id = "tabscope-match-navigator";
          nav.setAttribute("role", "region");
          nav.setAttribute("aria-label", "Passage navigation");
          nav.style.cssText =
            "position:fixed;bottom:16px;right:16px;max-width:calc(100vw - 32px);flex-wrap:wrap;z-index:2147483647;background:#24272d;color:white;border-radius:12px;padding:8px;display:flex;gap:8px;align-items:center;font:13px system-ui;box-shadow:0 4px 24px #0004";
          const control = (label: string, fn: () => void) => {
            const b = document.createElement("button");
            b.textContent = label;
            b.style.cssText =
              "font:inherit;color:inherit;background:transparent;border:1px solid #888;border-radius:6px;min-height:32px;padding:4px 8px";
            b.onclick = fn;
            return b;
          };
          const prev = control("Previous", () => {
            index--;
            show();
          });
          prev.disabled = index <= 0;
          prev.title = "Previous match (←)";
          prev.setAttribute("aria-keyshortcuts", "ArrowLeft");
          const next = control("Next", () => {
            index++;
            show();
          });
          next.disabled = index >= matches.length - 1;
          next.title = "Next match (→)";
          next.setAttribute("aria-keyshortcuts", "ArrowRight");
          nav.append(
            prev,
            document.createTextNode(
              `Match ${index + 1} of ${matches.length}${m.matchesCapped || seen.size > 2048 ? "+" : ""}`,
            ),
            next,
            Object.assign(document.createElement("span"), {
              textContent: "← →",
              title:
                "Use Left and Right arrow keys to jump; click elsewhere to finish",
            }),
            control("Dismiss", cleanupHighlight),
          );
          document.documentElement.append(nav);
          if (focused)
            (
              [prev, next].find(
                (b) => b.textContent === focused && !b.disabled,
              ) ?? [prev, next].find((b) => !b.disabled)
            )?.focus();
        }
        if (!found && passages.length) {
          document
            .querySelectorAll("#tabscope-notice")
            .forEach((note) => note.remove());
          const note = document.createElement("div");
          note.id = "tabscope-notice";
          note.setAttribute("role", "status");
          note.style.cssText =
            "position:fixed;bottom:16px;left:16px;background:#24272d;color:white;padding:12px;border-radius:12px;z-index:2147483647;font:13px system-ui";
          note.textContent =
            "This page changed. The passage could not be located.";
          document.documentElement.append(note);
        }
        return found;
      };
      reply(show());
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.every((m) => {
        if (
          m.type === "childList" &&
          [...m.addedNodes, ...m.removedNodes].length &&
          [...m.addedNodes, ...m.removedNodes].every(
            (n) =>
              n instanceof Element &&
              n.matches(
                "#tabscope-root,#tabscope-active-highlight-style,#tabscope-notice,#tabscope-match-navigator",
              ),
          )
        )
          return true;
        const e =
          m.target instanceof Element ? m.target : m.target.parentElement;
        return !!e?.closest(
          "#tabscope-root,#tabscope-active-highlight-style,#tabscope-notice,#tabscope-match-navigator",
        );
      })
    )
      return;
    sourceRevision++;
    // Ads, clocks, lazy loading and unrelated style changes must not dismiss
    // destination navigation or immediately erase an otherwise valid match.
    if (
      activeRanges.some(
        ({ range, text }) =>
          !range.startContainer.isConnected || range.toString() !== text,
      )
    ) {
      const restore = restoreActive;
      clearInk();
      if (restore && !restoreQueued) {
        restoreQueued = true;
        queueMicrotask(() => {
          restoreQueued = false;
          if (restoreActive === restore) restore();
        });
      }
    }
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        last = Date.now();
        chrome.runtime
          .sendMessage({ type: "dirty", url: location.href })
          .catch(() => {});
      },
      Math.max(1500, 5000 - (Date.now() - last)),
    );
  });
  const observe = () =>
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "class", "style"],
    });
  observe();
  window.addEventListener(
    "pagehide",
    () => {
      clearTimeout(timer);
      observer.disconnect();
      cleanupHighlight();
      closing?.cancel();
      closing = undefined;
      host?.remove();
      host = null;
      releasePage();
      usable = false;
    },
    { signal },
  );
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) observe();
    },
    { signal },
  );
  own.__tabscopeAgent = {
    version,
    dispose: () => {
      lifetime.abort();
      observer.disconnect();
      clearTimeout(timer);
      cleanupHighlight();
      close(false);
      chrome.runtime.onMessage.removeListener(onMessage);
    },
  };
}
