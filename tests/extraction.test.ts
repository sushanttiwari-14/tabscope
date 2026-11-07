// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { extractReadable } from "../src/extract";
import { SearchIndex } from "../src/search";
describe("extraction → indexing → search", () => {
  it("includes below-viewport split text and excludes hidden/editable/form content", () => {
    document.body.innerHTML =
      '<article>Orbital <b>ceramic</b> engine<p style="margin-top:9999px">A below-viewport passage.</p></article><script>script-secret</script><input value="password-secret"><textarea>form-secret</textarea><div contenteditable="true"><b>edit-secret</b></div><div style="display:none"><b>hidden-secret</b></div><div aria-hidden="true">aria-secret</div><div id="tabscope-root">extension-secret</div>';
    const data = extractReadable();
    expect(data.text).toContain(
      "Orbital ceramic engine A below-viewport passage.",
    );
    expect(data.text).not.toContain("secret");
    const index = new SearchIndex();
    index.rebuild(
      new Map([
        [
          1,
          {
            id: 1,
            windowId: 1,
            title: "Unrelated",
            url: "https://example.com",
            text: data.text,
            updated: 1,
            state: "content",
          },
        ],
      ]),
    );
    expect(index.search("ceramic orbital")[0]?.id).toBe(1);
  });
  it("caps long text and labels truncation", () => {
    document.body.textContent = "a".repeat(100_000);
    const result = extractReadable();
    expect(result.text.length).toBeLessThanOrEqual(60_000);
    expect(result.truncated).toBe(true);
  });
});
