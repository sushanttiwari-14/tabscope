import { describe, it, expect } from "vitest";
import { SearchIndex, normalize, snippet } from "../src/search";
import {
  excluded,
  normalizeHost,
  enforceBudget,
  validCommit,
  type TabRecord,
} from "../src/types";
const record = (id: number, text: string, title = "Untitled"): TabRecord => ({
  id,
  windowId: 1,
  url: `https://example.com/${id}`,
  title,
  text,
  updated: id,
  state: "content",
});
describe("search", () => {
  it("finds noncontiguous body words absent from metadata and requires all terms", () => {
    const s = new SearchIndex();
    s.rebuild(
      new Map([
        [1, record(1, "The orbital engine uses a ceramic housing.")],
        [2, record(2, "An orbital path.")],
      ]),
    );
    expect(s.search("ceramic orbital").map((h) => h.id)).toEqual([1]);
    expect(s.search("ceram orbit").map((h) => h.id)).toEqual([1]);
  });
  it("folds diacritics/case and breaks equal scores deterministically", () => {
    expect(normalize("CAFÉ")).toBe("cafe");
    const s = new SearchIndex();
    s.rebuild(
      new Map([
        [2, record(2, "Café aroma")],
        [1, record(1, "Café aroma")],
      ]),
    );
    expect(s.search("cafe").map((h) => h.id)).toEqual([1, 2]);
  });
  it("creates only actual source snippets and handles no match safely", () => {
    const text = "a ".repeat(80) + "ceramic orbital engine " + "b ".repeat(200);
    expect(snippet(text, "orbital")).toContain("ceramic orbital engine");
    expect(text).toContain(snippet(text, "orbital").replace(/^…|…$/g, ""));
    expect(snippet("plain text", "absent")).toBe("");
    expect(snippet("", "q")).toBe("");
  });
  it("updates changed records incrementally, including in-place body eviction", () => {
    const index = new SearchIndex();
    const records = new Map([[1, record(1, "ceramic secret")]]);
    index.rebuild(records);
    records.get(1)!.text = "orbital engine";
    index.sync(records);
    expect(index.search("ceramic")).toHaveLength(0);
    expect(index.search("orbital")).toHaveLength(1);
    records.get(1)!.text = "";
    index.sync(records);
    expect(index.search("orbital")).toHaveLength(0);
    records.clear();
    index.sync(records);
    expect(index.search("")).toHaveLength(0);
  });
  it("removes obsolete results on rebuild", () => {
    const s = new SearchIndex();
    s.rebuild(new Map([[1, record(1, "secret")]]));
    s.rebuild(new Map());
    expect(s.search("secret")).toEqual([]);
  });
});
describe("privacy/lifecycle", () => {
  it("matches exact hosts and real subdomains only", () => {
    expect(excluded("https://a.example.com/p", ["example.com"])).toBe(true);
    expect(excluded("https://notexample.com", ["example.com"])).toBe(false);
    expect(excluded("https://example.com.evil.org", ["example.com"])).toBe(
      false,
    );
    expect(normalizeHost("https://Example.com/")).toBe("example.com");
    expect(normalizeHost("example.com/path")).toBe(null);
    expect(normalizeHost("*.example.com")).toBe(null);
  });
  it("rejects late navigation/clear/revocation work", () => {
    expect(validCommit(1, 2, "u", "u", false, false)).toBe(false);
    expect(validCommit(1, 1, "u", "v", false, false)).toBe(false);
    expect(validCommit(1, 1, "u", "u", true, false)).toBe(false);
    expect(validCommit(1, 1, "u", "u", false, true)).toBe(false);
    expect(validCommit(1, 1, "u", "u", false, false)).toBe(true);
  });
  it("bounds aggregate text and evicts oldest bodies", () => {
    const records = new Map([
      [1, record(1, "123456")],
      [2, record(2, "123456")],
    ]);
    enforceBudget(records, 7);
    expect(records.get(1)?.text).toBe("");
    expect(records.get(1)?.state).toBe("metadata-only");
    expect(records.get(2)?.text).toBe("123456");
  });
});

