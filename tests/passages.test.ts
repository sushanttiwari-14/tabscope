import { describe, it, expect } from "vitest";
import { SearchIndex, editDistance } from "../src/search";
import { parseQuery } from "../src/matching";
import { pdfPageText, pdfPageURL } from "../src/pdf";
import { enforceBudget, type TabRecord } from "../src/types";
const record = (
  id: number,
  text: string,
  extra: Partial<TabRecord> = {},
): TabRecord => ({
  id,
  windowId: 1,
  locale: "en",
  url: `https://example.test/${id}`,
  title: "Notes",
  text,
  state: "content",
  updated: 123,
  ...extra,
});
const search = (records: TabRecord[]) => {
  const index = new SearchIndex();
  index.rebuild(new Map(records.map((r) => [r.id, r])));
  return index;
};
describe("multiple passages", () => {
  it("retains identical paragraphs at distinct offsets and stable IDs, in document order", () => {
    const paragraph = "Café café orbital ceramic engine.";
    const text = Array(4).fill(paragraph).join(" ");
    const breaks = Array.from(
      { length: 3 },
      (_, i) => (paragraph.length + 1) * (i + 1),
    );
    const index = search([record(1, text, { breaks })]);
    const h = index.search("cafe ceramic")[0];
    expect(h.passages).toHaveLength(4);
    expect(new Set(h.passages!.map((p) => p.id)).size).toBe(4);
    expect(h.passages!.map((p) => p.start)).toEqual(
      [...h.passages!.map((p) => p.start)].sort((a, b) => a - b),
    );
    for (const p of h.passages!) {
      expect(text.slice(p.start, p.end)).toBe(p.text);
      expect(p.ranges.map((r) => text.slice(r.start, r.end))).toContain("café");
    }
    expect(index.search("cafe ceramic")[0].passages).toEqual(h.passages);
  });
  it("merges nearby occurrences into a passage and caps distinct paragraphs honestly", () => {
    const text = Array(60).fill("orbital orbital ceramic").join(" ");
    const index = search([
      record(1, text, {
        breaks: Array.from(
          { length: 59 },
          (_, i) => ("orbital orbital ceramic".length + 1) * (i + 1),
        ),
      }),
    ]);
    const h = index.search("orbital")[0];
    expect(h.passages).toHaveLength(32);
    expect(h.passagesCapped).toBe(true);
    expect(h.passages![0].ranges).toHaveLength(2);
  });
  it("initially chooses complete exact evidence over an early partial match", () => {
    const index = search([
      record(
        1,
        "orbital navigation " +
          "filler ".repeat(100) +
          "orbital ceramic engine",
      ),
    ]);
    expect(index.search("orbital ceramic")[0].passage!.text).toContain(
      "orbital ceramic",
    );
  });
});
describe("query semantics and hierarchy", () => {
  it("enforces quoted and mixed AND phrases, including normalized whitespace and accents", () => {
    const index = search([
      record(1, "database connection timeout café"),
      record(2, "database connection random timeout"),
      record(3, "connection timeout"),
    ]);
    expect(
      index.search('database "connection timeout"').map((h) => h.id),
    ).toEqual([1]);
    expect(
      index
        .search('"connection timeout')
        .map((h) => h.id)
        .sort(),
    ).toEqual([1, 3]);
    expect(
      search([record(1, "café   orbital")]).search('"cafe orbital"'),
    ).toHaveLength(1);
    expect(index.search('"connection timeot"')).toEqual([]);
    expect(index.search('"connect time"')).toEqual([]);
  });
  it("does not form phrases across paragraph or PDF page boundaries", () => {
    expect(
      search([record(1, "connection timeout", { breaks: [11] })]).search(
        '"connection timeout"',
      ),
    ).toEqual([]);
    const pdf = {
      pages: [
        { page: 1, start: 0, end: 10 },
        { page: 2, start: 13, end: 20 },
      ],
      total: 2,
      searched: 2,
      textPages: 2,
      status: "ready",
    };
    const index = search([record(1, "connection\n\f\ntimeout", { pdf })]);
    expect(index.search('"connection timeout"')).toEqual([]);
    const h = index.search("timeout")[0];
    expect(h.passage?.page).toBe(2);
    expect(h.passage?.pageOffset).toBe(0);
  });
  it("preserves strong results and adds deduplicated lower priority approximate tabs", () => {
    const index = search([
      record(1, "configuration exact"),
      record(2, "configurtaion typo"),
      record(3, "configuration configurtaion"),
    ]);
    const hits = index.search("configuration");
    expect(hits.filter((h) => !h.approximate).map((h) => h.id)).toContain(1);
    expect(hits.at(-1)?.id).toBe(2);
    expect(hits.at(-1)?.approximate).toBe(true);
    expect(new Set(hits.map((h) => h.id)).size).toBe(hits.length);
    expect(hits.at(-1)?.passage?.kind).toBe("typo");
    expect(
      hits
        .at(-1)
        ?.passage?.ranges.map((r) =>
          hits
            .at(-1)!
            .passage!.text.slice(
              r.start - hits.at(-1)!.passage!.start,
              r.end - hits.at(-1)!.passage!.start,
            ),
        ),
    ).toContain("configurtaion");
  });
  it("supports conservative English variants, transpositions and short/numeric exact behavior", () => {
    expect(
      search([record(1, "running experiments")]).search("run experiment")[0]
        ?.approximate,
    ).toBe(false); // prefix remains primary
    expect(
      search([record(1, "running")]).search("runs")[0]?.passage?.kind,
    ).toBe("variant");
    expect(search([record(1, "run")]).search("running")[0]?.passage?.kind).toBe(
      "variant",
    );
    expect(editDistance("cermaic", "ceramic", 1)).toBe(true);
    expect(search([record(1, "abcd 1235")]).search("abcx")).toHaveLength(1);
    expect(search([record(1, "abd 1235")]).search("abc")).toHaveLength(0);
    expect(search([record(1, "1235")]).search("1234")).toHaveLength(0);
  });
  it("bounds malformed and excessive input and handles repeated terms predictably", () => {
    expect(parseQuery("x".repeat(501))).toBeNull();
    expect(parseQuery("!")).toEqual([]);
    expect(
      search([record(1, "database")]).search("database database"),
    ).toHaveLength(1);
    expect(
      search([record(1, "connection timeout")]).search('"" connection'),
    ).toHaveLength(1);
  });
});
describe("PDF normalization and navigation", () => {
  it("retains physical navigation query/fragment arguments and rejects unsafe URLs", () => {
    expect(
      pdfPageURL("https://example.test/doc?token=a#zoom=125&page=1", 12),
    ).toBe("https://example.test/doc?token=a#zoom=125&page=12");
    expect(() => pdfPageURL("file:///doc.pdf", 2)).toThrow();
    expect(() => pdfPageURL("https://a.test", 0)).toThrow();
  });
  it("expands ligatures, removes soft hyphens and blocks false column phrases", () => {
    const item = (str: string, x: number, y = 700) => ({
      str,
      transform: [12, 0, 0, 12, x, y],
      width: 40,
    });
    expect(pdfPageText([item("ﬁnal soft\u00adhyphen", 10)])).toBe(
      "final softhyphen",
    );
    const text = pdfPageText([item("connection", 10), item("timeout", 300)]);
    expect(text).toContain("\u0000");
    expect(search([record(1, text)]).search('"connection timeout"')).toEqual(
      [],
    );
  });
});

