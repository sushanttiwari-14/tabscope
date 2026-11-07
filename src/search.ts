import MiniSearch from "minisearch";
import type { TabRecord, Hit } from "./types";
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const tokenize = (s: string) =>
  normalize(s).match(/[\p{L}\p{N}]+/gu) ?? [];
export function snippet(text: string, query: string): string {
  if (!text) return "";
  const words = tokenize(query);
  const n = normalize(text);
  const offsets = words.map((w) => n.indexOf(w)).filter((i) => i >= 0);
  const at = offsets.length ? Math.min(...offsets) : 0;
  const start = Math.max(0, at - 65);
  return (
    (start ? "…" : "") +
    text.slice(start, start + 240).trim() +
    (text.length > start + 240 ? "…" : "")
  );
}
export class SearchIndex {
  private records = new Map<number, TabRecord>();
  private engine = new MiniSearch<TabRecord>({
    fields: ["title", "url", "text"],
    storeFields: [],
    tokenize,
    processTerm: normalize,
  });
  rebuild(records: Map<number, TabRecord>) {
    this.records = new Map(records);
    this.engine.removeAll();
    this.engine.addAll([...records.values()]);
  }
  search(query: string): Hit[] {
    const terms = tokenize(query);
    const found = terms.length
      ? this.engine
          .search(terms.join(" "), {
            combineWith: "AND",
            prefix: true,
            boost: { title: 3, text: 2, url: 1 },
          })
          .map((r) => ({
            id: Number(r.id),
            score:
              r.score *
              (normalize(this.records.get(Number(r.id))?.text ?? "").includes(
                normalize(query),
              )
                ? 1.5
                : 1),
          }))
          .sort((a, b) => b.score - a.score || a.id - b.id)
      : [...this.records.keys()]
          .sort((a, b) => a - b)
          .map((id) => ({ id, score: 0 }));
    return found.slice(0, 100).flatMap(({ id }) => {
      const r = this.records.get(id);
      return r
        ? [
            {
              id: r.id,
              title: r.title || r.url,
              url: r.url,
              state: r.state,
              snippet: snippet(r.text, query),
              truncated: r.truncated,
            },
          ]
        : [];
    });
  }
}