describe("passages, recovery and filters", () => {
  it("prefers distinct words and a nearby phrase over navigation and scattered terms", () => {
    const text =
      "event navigation. " +
      "x ".repeat(150) +
      "event " +
      "x ".repeat(60) +
      "horizon. " +
      "x ".repeat(150) +
      "The event horizon marks a boundary.";
    const result = snippet(text, "event horizon");
    expect(result).toContain("The event horizon");
    expect(result.length).toBeLessThanOrEqual(242);
    expect(result).not.toContain("navigation");
  });
  it("uses original Unicode offsets and deterministic repeated passages", () => {
    const text =
      "é ".repeat(150) +
      "🔭 Le cafe\u0301 pre\u0301sente un événement cosmique. " +
      "x ".repeat(200);
    const first = snippet(text, "cafe evenement");
    expect(first).toContain("cafe\u0301");
    expect(first).toContain("événement");
    expect(text).toContain(first.replace(/^…|…$/g, ""));
    expect(snippet(text + text, "cafe evenement")).toBe(first);
  });
  it("does not show unrelated body evidence for metadata-only matches", () => {
    const index = new SearchIndex();
    index.rebuild(new Map([[1, record(1, "Unrelated body", "Event horizon")]]));
    expect(index.search("event horizon")[0].snippet).toBe("");
    expect(index.search("")[0].snippet).toBe("");
    expect(index.search("event", { pageText: true })).toEqual([]);
  });
  it("orders empty results by recency, keeps strong relevance primary, and initializes ties by id", () => {
    const index = new SearchIndex();
    index.rebuild(
      new Map([
        [2, { ...record(2, "event"), lastActive: 20 }],
        [1, { ...record(1, "event", "event"), lastActive: 10 }],
      ]),
    );
    expect(index.search("").map((h) => h.id)).toEqual([2, 1]);
    expect(index.search("event")[0].id).toBe(1);
  });
  it("only falls back after normal search, preserves all terms and labels real approximate words", () => {
    const index = new SearchIndex();
    index.rebuild(
      new Map([
        [1, record(1, "orbital ceramic engine")],
        [2, record(2, "orbital only")],
      ]),
    );
    expect(index.search("orbital ceramic")[0].approximate).toBe(false);
    const typo = index.search("orbital ceramix");
    expect(typo.map((h) => h.id)).toEqual([1]);
    expect(typo[0].approximate).toBe(true);
    expect(typo[0].matchedTerms).toContain("ceramic");
    expect(typo[0].snippet).toContain("ceramic");
    expect(index.search("z")).toEqual([]);
    expect(index.search("orbital zzzzzz")).toEqual([]);
    expect(index.search("x".repeat(500))).toEqual([]);
    expect(index.search("!")).toHaveLength(2);
    expect(
      index.search(Array.from({ length: 13 }, (_, i) => "word" + i).join(" ")),
    ).toEqual([]);
  });
  it("applies combined filters before limits, including body-only typo recovery and IDN hosts", () => {
    const index = new SearchIndex();
    const records = new Map(
      Array.from({ length: 120 }, (_, i) => [i, record(i, "event horizon")]),
    );
    records.set(200, {
      ...record(200, "event horizon"),
      windowId: 2,
      url: "https://sub.xn--bcher-kva.de/a",
    });
    index.rebuild(records);
    const filter = { windowId: 2, domain: "bücher.de", pageText: true };
    expect(index.search("event", filter).map((h) => h.id)).toEqual([200]);
    expect(index.search("evant horizon", filter).map((h) => h.id)).toEqual([
      200,
    ]);
    expect(index.search("event", { ...filter, exactHost: true })).toEqual([]);
    expect(index.search("event", { domain: "[.*" })).toEqual([]);
    expect(index.search("event", { domain: "de/a" })).toEqual([]);
  });
});

it("marks evictions explicitly and never exceeds the passage display bound", () => {
  const records = new Map([[1, record(1, "event horizon")]]);
  enforceBudget(records, 1);
  expect(records.get(1)?.coverage).toBe("budget");
  expect(snippet("event" + "x".repeat(60000), "event")).toBe("");
  expect(snippet("x".repeat(50_000) + " event horizon", "event horizon").length).toBeLessThanOrEqual(242);
});