it("does not use synthetic PDF whitespace widths to connect columns", () => {
  const text = pdfPageText([
    { str: "connection", transform: [12, 0, 0, 12, 72, 700], width: 80 },
    { str: " ", transform: [12, 0, 0, 12, 152, 700], width: 228 },
    { str: "timeout", transform: [12, 0, 0, 12, 380, 700], width: 80 },
  ]);
  expect(text).toBe("connection\u0000timeout");
});

it("preserves opaque fragment bytes and replaces conflicting PDF destinations", () => {
  expect(
    pdfPageURL(
      "https://example.test/doc?q=a%20b#zoom=125&custom=a%20b+c&nameddest=chapter",
      4,
    ),
  ).toBe("https://example.test/doc?q=a%20b#zoom=125&custom=a%20b+c&page=4");
});

it("never expands a source passage beyond its response bound for giant unbroken tokens", () => {
  const index = search([record(1, "event" + "x".repeat(59995))]);
  expect(index.search("event")).toEqual([]);
});

it("keeps long literal phrases whole while limiting surrounding context", () => {
  const phrase = Array(9).fill("configurationexperimental").join(" ");
  const h = search([record(1, "preceding context before " + phrase)]).search(
    '"' + phrase + '"',
  )[0];
  expect(h.passage!.text).toContain(phrase);
  expect(h.passage!.text.length).toBeLessThanOrEqual(240);
});

it("budgets location maps as well as source text", () => {
  const records = new Map([
    [1, record(1, "small body", { breaks: [1, 2, 3, 4, 5] })],
    [2, record(2, "latest", { updated: 124 })],
  ]);
  enforceBudget(records, 30);
  expect(records.get(1)!.text).toBe("");
  expect(records.get(1)!.breaks).toBeUndefined();
  expect(records.get(2)!.text).toBe("latest");
});
