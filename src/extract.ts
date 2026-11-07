// Self contained: passed to scripting.executeScript without external closures.
export function extractReadable() {
  const limit = 60_000;
  const nodesLimit = 20_000;
  let text = "";
  let visited = 0;
  let truncated = false;
  const ignored =
    'script,style,noscript,template,svg,canvas,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],#tabscope-root';
  const walker = document.createTreeWalker(
    document.body ?? document.documentElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || p.closest(ignored)) return NodeFilter.FILTER_REJECT;
        for (let el: Element | null = p; el; el = el.parentElement) {
          const s = getComputedStyle(el);
          if (
            s.display === "none" ||
            s.visibility === "hidden" ||
            s.visibility === "collapse" ||
            s.opacity === "0"
          )
            return NodeFilter.FILTER_REJECT;
        }
        return node.textContent?.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );
  while (walker.nextNode()) {
    visited++;
    if (visited > nodesLimit) {
      truncated = true;
      break;
    }
    const chunk = (walker.currentNode.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length + chunk.length + 1 > limit) {
      text += (text ? " " : "") + chunk.slice(0, limit - text.length - 1);
      truncated = true;
      break;
    }
    text += (text ? " " : "") + chunk;
  }
  return { url: location.href, text, truncated };
}
