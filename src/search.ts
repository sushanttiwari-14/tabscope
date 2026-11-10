import { parseQuery, evidence, passages, quality, wordKind } from "./matching";
import MiniSearch from "minisearch";
import {
  normalizeHost,
  type SearchFilters,
  type TabRecord,
  type Hit,
} from "./types";
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const tokenize = (s: string) =>
  normalize(s).match(/[\p{L}\p{N}]+/gu) ?? [];
// Offsets always refer to original UTF-16 text, including combining marks.
export function wordSpans(text: string) {
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)].map((m) => ({
    term: normalize(m[0]),
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}
export function passage(
  text: string,
  terms: string[],
  words = wordSpans(text),
) {
  if (!terms.length) return undefined;
  const matches = words.flatMap((w) => {
    const key = terms.findIndex((t) => w.term.startsWith(t));
    return key >= 0 && w.end - w.start <= 180 ? [{ ...w, key }] : [];
  });
  let best:
    | {
        start: number;
        end: number;
        count: number;
        phrase: number;
        spread: number;
      }
    | undefined;
  // Linear sliding window over bounded indexed text; all occurrences participate.
  let right = 0;
  const counts = new Map<number, number>();
  for (let left = 0; left < matches.length; left++) {
    while (
      right < matches.length &&
      matches[right].end - matches[left].start <= 180
    ) {
      const key = matches[right++].key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const end = matches[Math.max(left, right - 1)].end;
    const phrase =
      terms.length > 1 &&
      matches
        .slice(left, Math.min(right, left + terms.length))
        .every(
          (m, i, a) =>
            m.key === i &&
            (!i || /^\s+$/u.test(text.slice(a[i - 1].end, m.start))),
        ) &&
      right - left >= terms.length
        ? 1
        : 0;
    const candidate = {
      start: matches[left].start,
      end,
      count: counts.size,
      phrase,
      spread: end - matches[left].start,
    };
    if (
      !best ||
      candidate.count > best.count ||
      (candidate.count === best.count &&
        (candidate.phrase > best.phrase ||
          (candidate.phrase === best.phrase && candidate.spread < best.spread)))
    )
      best = candidate;
    const key = matches[left].key;
    const count = (counts.get(key) ?? 1) - 1;
    if (count) counts.set(key, count);
    else counts.delete(key);
  }
  if (!best) return undefined;
  // Extend by whole source words so surrogate pairs/combining marks are never split.
  const start =
    words.find(
      (w) => w.start >= Math.max(0, best!.start - 35) && w.start <= best!.start,
    )?.start ?? best.start;
  let end = Math.min(text.length, start + 240);
  const boundary = words
    .filter((w) => w.end <= end && w.end >= best!.end)
    .at(-1);
  if (boundary) end = boundary.end;
  while (
    end > start &&
    (/[\p{M}]/u.test(text[end] ?? "") ||
      /[\uDC00-\uDFFF]/u.test(text[end] ?? ""))
  )
    end--;
  end = Math.max(best.end, end);
  return { start, end, text: text.slice(start, end) };
}
export function snippet(text: string, query: string): string {
  const p = passage(text, tokenize(query));
  return p
    ? `${p.start ? "…" : ""}${p.text}${p.end < text.length ? "…" : ""}`
    : "";
}
export function matchesFilters(r: TabRecord, filters: SearchFilters = {}) {
  if (filters.windowId !== undefined && r.windowId !== filters.windowId)
    return false;
  if (filters.pageText && !r.text) return false;
  if (filters.domain) {
    const host = normalizeHost(filters.domain);
    if (!host) return false;
    try {
      const actual = new URL(r.url).hostname.toLowerCase().replace(/\.$/, "");
      if (
        actual !== host &&
        (filters.exactHost || !actual.endsWith("." + host))
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
export function editDistance(a: string, b: string, limit: number): boolean {
  const x = [...a],
    y = [...b];
  if (Math.abs(x.length - y.length) > limit) return false;
  let previous: number[] = [];
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const next = Array<number>(y.length + 1).fill(limit + 1);
    next[0] = i;
    for (
      let j = Math.max(1, i - limit);
      j <= Math.min(y.length, i + limit);
      j++
    ) {
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + Number(x[i - 1] !== y[j - 1]),
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        next[j] = Math.min(next[j], previous[j - 2] + 1);
    }
    if (Math.min(...next) > limit) return false;
    previous = row;
    row = next;
  }
  return row[y.length] <= limit;
}
export class SearchIndex {
  private records = new Map<number, TabRecord>();
  private cache = new Map<string, Hit[]>();
  private spans = new Map<number, ReturnType<typeof wordSpans>>();
  private engine = new MiniSearch<TabRecord>({
    fields: ["title", "url", "text"],
    storeFields: [],
    tokenize,
    processTerm: normalize,
  });
  rebuild(records: Map<number, TabRecord>) {
    this.cache.clear();
    this.records = new Map([...records].map(([id, r]) => [id, { ...r }]));
    this.spans = new Map(
      [...records].map(([id, r]) => [id, wordSpans(r.text)]),
    );
    this.engine.removeAll();
    this.engine.addAll([...records.values()]);
  }
  sync(records: Map<number, TabRecord>) {
    if (
      records.size !== this.records.size ||
      [...records].some(
        ([id, r]) => JSON.stringify(r) !== JSON.stringify(this.records.get(id)),
      )
    )
      this.cache.clear();
    for (const [id, old] of this.records)
      if (!records.has(id)) {
        this.engine.remove(old);
        this.spans.delete(id);
      }
    for (const [id, r] of records) {
      const old = this.records.get(id);
      if (
        !old ||
        old.title !== r.title ||
        old.url !== r.url ||
        old.text !== r.text
      ) {
        if (old) this.engine.remove(old);
        this.engine.add(r);
        if (!old || old.text !== r.text) this.spans.set(id, wordSpans(r.text));
      }
    }
    this.records = new Map([...records].map(([id, r]) => [id, { ...r }]));
  }
  clearQueryCache() {
    this.cache.clear();
  }
  search(query: string, filters: SearchFilters = {}): Hit[] {
    const cacheKey = JSON.stringify([query, filters]);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const components = parseQuery(query);
    if (!components) return [];
    const terms = [...new Set(components.flatMap((c) => c.terms))];
    const eligible = (id: number) => {
      const r = this.records.get(id);
      return !!r && matchesFilters(r, filters);
    };
    const options = {
      fields: filters.pageText ? ["text"] : undefined,
      combineWith: "AND" as const,
      prefix: true,
      boost: { title: 3, text: 2, url: 1 },
      filter: (r: { id: string | number }) => eligible(Number(r.id)),
    };
    const exact = terms.length
      ? this.engine.search(terms.join(" "), options)
      : [];
    const expansions = new Map<string, Set<string>>();
    // One bounded vocabulary pass, at most eight approximate expansions per term.
    const recoverable = terms.filter(
      (t) =>
        /^[a-z]{4,40}$/.test(t) &&
        components.some(
          (c) => !c.phrase && c.allowApprox !== false && c.terms.includes(t),
        ),
    );
    if (recoverable.length) {
      const vocabulary = new Set<string>();
      let tabs = 0,
        chars = 0;
      for (const r of this.records.values()) {
        if (!eligible(r.id)) continue;
        if (++tabs > 500) break;
        const text = (
          filters.pageText ? r.text : `${r.title} ${r.url} ${r.text}`
        ).slice(0, 2_000_000 - chars);
        chars += text.length;
        for (const w of [
          ...(filters.pageText ? [] : wordSpans(r.title + " " + r.url)),
          ...(this.spans.get(r.id) ?? []),
        ]) {
          if (vocabulary.size >= 12_000) break;
          if (w.term.length <= 42) vocabulary.add(w.term);
        }
        if (chars >= 2_000_000 || vocabulary.size >= 12_000) break;
      }
      for (const t of recoverable)
        expansions.set(
          t,
          new Set(
            [...vocabulary]
              .filter((w) => {
                const kind = wordKind(t, w, true);
                return kind === "variant" || kind === "typo";
              })
              .sort(
                (a, b) =>
                  quality[wordKind(t, b, true)!] -
                    quality[wordKind(t, a, true)!] || a.localeCompare(b),
              )
              .slice(0, 8),
          ),
        );
    }
    const approximate =
      terms.length && [...expansions.values()].some((v) => v.size)
        ? this.engine.search(
            {
              combineWith: "AND",
              queries: terms.map((t) => ({
                combineWith: "OR",
                queries: [t, ...(expansions.get(t) ?? [])],
                prefix: true,
              })),
            },
            options,
          )
        : [];
    const candidates = terms.length
      ? [
          ...new Map(
            [...exact, ...approximate].map((r) => [
              Number(r.id),
              { id: Number(r.id), score: r.score },
            ]),
          ).values(),
        ]
      : [...this.records.keys()]
          .filter(eligible)
          .map((id) => ({ id, score: 0 }));
    const hits = candidates.flatMap((item) => {
      const r = this.records.get(item.id)!;
      const fields = filters.pageText ? [r.text] : [r.title, r.url, r.text];
      const groups = fields.map((text) =>
        evidence(
          text,
          components,
          true,
          text === r.text ? this.spans.get(r.id) : undefined,
          text === r.text
            ? [
                ...(r.breaks ?? []),
                ...(r.pdf?.pages.flatMap((p) => [p.start, p.end]) ?? []),
              ]
            : [],
          expansions,
        ),
      );
      const best = components.map((_, i) =>
        Math.max(0, ...groups.flatMap((g) => g[i].map((m) => quality[m.kind]))),
      );
      if (best.some((v) => v === 0)) return [];
      const weak = best.some((v) => v < 3);
      const ps = terms.length
        ? passages(r, components, true, this.spans.get(r.id) ?? [], expansions)
        : { items: [], capped: false };
      // Suppress incomplete body evidence when metadata fully explains the query.
      const metadataComplete =
        !filters.pageText &&
        components.every((_, i) => groups.slice(0, 2).some((g) => g[i].length));
      if (
        metadataComplete &&
        !components.every((_, i) => groups.at(-1)![i].length)
      )
        ps.items = [];
      const p = [...ps.items].sort(
        (a, b) => b.score - a.score || a.start - b.start,
      )[0];
      const matched = [
        ...new Set(
          groups.flatMap((g) => g.flatMap((ms) => ms.map((m) => m.term))),
        ),
      ];
      return [
        {
          r,
          p,
          ps,
          matched,
          weak,
          tier: Math.min(4, ...best),
          score:
            item.score + best.reduce((a, b) => a + b, 0) * 10 + (p?.score ?? 0),
        },
      ];
    });
    hits.sort(
      (a, b) =>
        Number(a.weak) - Number(b.weak) ||
        b.tier - a.tier ||
        b.score - a.score ||
        (b.r.lastActive ?? 0) - (a.r.lastActive ?? 0) ||
        a.r.id - b.r.id,
    );
    const result = hits.slice(0, 100).map(({ r, p, ps, matched, weak }) => ({
      id: r.id,
      title: r.title || r.url,
      url: r.url,
      state: r.state,
      coverage: r.coverage,
      snippet: p
        ? `${p.start ? "…" : ""}${p.text}${p.end < r.text.length ? "…" : ""}`
        : "",
      passage: p,
      passages: ps.items,
      passagesCapped: ps.capped,
      updated: r.updated,
      matchedTerms: matched,
      approximate: weak,
      truncated: r.truncated,
      pdf: r.pdf,
      resultsCapped: hits.length > 100,
    }));
    if (this.cache.size >= 8)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, result);
    return result;
  }
}
