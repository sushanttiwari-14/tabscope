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
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const next = Array<number>(y.length + 1).fill(limit + 1);
    next[0] = i;
    for (
      let j = Math.max(1, i - limit);
      j <= Math.min(y.length, i + limit);
      j++
    )
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + Number(x[i - 1] !== y[j - 1]),
      );
    if (Math.min(...next) > limit) return false;
    row = next;
  }
  return row[y.length] <= limit;
}
export class SearchIndex {
  private records = new Map<number, TabRecord>();
  private spans = new Map<number, ReturnType<typeof wordSpans>>();
  private engine = new MiniSearch<TabRecord>({
    fields: ["title", "url", "text"],
    storeFields: [],
    tokenize,
    processTerm: normalize,
  });
  rebuild(records: Map<number, TabRecord>) {
    this.records = new Map([...records].map(([id, r]) => [id, { ...r }]));
    this.spans = new Map(
      [...records].map(([id, r]) => [id, wordSpans(r.text)]),
    );
    this.engine.removeAll();
    this.engine.addAll([...records.values()]);
  }
  sync(records: Map<number, TabRecord>) {
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
  search(query: string, filters: SearchFilters = {}): Hit[] {
    const terms = [...new Set(tokenize(query.slice(0, 500)))];
    if (terms.length > 12 || terms.some((t) => t.length > 80)) return [];
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
    let approximate = false;
    let found = terms.length
      ? this.engine.search(terms.join(" "), options)
      : [];
    // Bound recovery to 12,000 distinct candidate words / 500 tabs / 2M units.
    // Exact/prefix search above always uses the complete index.
    if (
      terms.length &&
      !found.length &&
      terms.some((t) => t.length >= 4) &&
      terms.every((t) => t.length <= 40)
    ) {
      const vocabulary = new Set<string>();
      let chars = 0,
        tabs = 0;
      for (const r of this.records.values()) {
        if (!eligible(r.id)) continue;
        if (++tabs > 500) break;
        const text = (
          filters.pageText ? r.text : `${r.title} ${r.url} ${r.text}`
        ).slice(0, 2_000_000 - chars);
        chars += text.length;
        for (const word of tokenize(text)) {
          if (vocabulary.size >= 12_000) break;
          if (word.length <= 42) vocabulary.add(word);
        }
        if (chars >= 2_000_000 || vocabulary.size >= 12_000) break;
      }
      const alternatives = terms.map((t) =>
        t.length < 4
          ? [t]
          : [...vocabulary]
              .filter((w) => editDistance(t, w, t.length >= 8 ? 2 : 1))
              .sort(
                (a, b) =>
                  Number(b === t) - Number(a === t) || a.localeCompare(b),
              )
              .slice(0, 8),
      );
      approximate = true;
      if (alternatives.every((a) => a.length))
        found = this.engine.search(
          {
            combineWith: "AND",
            queries: alternatives.map((words) => ({
              combineWith: "OR",
              queries: words,
              prefix: false,
            })),
          },
          { ...options, prefix: false },
        );
    }
    const ranked = terms.length
      ? found.map((r) => ({
          id: Number(r.id),
          score: r.score,
          terms: approximate ? Object.keys(r.match) : terms,
        }))
      : [...this.records.keys()]
          .filter(eligible)
          .map((id) => ({ id, score: 0, terms: [] as string[] }));
    const hits = ranked.map((item) => {
      const r = this.records.get(item.id)!;
      let p = passage(r.text, item.terms, this.spans.get(r.id));
      const titleWords = tokenize(r.title);
      const bodyWords = tokenize(p?.text ?? "");
      // A complete title match needs no weak body evidence or navigation target.
      if (
        item.terms.length &&
        item.terms.every((term) =>
          titleWords.some((word) => word.startsWith(term)),
        ) &&
        !item.terms.every((term) =>
          bodyWords.some((word) => word.startsWith(term)),
        )
      )
        p = undefined;
      return {
        ...item,
        score:
          item.score *
          (p && normalize(p.text).includes(terms.join(" ")) ? 1.15 : 1),
        r,
        p,
      };
    });
    hits.sort(
      (a, b) =>
        b.score - a.score ||
        (b.r.lastActive ?? 0) - (a.r.lastActive ?? 0) ||
        a.id - b.id,
    );
    return hits.slice(0, 100).map(({ r, p, terms: matched }) => ({
      id: r.id,
      title: r.title || r.url,
      url: r.url,
      state: r.state,
      coverage: r.coverage,
      snippet: p
        ? `${p.start ? "…" : ""}${p.text}${p.end < r.text.length ? "…" : ""}`
        : "",
      passage: p,
      updated: r.updated,
      matchedTerms: matched,
      approximate,
      truncated: r.truncated,
    }));
  }
}
