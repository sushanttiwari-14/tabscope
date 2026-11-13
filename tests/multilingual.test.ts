import { it, expect, describe, vi } from "vitest";
import { SearchIndex } from "../src/search";
import {
  normalize,
  relaxed,
  wordSpans,
  graphemes,
  safeEnd,
  localeHint,
  displayText,
  ANALYSIS_VERSION,
} from "../src/analysis";
import { parseQuery } from "../src/matching";
import type { TabRecord } from "../src/types";
import fixtures from "./fixtures/languages.json";

function record(
  id: number,
  text: string,
  extra: Partial<TabRecord> = {},
): TabRecord {
  return {
    id,
    text,
    title: "Fixture",
    url: `https://example.test/${id}`,
    windowId: 1,
    state: "content",
    updated: 1,
    ...extra,
  };
}
function index(records: TabRecord[]) {
  const s = new SearchIndex();
  s.rebuild(new Map(records.map((r) => [r.id, r])));
  return s;
}
function ranges(text: string, query: string, locale?: string) {
  const hit = index([record(1, text, { locale })]).search(query)[0];
  expect(hit).toBeDefined();
  for (const p of hit.passages ?? []) {
    expect(text.slice(p.start, p.end)).toBe(p.text);
    const boundaries = new Set([0, ...graphemes(text).map((g) => g.end)]);
    expect(boundaries.has(p.start)).toBe(true);
    expect(boundaries.has(p.end)).toBe(true);
    for (const r of p.ranges) {
      expect(boundaries.has(r.start)).toBe(true);
      expect(boundaries.has(r.end)).toBe(true);
      expect(r.start).toBeGreaterThanOrEqual(p.start);
      expect(r.end).toBeLessThanOrEqual(p.end);
    }
  }
  return hit;
}
describe("validated language fixtures (quality claims are feature specific)", () => {
  for (const [locale, text, query] of fixtures)
    it(`${locale}: source retrieval, offsets, title and URL fields`, () => {
      const hit = ranges(text, query, locale);
      expect(hit.passages?.length).toBeGreaterThan(0);
      const s = index([
        record(1, "", { title: text, locale }),
        record(2, "", { url: `https://example.test/${query}` }),
      ]);
      expect(s.search(query).some((h) => h.id === 1)).toBe(true);
      // URLs are parsed and stored as given; search does not rewrite routing values.
      if (locale !== "tr")
        expect(s.search(query).some((h) => h.id === 2)).toBe(true);
    });
});
it("separates canonical, case, relaxed aliases and distinct meaningful text", () => {
  expect(normalize("É")).toBe(normalize("E\u0301"));
  expect(normalize("가")).toBe(normalize("가"));
  expect(normalize("ΟΣ")).toBe(normalize("ος"));
  for (const [a, b] of [
    ["café", "cafe"],
    ["Straße", "Strasse"],
    ["ＡＢＣ", "abc"],
    ["عِلْم", "علم"],
    ["שָׁלוֹם", "שלום"],
  ]) {
    expect(normalize(a)).not.toBe(normalize(b));
    expect(relaxed(a)).toBe(relaxed(b));
    expect(ranges(a, b).passage?.kind).toBe("relaxed");
  }
  for (const [a, b] of [
    ["año", "ano"],
    ["が", "か"],
    ["की", "कि"],
    ["рара", "papa"],
    ["علم", "عالم"],
    ["漢字", "汉字"],
  ]) {
    expect(relaxed(a)).not.toBe(relaxed(b));
    expect(index([record(1, a)]).search(b)).toEqual([]);
  }
});
it("ranks canonical evidence above aliases and highlights the correct alias token", () => {
  const s = index([
    record(1, "café"),
    record(2, "cafe"),
    record(3, "café cafe"),
  ]);
  expect(s.search("cafe").at(-1)?.id).toBe(1);
  const hit = s.search("café").find((h) => h.id === 2)!;
  expect(hit.approximate).toBe(false);
  expect(hit.passage?.kind).toBe("relaxed");
  expect(hit.passage?.ranges).toEqual([{ start: 0, end: 4 }]);
});
it("uses validated Turkish hints without using interface language or guessing from Latin", () => {
  const s = index([record(1, "I İ ı i", { locale: "tr" })]);
  for (const [q, expected] of [
    ["I", [0, 4]],
    ["ı", [0, 4]],
    ["İ", [2, 6]],
    ["i", [2, 6]],
  ] as const)
    expect(s.search(q)[0]?.passage?.ranges.map((r) => r.start)).toEqual(
      expected,
    );
  expect(localeHint("not a locale! ")).toBeUndefined();
  expect(localeHint("tr-tr")).toBe("tr-TR");
  expect(
    index([record(1, "ceramic", { locale: "de" })]).search("ceramix"),
  ).toEqual([]);
  expect(
    index([record(1, "running", { locale: "fr" })]).search("runs"),
  ).toEqual([]);
  expect(
    index([record(1, "testing", { locale: "en" })]).search("tested")[0]
      ?.approximate,
  ).toBe(true);
  expect(index([record(1, "testing")]).search("tested")).toEqual([]);
});
it("verifies complete no-space sequences, bounds long input and never accepts one shared character", () => {
  for (const [text, q] of [
    ["中华人民共和国", "中华人民"],
    ["東京都", "京都"],
    ["ภาษาไทยทุกวัน", "ภาษาไทย"],
  ]) {
    const h = ranges(text, q);
    expect(h.passage?.ranges.map((r) => text.slice(r.start, r.end))).toContain(
      q,
    );
    expect(index([record(1, text)]).search(q + "不存在")).toEqual([]);
    ranges(text, `"${q}"`);
  }
  const s = index([record(1, "科学".repeat(15000))]);
  expect(s.search("科学")[0]?.passagesCapped).toBe(true);
  expect(s.search("科".repeat(81))).toEqual([]);
  expect(parseQuery("科学".repeat(250))).toBeNull();
});
it("preserves punctuation, whitespace, joiners and structural phrase boundaries", () => {
  for (const text of ["café\u00a0orbital", "café   orbital"])
    ranges(text, '"cafe orbital"');
  for (const text of [
    "cafe-orbital",
    "cafe,orbital",
    "cafe\u200borbital",
    "orbital cafe",
  ])
    expect(index([record(1, text)]).search('"cafe orbital"')).toEqual([]);
  ranges("l’amour français", '"l’amour français"');
  ranges("well-known words", '"well-known words"');
  expect(
    index([record(1, "science research", { breaks: [8] })]).search(
      '"science research"',
    ),
  ).toEqual([]);
  expect(
    index([record(1, "科学研究", { breaks: [2] })]).search('"科学研究"'),
  ).toEqual([]);
  expect(index([record(1, "科学\u0000研究")]).search('"科学研究"')).toEqual([]);
  expect(parseQuery("“science research”")?.every((c) => !c.phrase)).toBe(true);
  expect(parseQuery('"science research')?.[0].phrase).toBe(true);
});
it("keeps snippets safe around emoji, Indic conjuncts and combining sequences", () => {
  const text = "👩🏽‍💻 क्‍ष e\u0301 ".repeat(100) + "科学研究" + "👨‍👩‍👧‍👦".repeat(80);
  ranges(text, "科学");
  for (let end = 1; end < 40; end++) {
    const cut = safeEnd(text, end);
    expect(
      graphemes(text).some((g) => g.end === cut.length) || cut === "",
    ).toBe(true);
  }
});
it("invalidates locale analysis and query cache on sync and reconstructs old session records", () => {
  const r = record(1, "I");
  const s = index([r]);
  expect(s.search("i")).toHaveLength(1);
  r.locale = "tr";
  s.sync(new Map([[1, r]]));
  expect(s.search("i")).toHaveLength(0);
  expect(s.search("ı")).toHaveLength(1);
  expect(ANALYSIS_VERSION).toBeGreaterThan(0);
  s.rebuild(new Map([[1, record(1, "café")]]));
  expect(s.search("café")).toHaveLength(1);
});
it("uses conservative fallback without breaking graphemes or claiming dictionary segmentation", () => {
  const saved = Intl.Segmenter;
  vi.stubGlobal("Intl", {
    ...Intl,
    getCanonicalLocales: Intl.getCanonicalLocales,
    Segmenter: undefined,
  });
  try {
    expect(wordSpans("की café").map((w) => w.source)).toEqual(["की", "café"]);
    expect(safeEnd("👩‍💻abc", 3)).toBe("");
    expect(index([record(1, "中国")]).search("中国")).toHaveLength(1);
    expect(index([record(1, "中国人民")]).search("人民")).toHaveLength(0);
  } finally {
    vi.unstubAllGlobals();
    expect(Intl.Segmenter).toBe(saved);
  }
});
it("neutralizes untrusted bidi formatting only for display, preserving offset lengths", () => {
  const text = "عنوان\u202eTabScope\u202c 123";
  expect(displayText(text)).toBe("عنوان�TabScope� 123");
  expect(displayText(text).length).toBe(text.length);
});

