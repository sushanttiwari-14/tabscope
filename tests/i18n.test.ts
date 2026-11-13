import { it, expect, vi, afterEach } from "vitest";
import { acceptPDFMessages, pdfMessages } from "../src/pdf-messages";
import { t } from "../src/i18n";
afterEach(() => {
  acceptPDFMessages([]);
  vi.unstubAllGlobals();
});
it("supplies localized templates to a offscreen context without i18n", () => {
  vi.stubGlobal("__TABSCOPE_PRODUCTION__", true);
  vi.stubGlobal("chrome", {
    i18n: {
      getMessage: (key: string, values: string[]) =>
        `${key}: ${values.join(" / ")}`,
    },
  });
  const messages = pdfMessages();
  vi.stubGlobal("chrome", { runtime: {} });
  acceptPDFMessages(messages);
  expect(t("pdf_progress", [2, 5])).toBe("pdf_progress: 2 / 5 / ");
  expect(messages.length).toBeLessThan(30);
  // Unrecognized keys cannot install templates into unrelated interface controls.
  acceptPDFMessages([["settings", "Injected control"]]);
  expect(t("settings")).toBe("Settings");
});
it("rejects unbounded PDF template messages and preserves the current trusted catalog", () => {
  vi.stubGlobal("__TABSCOPE_PRODUCTION__", true);
  vi.stubGlobal("chrome", { runtime: {} });
  acceptPDFMessages([
    ["pdf_progress", "Pages __TABSCOPE_VALUE_1__ / __TABSCOPE_VALUE_2__"],
  ]);
  acceptPDFMessages([["pdf_progress", "x".repeat(2001)]]);
  expect(t("pdf_progress", [1, 4])).toBe("Pages 1 / 4");
});
