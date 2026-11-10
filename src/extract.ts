// Self contained: passed to scripting.executeScript without external closures.
export function extractReadable(mapNodes = false) {
  if (
    !["text/html", "application/xhtml+xml", "text/plain"].includes(
      document.contentType,
    )
  )
    return {
      url: location.href,
      text: "",
      truncated: false,
      unsupported: true,
      pdf:
        document.contentType === "application/pdf" ||
        !!document.querySelector('embed[type="application/pdf"]'),
    };
  const limit = 60_000;
  const nodesLimit = 20_000;
  let text = "";
  const segments: { node?: Node; start: number; map: number[] }[] = [];
  const breaks: number[] = [];
  let priorBlock: Element | null = null;
  let trailingSpace = false;
  let visited = 0;
  let truncated = false;
  const ignored =
    'script,style,noscript,template,svg,canvas,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],#tabscope-root,#tabscope-notice,#tabscope-match-navigator';
  const walker = document.createTreeWalker(
    document.body ?? document.documentElement,
    NodeFilter.SHOW_TEXT,
  );
  while (walker.nextNode()) {
    if (++visited > nodesLimit) {
      truncated = true;
      break;
    }
    const node = walker.currentNode;
    const p = node.parentElement;
    if (!p || p.closest(ignored)) continue;
    let visible = true;
    for (let el: Element | null = p; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (
        s.display === "none" ||
        s.visibility === "hidden" ||
        s.visibility === "collapse" ||
        s.opacity === "0"
      ) {
        visible = false;
        break;
      }
    }
    if (!visible) continue;
    const raw = node.textContent ?? "";
    if (!raw.trim()) {
      trailingSpace ||= !!raw.length;
      continue;
    }
    const map: number[] = [];
    let chunk = "";
    for (let i = 0; i < raw.length; i++) {
      if (/\s/u.test(raw[i])) {
        if (chunk && !chunk.endsWith(" ")) {
          chunk += " ";
          map.push(i);
        }
      } else {
        chunk += raw[i];
        map.push(i);
      }
    }
    if (chunk.endsWith(" ")) {
      chunk = chunk.slice(0, -1);
      map.pop();
    }
    const block = p.closest(
      "p,div,section,article,li,td,th,h1,h2,h3,h4,h5,h6,pre,blockquote",
    );
    let boundary: Node | null = node;
    let lineBreak = false;
    while (boundary && boundary !== block) {
      if (
        boundary.previousSibling instanceof Element &&
        boundary.previousSibling.tagName === "BR"
      ) {
        lineBreak = true;
        break;
      }
      if (boundary.previousSibling) break;
      boundary = boundary.parentNode;
    }
    const separator =
      text &&
      (block !== priorBlock || lineBreak || trailingSpace || /^\s/u.test(raw))
        ? " "
        : "";
    if (text && block !== priorBlock)
      breaks.push(text.length + separator.length);
    trailingSpace = /\s$/u.test(raw);
    priorBlock = block;
    segments.push({
      node: mapNodes ? node : undefined,
      start: text.length + separator.length,
      map,
    });
    if (text.length + separator.length + chunk.length > limit) {
      text +=
        separator + chunk.slice(0, limit - text.length - separator.length);
      truncated = true;
      break;
    }
    text += separator + chunk;
  }
  return {
    url: location.href,
    text,
    truncated,
    breaks,
    pdf: !text && !!document.querySelector('embed[type="application/pdf"]'),
    segments: mapNodes ? segments : [],
  };
}