it("validates canonical prefixes and exact whole phrases across the initial language targets", () => {
  const prefixes = [
    "ceram",
    "investig",
    "lumi",
    "Stra",
    "ciên",
    "ış",
    "исслед",
    "κόσ",
    "ال",
    "שָׁלוֹ",
    "जान",
    "中华",
    "中華",
    "京都",
    "한",
    "ภาษา",
  ];
  fixtures.forEach(([locale, text], i) => {
    ranges(text, prefixes[i], locale);
    ranges(text, `"${text}"`, locale);
  });
});
it("does not apply prose aliases or English recovery to URL identifiers", () => {
  const s = index([
    record(1, "", {
      url: "https://example.test/café/configuration",
      locale: "en",
    }),
  ]);
  expect(s.search("cafe")).toEqual([]);
  expect(s.search("configurtaion")).toEqual([]);
  expect(s.search("café")[0]?.url).toBe(
    "https://example.test/café/configuration",
  );
  expect(index([record(1, "running")]).search("runs")).toEqual([]);
});

it("does not prefix-match halfway through a significant grapheme", () => {
  expect(index([record(1, "İ")]).search("i")).toEqual([]);
  expect(index([record(1, "कि")]).search("क")).toEqual([]);
});

it("matches no-space phrase sequences despite contextual word segmentation and preserves punctuation", () => {
  ranges("生命科学 TabScope の研究", '"科学 TabScope"');
  ranges("東京都、科学研究所", '"京都、科学"');
  ranges("生命科学\u00a0  TabScope", '"科学 TabScope"');
  expect(
    index([record(1, "生命科学、TabScope")]).search('"科学 TabScope"'),
  ).toEqual([]);
  expect(
    index([record(1, "生命科学 TabScope", { breaks: [5] })]).search(
      '"科学 TabScope"',
    ),
  ).toEqual([]);
});

