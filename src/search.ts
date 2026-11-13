import { parseQuery, evidence, passages, quality, wordKind } from "./matching";
import MiniSearch from "minisearch";
import {
  normalizeHost,
  type SearchFilters,
  type TabRecord,
  type Hit,
} from "./types";
import {
  ANALYSIS_VERSION,
  relaxed,
  tokenize,
  wordSpans,
  noSpace,
  englishPolicy,
  prepareRuns,
  sourceExcerpt,
} from "./analysis";
export { normalize, tokenize, wordSpans } from "./analysis";
function bestPassage(
  text: string,
  components: NonNullable<ReturnType<typeof parseQuery>>,
  words = wordSpans(text),
) {
  const record: TabRecord = {
    id: 0,
    windowId: 0,
    url: "",
    title: "",
    text,
    updated: 0,
    state: "content",
  };
  return passages(record, components, false, words, new Map()).items.sort(
    (a, b) => b.score - a.score || a.start - b.start,
  )[0];
}
export function passage(
  text: string,
  terms: string[],
  words = wordSpans(text),
) {
  if (!terms.length) return;
  return bestPassage(
    text,
    terms.map((source) => ({ terms: [source], source, phrase: false })),
    words,
  );
}
export function snippet(text: string, query: string): string {
  const components = parseQuery(query);
  const p = components?.length ? bestPassage(text, components) : undefined;
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
export { editDistance } from "./distance";
export class SearchIndex {
  private records = new Map<number, TabRecord>();
  private cache = new Map<string, Hit[]>();
  private spans = new Map<number, ReturnType<typeof wordSpans>>();
  private metadata = new Map<
    number,
    [ReturnType<typeof wordSpans>, ReturnType<typeof wordSpans>]
  >();
  private supplemental = new Set<number>();
  private analyze(r: TabRecord) {
    const body = wordSpans(r.text, r.locale);
    const title = wordSpans(r.title, r.locale),
      url = wordSpans(r.url, undefined, "url");
    for (const words of [body, title, url]) prepareRuns(words);
    this.spans.set(r.id, body);
    this.metadata.set(r.id, [title, url]);
    if (
      /^(tr|az)(-|$)/.test(body.locale ?? "") ||
      [...body, ...title, ...url].some((w) => w.term !== w.relaxed)
    )
      this.supplemental.add(r.id);
    else this.supplemental.delete(r.id);
  }
  private engine = new MiniSearch<TabRecord>({
    fields: ["title", "url", "text"],
    storeFields: [],
    tokenize,
    processTerm: (term) => term,
  });
  rebuild(records: Map<number, TabRecord>) {
    this.cache.clear();
    this.records = new Map([...records].map(([id, r]) => [id, { ...r }]));
    this.spans.clear();
    this.metadata.clear();
    this.supplemental.clear();
    for (const r of records.values()) this.analyze(r);
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
        this.metadata.delete(id);
        this.supplemental.delete(id);
      }
    for (const [id, r] of records) {
      const old = this.records.get(id);
      if (
        !old ||
        old.title !== r.title ||
        old.url !== r.url ||
        old.text !== r.text ||
        old.locale !== r.locale
      ) {
        if (old) this.engine.remove(old);
        this.engine.add(r);
        this.analyze(r);
      }
    }
    this.records = new Map([...records].map(([id, r]) => [id, { ...r }]));
  }
  clearQueryCache() {
    this.cache.clear();
  }
  search(query: string, filters: SearchFilters = {}): Hit[] {
    const cacheKey = JSON.stringify([ANALYSIS_VERSION, query, filters]);
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
      // parseQuery already segmented/canonicalized these index terms.
      tokenize: (text: string) => text.split(" "),
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
        if (!eligible(r.id) || !englishPolicy(r.locale)) continue;
        if (++tabs > 500) break;
        const text = (
          filters.pageText ? r.text : `${r.title} ${r.url} ${r.text}`
        ).slice(0, 2_000_000 - chars);
        chars += text.length;
        for (const w of [
          ...(filters.pageText ? [] : (this.metadata.get(r.id) ?? []).flat()),
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
                const kind = wordKind(t, w, true, "en");
                return kind === "variant" || kind === "typo";
              })
              .sort(
                (a, b) =>
                  quality[wordKind(t, b, true, "en")!] -
                    quality[wordKind(t, a, true, "en")!] || a.localeCompare(b),
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
    // Aliases, Turkish casing and context-sensitive segmentation need a verified
    // fallback beyond MiniSearch's word dictionary. No arbitrary candidate cap.
    const supplemental =
      terms.length &&
      (components.some((c) => noSpace(c.source ?? "")) ||
        terms.some((t) => t !== relaxed(t)))
        ? [...this.records.keys()]
            .filter(eligible)
            .map((id) => ({ id, score: 0 }))
        : [...this.supplemental]
            .filter(eligible)
            .map((id) => ({ id, score: 0 }));
    const candidates = terms.length
      ? [
          ...new Map(
            [...supplemental, ...approximate, ...exact].map((r) => [
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
      const groups = fields.map((text, field) =>
        evidence(
          text,
          components,
          true,
          filters.pageText || field === 2
            ? this.spans.get(r.id)
            : this.metadata.get(r.id)?.[field],
          filters.pageText || field === 2
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
          titleRanges: filters.pageText ? [] : groups[0].flat(),
          urlRanges: filters.pageText ? [] : groups[1].flat(),
          weak,
          tier: Math.min(5, ...best),
          score:
            (weak ? 0 : item.score) +
            groups.reduce(
              (sum, field, i) =>
                sum +
                field.reduce(
                  (n, group) =>
                    n + Math.max(0, ...group.map((m) => quality[m.kind])),
                  0,
                ) *
                  (filters.pageText ? 2 : [3, 1, 2][i]),
              0,
            ) +
            best.reduce((a, b) => a + b, 0) * 10 +
            (p?.score ?? 0),
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
    const result = hits
      .slice(0, 100)
      .map(({ r, p, ps, matched, titleRanges, urlRanges, weak }) => ({
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
        titleRanges,
        urlRanges,
        urlExcerpt: sourceExcerpt(
          r.url,
          urlRanges,
          this.metadata.get(r.id)![1],
        ),
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
