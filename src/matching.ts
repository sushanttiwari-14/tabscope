import { wordSpans, tokenize, editDistance } from "./search";
import type { MatchKind, Passage, TabRecord } from "./types";
export interface Component {
  terms: string[];
  phrase: boolean;
  allowApprox?: boolean;
}
export function parseQuery(query: string): Component[] | null {
  if (query.length > 500) return null;
  const parts: Component[] = [];
  // An unmatched quote consumes the remainder as a literal phrase.
  for (const m of query.matchAll(/"([^"]*)(?:"|$)|([^"\s]+)/g)) {
    const phrase = m[1] !== undefined;
    const terms = tokenize(m[1] ?? m[2]);
    if (terms.length)
      parts.push(
        ...(phrase
          ? [{ terms, phrase }]
          : terms.map((t) => ({
              terms: [t],
              phrase: false,
              allowApprox: /^[a-z]+$/.test(m[2] ?? ""),
            }))),
      );
  }
  const unique = [
    ...new Map(
      parts.map((p) => [JSON.stringify([p.terms, p.phrase]), p]),
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
  exact: 4,
  prefix: 3,
  variant: 2,
  typo: 1,
};
export function wordKind(
  query: string,
  word: string,
  approximate: boolean,
): MatchKind | undefined {
  if (query === word) return "exact";
  if (word.startsWith(query)) return "prefix";
  if (
    !approximate ||
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
      const kinds = new Map<string, MatchKind | undefined>();
      for (const w of words) {
        if (w.end - w.start > 180) continue;
        const q = component.terms[0];
        const kind = kinds.has(w.term)
          ? kinds.get(w.term)
          : wordKind(
              q,
              w.term,
              approximate &&
                component.allowApprox !== false &&
                (!expansions || expansions.get(q)?.has(w.term) === true),
            );
        kinds.set(w.term, kind);
        if (kind) matches.push({ ...w, kind });
        if (matches.length >= 2000) break;
      }
    } else {
      for (let i = 0; i <= words.length - component.terms.length; i++) {
        const group = words.slice(i, i + component.terms.length);
        if (
          group.at(-1)!.end - group[0].start <= 240 &&
          group.every(
            (w, j) =>
              w.term === component.terms[j] &&
              (!j || /^\s+$/u.test(text.slice(group[j - 1].end, w.start))),
          ) &&
          !breaks.some((b) => b > group[0].start && b < group.at(-1)!.end)
        )
          matches.push({
            start: group[0].start,
            end: group.at(-1)!.end,
            kind: "exact",
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
  const result: Passage[] = windows.map((w) => {
    const matches = all.filter((m) => m.start >= w.start && m.end <= w.end);
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
