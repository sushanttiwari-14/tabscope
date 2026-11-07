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
    expect(snippet("plain text", "absent")).toBe("plain text");
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
