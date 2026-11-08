import { wordSpans, tokenize } from "./search";
import tokensCSS from "./styles/tokens.css";
// Inline positioning survives host CSP; backdrop values share the UI tokens.
const backdrop = /--backdrop:\s*([^;]+)/.exec(tokensCSS)![1];
const backdropBlur = /--backdrop-blur:\s*([^;]+)/.exec(tokensCSS)![1];
// Isolated world singleton; reinjection must not duplicate observers/listeners.
const own = globalThis as typeof globalThis & { __tabscope?: boolean };
if (!own.__tabscope) {
  own.__tabscope = true;
  let host: HTMLElement | null = null,
    prior: Element | null = null,
    timer: ReturnType<typeof setTimeout> | undefined,
    last = 0;
  let activeInvocation = "";
  let usable = false;
  const close = () => {
    usable = false;
    host?.remove();
    host = null;
    if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
  };
  const open = (invocation: string, windowId: number) => {
    if (host?.isConnected) {
      host.shadowRoot?.querySelector("iframe")?.focus();
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
    shadow.append(frame);
    document.documentElement.append(host);
    frame.focus();
  };
  function highlight(excerpt: string, query: string, start: number) {
    // Use the selected source passage without clipping markers.
    const target = excerpt.replace(/^…|…$/g, "").trim();
    const walker = document.createTreeWalker(
      document.body ?? document.documentElement,
      NodeFilter.SHOW_TEXT,
    );
    const nodes: { node: Node; start: number; map: number[] }[] = [];
    let combined = "";
    let count = 0;
    while (walker.nextNode() && combined.length < 100_000 && count++ < 20_000) {
      const node = walker.currentNode;
      const p = node.parentElement;
      if (
        !p ||
        p.closest(
          'script,style,noscript,template,svg,canvas,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),#tabscope-root,#tabscope-notice,[hidden],[aria-hidden="true"]',
        )
      )
        continue;
      let visible = true;
      for (let e: Element | null = p; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.opacity === "0"
        ) {
          visible = false;
          break;
        }
      }
      if (!visible) continue;
      const raw = (node.textContent ?? "").slice(0, 100_000 - combined.length);
      const map: number[] = [];
      let compact = "";
      let space = false;
      for (let i = 0; i < raw.length; i++) {
        if (/\s/.test(raw[i])) {
          if (compact && !space) {
            compact += " ";
            map.push(i);
          }
          space = true;
        } else {
          compact += raw[i];
          map.push(i);
          space = false;
        }
      }
      if (compact.endsWith(" ")) {
        compact = compact.slice(0, -1);
        map.pop();
      }
      if (!compact) continue;
      if (combined) combined += " ";
      nodes.push({ node, start: combined.length, map });
      combined += compact;
    }
    // Select the occurrence nearest its indexed source offset; never jump to a
    // random query word when the selected passage has disappeared.
    let at = -1;
    let cursor = 0;
    let distance = Infinity;
    for (let count = 0; count < 1000; count++) {
      const occurrence = combined.indexOf(target, cursor);
      if (occurrence < 0) break;
      const delta = Math.abs(occurrence - start);
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
    if (matches.length) {
      const offset = matches[0].start;
      len = matches[matches.length - 1].end - offset;
      at += offset;
    }
    const end = at + len - 1;
    const first = nodes.find(
      (n) => n.start <= at && at < n.start + n.map.length,
    );
    const final = nodes.find(
      (n) => n.start <= end && end < n.start + n.map.length,
    );
    if (!first || !final) return false;
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
    let style = document.getElementById("tabscope-highlight-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "tabscope-highlight-style";
      style.textContent =
        "::highlight(tabscope-match){background:#ffe18a;color:#222}";
      document.documentElement.append(style);
    }
    css.highlights.set("tabscope-match", new HighlightCtor(range));
    first.node.parentElement?.scrollIntoView({
      block: "center",
      behavior: "instant",
    });
    setTimeout(() => {
      css.highlights.delete("tabscope-match");
      style?.remove();
    }, 5000);
    return true;
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab ||
      !m ||
      typeof m !== "object"
    )
      return;
    if (m.type === "ui-ready" && m.invocation === activeInvocation) {
      usable = true;
      reply(true);
    }
    if (
      m.type === "notice" &&
      typeof m.text === "string" &&
      m.text.length <= 200
    ) {
      document.getElementById("tabscope-notice")?.remove();
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
      m?.type === "open" &&
      typeof m.invocation === "string" &&
      m.invocation.length <= 80 &&
      Number.isInteger(m.windowId)
    ) {
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
      m?.type === "highlight" &&
      typeof m.excerpt === "string" &&
      typeof m.query === "string" &&
      m.query.length <= 500 &&
      m.excerpt.length <= 300 &&
      m.expectedURL === location.href &&
      Number.isInteger(m.start)
    ) {
      close();
      reply(highlight(m.excerpt, m.query, m.start));
    }
  });
  new MutationObserver((mutations) => {
    if (
      mutations.every((m) => {
        if (
          m.type === "childList" &&
          [...m.addedNodes, ...m.removedNodes].length &&
          [...m.addedNodes, ...m.removedNodes].every(
            (n) =>
              n instanceof Element &&
              n.matches(
                "#tabscope-root,#tabscope-highlight-style,#tabscope-notice",
              ),
          )
        )
          return true;
        const e =
          m.target instanceof Element ? m.target : m.target.parentElement;
        return !!e?.closest(
          "#tabscope-root,#tabscope-highlight-style,#tabscope-notice",
        );
      })
    )
      return;
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
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "class", "style"],
  });
}
