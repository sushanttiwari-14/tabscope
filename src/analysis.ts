// Source offsets are UTF-16. Matching forms are never source coordinates.
export const ANALYSIS_VERSION = 1;
export function localeHint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64) return;
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return;
  }
}
const segmenters = new Map<string, Intl.Segmenter>();
export function segmenter(granularity: "word" | "grapheme", locale = "und") {
  if (typeof Intl.Segmenter !== "function") return undefined;
  const key = `${locale}:${granularity}`;
  let s = segmenters.get(key);
  if (!s) {
    // Fixed locale: interface language and untrusted page hints never alter segmentation.
    s = new Intl.Segmenter(locale === "und" ? "en" : locale, { granularity });
    if (segmenters.size >= 8)
      segmenters.delete(segmenters.keys().next().value!);
    segmenters.set(key, s);
  }
  return s;
}
export const normalize = (s: string, locale?: string) =>
  (/^(tr|az)(-|$)/.test(locale ?? "")
    ? s.normalize("NFC").toLocaleLowerCase(locale)
    : s.normalize("NFC").toLowerCase()
  )
    .replace(/ς/g, "σ")
    .normalize("NFC");
// Deliberate aliases, not global mark removal. ñ, Indic signs and kana voicing survive.
export function relaxed(s: string, locale?: string) {
  return normalize(
    s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    ),
    locale,
  )
    .replace(/[áàâäãåéèêëíìîïóòôöõúùûüç]/g, (c) => c.normalize("NFD")[0])
    .replace(/ß/g, "ss")
    .replace(
      /[\u064b-\u0652\u0670\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/g,
      "",
    );
}
export const noSpace = (s: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(
    s,
  );
export interface Token {
  term: string;
  relaxed: string;
  start: number;
  end: number;
  source: string;
  locale?: string;
}
export type Words = Token[] & {
  field?: "url";
  locale?: string;
  runs?: Token[];
};
export function wordSpans(
  text: string,
  hint?: string,
  field?: "url",
  includeSequence = true,
): Words {
  const locale = localeHint(hint);
  const s = segmenter("word");
  const spans = s
    ? Array.from(s.segment(text))
        .filter((w) => w.isWordLike)
        .map((w) => ({ source: w.segment, start: w.index }))
    : Array.from(
        text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}\u200c\u200d]*/gu),
        (m) => ({ source: m[0], start: m.index! }),
      );
  const token = (w: { source: string; start: number }): Token => ({
    source: w.source,
    start: w.start,
    end: w.start + w.source.length,
    term: normalize(w.source, locale),
    relaxed:
      field === "url" ? normalize(w.source, locale) : relaxed(w.source, locale),
    locale,
  });
  const words: Words = spans.map(token);
  words.locale = locale;
  words.field = field;
  // Context-sensitive scripts also get one cached source sequence. It contains
  // literal punctuation/space, never n-grams or artificial display tokens.
  words.runs =
    includeSequence && noSpace(text)
      ? [
          {
            source: text,
            start: 0,
            end: text.length,
            term: normalize(text, locale),
            relaxed: "",
            locale,
          },
        ]
      : [];
  return words;
}
export const tokenize = (s: string) =>
  wordSpans(s, undefined, undefined, false).map((w) => w.term);
export function graphemes(text: string) {
  const s = segmenter("grapheme");
  // No Segmenter: keep the entire string intact. Reduced snippet quality, no broken clusters.
  return s
    ? Array.from(s.segment(text), (g) => ({
        start: g.index,
        end: g.index + g.segment.length,
        text: g.segment,
      }))
    : [{ start: 0, end: text.length, text }];
}
export function safeSlice(text: string, start: number, end: number) {
  // Stop at the requested end: a single oversized PDF item must not allocate
  // a grapheme array for its entire (potentially much larger) source string.
  const s = segmenter("grapheme");
  if (!s) return start <= 0 && end >= text.length ? text : "";
  let from: number | undefined = start <= 0 ? 0 : undefined;
  let to = 0;
  for (const g of s.segment(text)) {
    if (from === undefined && g.index >= start) from = g.index;
    const boundary = g.index + g.segment.length;
    if (boundary > end) break;
    to = boundary;
  }
  return from !== undefined && to >= from ? text.slice(from, to) : "";
}
export function safeEnd(text: string, limit: number) {
  if (text.length <= limit) return text;
  return safeSlice(text, 0, limit);
}
// Projections are built at content-update time, not on the first keystroke.
const projections = new WeakMap<
  Token,
  { key: string; source: Uint32Array; form: Uint32Array }
