// Self contained: passed to scripting.executeScript without external closures.
export function extractReadable() {
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
    };
  const limit = 60_000;
  const nodesLimit = 20_000;
  let text = "";
  let visited = 0;
  let truncated = false;
  const ignored =
    'script,style,noscript,template,svg,canvas,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],#tabscope-root,#tabscope-notice';
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
    if (!p || p.closest(ignored) || !node.textContent?.trim()) continue;
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
    const chunk = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    const separator = text ? " " : "";
    if (text.length + separator.length + chunk.length > limit) {
      text +=
        separator + chunk.slice(0, limit - text.length - separator.length);
      truncated = true;
      break;
    }
    text += separator + chunk;
  }
  return { url: location.href, text, truncated };
}
