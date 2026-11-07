import { extractReadable } from "./extract";
// Isolated world singleton; reinjection must not duplicate observers/listeners.
const own = globalThis as typeof globalThis & { __tabscope?: boolean };
if (!own.__tabscope) {
  own.__tabscope = true;
  let host: HTMLElement | null = null,
    prior: Element | null = null,
    timer: ReturnType<typeof setTimeout> | undefined,
    last = 0;
  const close = () => {
    host?.remove();
    host = null;
    if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
  };
  const open = () => {
    if (host?.isConnected) {
      host.shadowRoot?.querySelector("iframe")?.focus();
      return;
    }
    prior = document.activeElement;
    host = document.createElement("div");
    host.id = "tabscope-root";
    host.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;background:#00000047!important";
    const shadow = host.attachShadow({ mode: "open" });
    const frame = document.createElement("iframe");
    frame.title = "TabScope search";
    frame.src = chrome.runtime.getURL("palette.html?overlay");
    frame.style.cssText =
      "width:100%;height:100%;border:0;background:transparent;color-scheme:normal";
    shadow.append(frame);
    document.documentElement.append(host);
    frame.focus();
  };
  function highlight(excerpt: string, query: string) {
    const data = extractReadable();
    if (!data.text) return false;
    // Use the exact snippet without clipping markers, then fallback to a query term.
    const target = excerpt.replace(/^…|…$/g, "").trim();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(n) {
          const p = n.parentElement;
          if (
            !p ||
            p.closest(
              'script,style,input,textarea,select,button,[contenteditable],#tabscope-root,[hidden],[aria-hidden="true"]',
            )
          )
            return NodeFilter.FILTER_REJECT;
          for (let e: Element | null = p; e; e = e.parentElement) {
            const s = getComputedStyle(e);
            if (
              s.display === "none" ||
              s.visibility === "hidden" ||
              s.opacity === "0"
            )
              return NodeFilter.FILTER_REJECT;
          }
          return n.textContent?.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );
    const nodes: { node: Node; start: number; map: number[] }[] = [];
    let combined = "";
    let count = 0;
    while (walker.nextNode() && combined.length < 100_000 && count++ < 20_000) {
      const node = walker.currentNode;
      const raw = node.textContent ?? "";
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
    let at = combined.indexOf(target),
      len = target.length;
    if (at < 0) {
      const word = query.match(/[\p{L}\p{N}]+/u)?.[0] ?? "";
      if (!word) return false;
      at = combined.toLowerCase().indexOf(word.toLowerCase());
      len = word.length;
    }
    if (at < 0 || !len) return false;
    // Snippet context may start in another block. Scroll and paint the matching
    // words inside that context, rather than its first node above the passage.
    const matches = (query.match(/[\p{L}\p{N}]+/gu) ?? [])
      .map((word) => {
        const offset = combined.toLowerCase().indexOf(word.toLowerCase(), at);
        return { offset, end: offset + word.length };
      })
      .filter((m) => m.offset >= at && m.end <= at + len);
    if (matches.length) {
      const start = Math.min(...matches.map((m) => m.offset));
      const end = Math.max(...matches.map((m) => m.end));
      at = start;
      len = end - start;
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
  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m?.type === "open") {
      open();
      reply(true);
    }
    if (m?.type === "close") {
      close();
      reply(true);
    }
    if (
      m?.type === "highlight" &&
      typeof m.excerpt === "string" &&
      typeof m.query === "string"
    ) {
      close();
      reply(highlight(m.excerpt, m.query));
    }
  });
  new MutationObserver((mutations) => {
    if (
      mutations.every((m) => {
        const e =
          m.target instanceof Element ? m.target : m.target.parentElement;
        return !!e?.closest("#tabscope-root,#tabscope-highlight-style");
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