>();
function projectionFor(run: Token) {
  let projection = projections.get(run);
  if (!projection) {
    let key = "";
    const source = [0],
      offsets = [0];
    for (const g of graphemes(run.source)) {
      const form = /^\s+$/u.test(g.text) ? " " : normalize(g.text, run.locale);
      if (form === " " && key.endsWith(" ")) {
        source[source.length - 1] = g.end;
        continue;
      }
      key += form;
      source.push(g.end);
      offsets.push(key.length);
    }
    projection = {
      key,
      source: Uint32Array.from(source),
      form: Uint32Array.from(offsets),
    };
    projections.set(run, projection);
  }
  return projection;
}
export function prepareRuns(words: Words) {
  for (const run of words.runs ?? []) projectionFor(run);
}
// Locate transformed substrings by grapheme boundaries; only verified original ranges escape.
export function runMatches(run: Token, query: string) {
  const form = normalize(query, run.locale).replace(/\s+/gu, " ");
  const found: { start: number; end: number }[] = [];
  if (!form) return found;
  if (!run.term.replace(/\s+/gu, " ").includes(form)) return found;
  const projection = projectionFor(run);
  const boundary = (at: number) => {
    let lo = 0,
      hi = projection!.form.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (projection!.form[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    return projection!.form[lo] === at ? projection!.source[lo] : undefined;
  };
  for (
    let at = projection.key.indexOf(form);
    at >= 0 && found.length < 2000;
    at = projection.key.indexOf(form, at + Math.max(1, form.length))
  ) {
    const start = boundary(at),
      end = boundary(at + form.length);
    if (start !== undefined && end !== undefined)
      found.push({ start: run.start + start, end: run.start + end });
  }
  return found;
}
// Extensible language policy: only an explicit English content hint enables
// the tested ASCII inflection/typo rules. Unknown content never guesses language.
export function englishPolicy(hint?: string) {
  const locale = localeHint(hint);
  return !!locale && /^en(?:-|$)/.test(locale);
}
// Remove directional formatting only at display time, with one-code-unit replacements.
// Source strings and offsets remain intact; replacement keeps renderer ranges aligned.
export const displayText = (s: string) =>
  s.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "\ufffd");

export function prefixBoundary(word: string, length: number) {
  const s = segmenter("grapheme");
  if (!s) return !/^[\p{M}\u200c\u200d]/u.test(word.slice(length));
  const cluster = s.segment(word).containing(length - 1);
  return !!cluster && cluster.index + cluster.segment.length === length;
}

export interface SourceRange {
  start: number;
  end: number;
}
export interface Excerpt {
  start: number;
  end: number;
  text: string;
  ranges: SourceRange[];
}
// Verified source ranges in, source-relative ranges out. Visual ellipses stay outside.
export function sourceExcerpt(
  text: string,
  ranges: SourceRange[],
  words: Words,
): Excerpt | undefined {
  const first = [...ranges].sort((a, b) => a.start - b.start)[0];
  if (!first) return;
  const start = Math.min(
    first.start,
    words.find((w) => w.start >= Math.max(0, first.start - 35))?.start ??
      first.start,
  );
  const limit = Math.min(text.length, start + 240);
  const end = Math.max(
    first.end,
    words.findLast((w) => w.end <= limit)?.end ?? first.end,
  );
  return {
    start,
    end,
    text: text.slice(start, end),
    ranges: ranges.filter((r) => r.start >= start && r.end <= end),
  };
}
