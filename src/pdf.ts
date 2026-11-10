// No viewer replacement: preserve URL query and unrelated fragment parameters.
export function pdfPageURL(source: string, page: number) {
  const url = new URL(source);
  if (!/^https?:$/.test(url.protocol) || !Number.isInteger(page) || page < 1)
    throw Error("Unsupported PDF destination");
  const original = url.hash.slice(1);
  const params = original
    ? original.split("&").filter((part) => {
        let key = part.split("=")[0];
        try {
          key = decodeURIComponent(key);
        } catch {
          /* Preserve malformed unrelated fragments. */
        }
        // A destination name competes with the selected physical page. Other
        // fragment bytes (including encoded spaces/plus signs) stay untouched.
        return !["page", "nameddest"].includes(key.toLowerCase());
      })
    : [];
  url.hash = [...params, `page=${page}`].join("&");
  return url.href;
}
export const PDF_LIMITS = {
  bytes: 12 * 1024 * 1024,
  pages: 40,
  text: 60_000,
  ms: 20_000,
};
export interface PDFTextItem {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}
export function pdfPageText(items: PDFTextItem[]) {
  let text = "";
  let prior: PDFTextItem | undefined;
  let lineStart = 0;
  for (const item of items.slice(0, 20_000)) {
    // PDF.js can synthesize a whitespace item spanning an entire column gap.
    // It must not become geometric evidence connecting unrelated columns.
    if (!item.str.trim()) {
      if (prior && item.hasEOL) prior = { ...prior, hasEOL: true };
      continue;
    }
    // Do not invent a phrase across column jumps, reverse reading order or a
    // large vertical gap. Extraction order is retained, not guessed/reflowed.
    if (!prior) lineStart = item.transform[4];
    const nextLine =
      prior?.hasEOL &&
      Math.abs(item.transform[4] - lineStart) < 15 &&
      Math.abs(item.transform[5] - prior.transform[5]) <=
        Math.max(30, Math.abs(prior.transform[3]) * 2);
    const jump =
      prior &&
      !nextLine &&
      (item.transform[4] < prior.transform[4] - 10 ||
        Math.abs(item.transform[5] - prior.transform[5]) >
          Math.max(30, Math.abs(prior.transform[3]) * 2) ||
        item.transform[4] - (prior.transform[4] + prior.width) > 40);
    const dehyphenate =
      nextLine && /[a-z]-$/.test(text) && /^[a-z]/.test(item.str);
    if (dehyphenate) text = text.slice(0, -1);
    const separator = text ? (jump ? "\u0000" : dehyphenate ? "" : " ") : "";
    if (jump) lineStart = item.transform[4];
    text +=
      separator +
      item.str
        .replace(/\u00ad/g, "")
        .replace(
          /[ﬀﬁﬂﬃﬄ]/g,
          (c) => ({ ﬀ: "ff", ﬁ: "fi", ﬂ: "fl", ﬃ: "ffi", ﬄ: "ffl" })[c]!,
        )
        .replace(/\s+/gu, " ");
    prior = item;
    if (text.length >= PDF_LIMITS.text) break;
  }
  return text.slice(0, PDF_LIMITS.text);
}