it("retains Turkish case distinctions in AND query deduplication", () => {
  const s = index([
    record(1, "I", { locale: "tr" }),
    record(2, "I i", { locale: "tr" }),
  ]);
  expect(s.search("I i").map((h) => h.id)).toEqual([2]);
});
it("requires literal leading and trailing phrase punctuation", () => {
  expect(
    index([record(1, "hello"), record(2, "hello!")])
      .search('"hello!"')
      .map((h) => h.id),
  ).toEqual([2]);
  ranges("(café orbital)", '"(cafe orbital)"');
  expect(index([record(1, "l’amour")]).search("l'amour")).toEqual([]);
  ranges("研究か\u3099あります", "が");
});

it("returns bounded source-relative URL excerpts without shifting highlights for ellipses", () => {
  const url =
    "https://example.test/" + "path/".repeat(90) + "café/" + "tail/".repeat(90);
  const h = index([record(1, "", { url })]).search("café")[0];
  expect(h.urlExcerpt).toBeDefined();
  const e = h.urlExcerpt!;
  expect(e.text.length).toBeLessThanOrEqual(240);
  expect(url.slice(e.start, e.end)).toBe(e.text);
  expect(
    e.ranges.map((r) => e.text.slice(r.start - e.start, r.end - e.start)),
  ).toContain("café");
});

it("clips oversized input at a complete grapheme without retaining a full grapheme array", () => {
  expect(safeEnd("a".repeat(1_000_000), 30)).toBe("a".repeat(30));
  expect(safeEnd("a👨‍👩‍👧‍👦" + "b".repeat(1_000_000), 5)).toBe("a");
});
