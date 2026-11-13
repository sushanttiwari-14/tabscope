import {
  wordSpans,
  tokenize,
  normalize,
  relaxed,
  noSpace,
  runMatches,
  englishPolicy,
  prefixBoundary,
} from "./analysis";
import { editDistance } from "./distance";
import type { MatchKind, Passage, TabRecord } from "./types";
export interface Component {
  terms: string[];
  source?: string;
  gaps?: string[];
  leading?: string;
  trailing?: string;
  phrase: boolean;
  allowApprox?: boolean;
}
export function parseQuery(query: string): Component[] | null {
  if (query.length > 500) return null;
  const parts: Component[] = [];
  // An unmatched quote consumes the remainder as a literal phrase.
  for (const m of query.matchAll(/"([^"]*)(?:"|$)|([^"\s]+)/g)) {
    const phrase = m[1] !== undefined;
    const source = (m[1] ?? m[2]).trim();
    const spans = wordSpans(source);
    const contiguous =
      noSpace(source) && /^[\p{L}\p{M}\p{N}\u200c\u200d]+$/u.test(source);
    const terms = contiguous ? [normalize(source)] : tokenize(source);
    const gaps = spans
      .slice(1)
      .map((w, i) => source.slice(spans[i].end, w.start));
    if (terms.length)
      parts.push(
        ...(phrase
          ? [
              {
                terms,
                phrase,
                source,
                gaps,
                leading: source.slice(0, spans[0].start),
                trailing: source.slice(spans.at(-1)!.end),
              },
            ]
          : terms.map((t) => ({
              terms: [t],
              source: contiguous
                ? source
                : spans.find((w) => w.term === t)?.source,
              phrase: false,
              allowApprox: /^[a-z]+$/.test(m[2] ?? ""),
            }))),
      );
  }
  const unique = [
    ...new Map(
      parts.map((p) => [
        JSON.stringify([
          p.terms,
          p.phrase,
          /[Iİ]/u.test(p.source ?? "") ? p.source : undefined,
        ]),
        p,
      ]),
    ).values(),
  ];
  const distinct = [...new Set(unique.flatMap((p) => p.terms))];
  return unique.reduce((n, p) => n + p.terms.length, 0) > 12 ||
    distinct.length > 12 ||
    distinct.some((t) => t.length > 80)
    ? null
    : unique;
}
// Deliberately small English inflection set; no multilingual stemming.
export function root(term: string) {
  if (!/^[a-z]{4,}$/.test(term)) return term;
  if (term.endsWith("ies")) return term.slice(0, -3) + "y";
  if (term.endsWith("ing") && term.length > 6) {
    const base = term.slice(0, -3);
    return /(.)\1$/.test(base) ? base.slice(0, -1) : base;
  }
  if (term.endsWith("ed") && term.length > 5) return term.slice(0, -2);
  if (term.endsWith("s") && !/(ss|us|is)$/.test(term)) return term.slice(0, -1);
  return term;
}
export const quality: Record<MatchKind, number> = {
  exact: 5,
  relaxed: 4,
  prefix: 3,
  variant: 2,
  typo: 1,
};
export function wordKind(
  query: string,
  word: string,
  approximate: boolean,
  locale?: string,
  aliases = true,
): MatchKind | undefined {
  if (query === word) return "exact";
  if (aliases && relaxed(query, locale) === relaxed(word, locale))
    return "relaxed";
  if (word.startsWith(query) && prefixBoundary(word, query.length))
    return "prefix";
  if (
    !approximate ||
    !englishPolicy(locale) ||
    !/^[a-z]{4,40}$/.test(query) ||
    !/^[a-z]{3,42}$/.test(word)
  )
    return;
  if (root(query) === root(word)) return "variant";
  if (word.length >= 4 && editDistance(query, word, query.length >= 8 ? 2 : 1))
    return "typo";
}
export function evidence(
  text: string,
  components: Component[],
  approximate: boolean,
  words = wordSpans(text),
  breaks: number[] = [],
  expansions?: Map<string, Set<string>>,
) {
  return components.map((component) => {
    const matches: {
      start: number;
      end: number;
      kind: MatchKind;
      term: string;
    }[] = [];
    if (!component.phrase) {
      if (noSpace(component.source ?? "")) {
        for (const run of words.runs ?? [])
          for (const range of runMatches(run, component.source!))
            matches.push({ ...range, kind: "exact", term: component.terms[0] });
        return matches.slice(0, 2000);
      }
      const kinds = new Map<string, MatchKind | undefined>();
      const q = normalize(component.source ?? component.terms[0], words.locale);
      for (const w of words) {
        if (w.end - w.start > 180) continue;
        const kind = kinds.has(w.term)
          ? kinds.get(w.term)
          : wordKind(
              q,
              w.term,
              approximate &&
                component.allowApprox !== false &&
                (!expansions ||
                  expansions.get(component.terms[0])?.has(w.term) === true),
              words.locale,
              words.field !== "url",
            );
        kinds.set(w.term, kind);
        if (kind) matches.push({ ...w, kind });
        if (matches.length >= 2000) break;
      }
    } else {
      const queryWords = wordSpans(component.source ?? "");
      const canonical = component.terms.map((t, j) =>
        normalize(queryWords[j]?.source ?? t, words.locale),
      );
      const aliases = component.terms.map((t, j) =>
        relaxed(queryWords[j]?.source ?? t, words.locale),
      );
      const gaps = component.gaps?.map((gap) => gap.replace(/\s+/gu, " "));
      if (component.source && noSpace(component.source)) {
        for (const run of words.runs ?? [])
          for (const range of runMatches(run, component.source))
            if (!breaks.some((b) => b > range.start && b < range.end))
              matches.push({ ...range, kind: "exact", term: component.source });
        return matches.slice(0, 2000);
      }
      for (let i = 0; i <= words.length - component.terms.length; i++) {
        const group = words.slice(i, i + component.terms.length);
        const start = group[0].start - (component.leading?.length ?? 0);
        const end = group.at(-1)!.end + (component.trailing?.length ?? 0);
        if (
          start >= 0 &&
          end <= text.length &&
          end - start <= 240 &&
          text.slice(
            group[0].start - (component.leading?.length ?? 0),
            group[0].start,
          ) === (component.leading ?? "") &&
          text.slice(
            group.at(-1)!.end,
            group.at(-1)!.end + (component.trailing?.length ?? 0),
          ) === (component.trailing ?? "") &&
          group.every(
            (w, j) =>
              (w.term === canonical[j] ||
                (words.field !== "url" && w.relaxed === aliases[j])) &&
              (!j ||
                text.slice(group[j - 1].end, w.start).replace(/\s+/gu, " ") ===
                  (gaps?.[j - 1] ?? " ")),
          ) &&
          !breaks.some((b) => b > start && b < end)
        )
          matches.push({
            start,
            end,
            kind: group.every((w, j) => w.term === canonical[j])
              ? "exact"
              : "relaxed",
            term: component.terms.join(" "),
          });
        if (matches.length >= 2000) break;
      }
    }
    return matches;
  });
}
function lowerBound(values: number[], value: number) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function columnBreaks(text: string) {
  const breaks: number[] = [];
  for (
    let at = text.indexOf("\u0000");
    at >= 0;
    at = text.indexOf("\u0000", at + 1)
  )
    breaks.push(at, at + 1);
  return breaks;
}
export function passages(
  r: TabRecord,
  components: Component[],
  approximate: boolean,
  words: ReturnType<typeof wordSpans>,
  expansions: Map<string, Set<string>>,
) {
  const breaks = [
    ...(r.breaks ?? []),
    ...columnBreaks(r.text),
    ...(r.pdf?.pages.flatMap((p) => [p.start, p.end]) ?? []),
  ].sort((a, b) => a - b);
  const groups = evidence(
    r.text,
    components,
    approximate,
    words,
    breaks,
    expansions,
  );
  const all = groups
    .flatMap((group, key) => group.map((m) => ({ ...m, key })))
    .sort((a, b) => a.start - b.start);
  const starts = words.map((w) => w.start),
    ends = words.map((w) => w.end);
  const windows: { start: number; end: number }[] = [];
  let candidates = 0;
  for (const m of all) {
    if (++candidates > 2000) break;
    const bi = lowerBound(breaks, m.start + 1);
    const lo = breaks[bi - 1] ?? 0,
      hi = breaks[bi] ?? r.text.length;
    const leading = Math.min(35, Math.max(0, 240 - (m.end - m.start)));
    let start = Math.max(lo, m.start - leading),
      end = Math.min(hi, m.end + 100, start + 240);
    start = starts[lowerBound(starts, start)] ?? m.start;
    end = ends[lowerBound(ends, end + 1) - 1] ?? m.end;
    start = Math.min(start, m.start);
    end = Math.max(end, m.end);
    const previous = windows.at(-1);
    if (
      previous &&
      start <= previous.end &&
      end - previous.start <= 240 &&
      !breaks.some((b) => b > previous.start && b < end)
    )
      previous.end = Math.max(previous.end, end);
    else windows.push({ start, end });
  }
  const matchStarts = all.map((m) => m.start);
  const result: Passage[] = windows.map((w) => {
    const matches = all
      .slice(lowerBound(matchStarts, w.start), lowerBound(matchStarts, w.end))
      .filter((m) => m.end <= w.end);
    const best = groups.map((_, key) =>
      Math.max(
        0,
        ...matches.filter((m) => m.key === key).map((m) => quality[m.kind]),
      ),
    );
    const minimum = Math.min(...best.filter(Boolean));
    const kind =
      (Object.keys(quality) as MatchKind[]).find(
        (k) => quality[k] === minimum,
      ) ?? "exact";
    const page = r.pdf?.pages.find((p) => p.start <= w.start && p.end >= w.end);
    return {
      ...w,
      id: `${r.updated}:${w.start}:${w.end}`,
      text: r.text.slice(w.start, w.end),
      ranges: [
        ...new Map(
          matches.map((m) => [
            `${m.start}:${m.end}`,
            { start: m.start, end: m.end },
          ]),
        ).values(),
      ],
      kind,
      revision: r.updated,
      before: r.text.slice(Math.max(0, w.start - 64), w.start),
      after: r.text.slice(w.end, w.end + 64),
      score:
        best.filter(Boolean).length * 100 +
        best.reduce((a, b) => a + b, 0) +
        components.filter((c, i) => c.phrase && best[i] > 0).length * 10 +
        1 / (1 + matches.at(-1)!.end - matches[0].start),
      page: page?.page,
      pageLabel: page?.label,
      pageOffset: page ? w.start - page.start : undefined,
    };
  });
  // Keep best passages under the cap, then restore document order.
  const kept = result
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, 32)
    .sort((a, b) => a.start - b.start);
  return {
    items: kept,
    capped:
      result.length > 32 ||
      candidates > 2000 ||
      groups.some((g) => g.length >= 2000),
  };
}
