// Actual Chrome + production worker/UI/PDF.js, synthetic local data only.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, cp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { unicodeFixturePDF } from "../tests/fixtures/pdf.mjs";
const fixtures = JSON.parse(
  await readFile("tests/fixtures/languages.json", "utf8"),
);
const temp = await mkdtemp(path.join(os.tmpdir(), "tabscope-multilingual-"));
const evidence = path.resolve("work/multilingual-browser");
await mkdir(evidence, { recursive: true });
await cp("dist", path.join(temp, "extension"), { recursive: true });
const mp = path.join(temp, "extension/manifest.json");
const manifest = JSON.parse(await readFile(mp, "utf8"));
manifest.host_permissions = ["http://127.0.0.1/*"];
await writeFile(mp, JSON.stringify(manifest));
const server = createServer((req, res) => {
  if (req.url.startsWith("/unicode.pdf")) {
    res.setHeader("Content-Type", "application/pdf");
    res.end(
      unicodeFixturePDF([
        "café Straße",
        "科学研究 日本語 が",
        "विज्ञान जानकारी",
        "ملعلا TabScope",
        "םולש TabScope",
        "café \ufffd unknown",
      ]),
    );
    return;
  }
  const num = Number(req.url.slice(1)),
    fixture = fixtures[num] ?? fixtures[0];
  const [locale, text] = fixture;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><html lang="${locale}"><title>${text} · https://example.test/a/very/long/url?q=123</title><body><input id="prior"><article id="source">${text}</article><p id="split">科学<b>研究</b> — 👩🏽‍💻 — नमस्ते</p><p>Control safety: \u202eTabScope\u202c 123</p></body></html>`,
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const context = await chromium.launchPersistentContext(
  path.join(temp, "profile"),
  {
    executablePath:
      process.env.TABSCOPE_CHROME ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  },
);
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", {
    path: path.join(temp, "extension"),
  });
  const pages = [];
  for (let n = 0; n < fixtures.length; n++) {
    const page = await context.newPage();
    await page.goto(origin + "/" + n);
    pages.push(page);
  }
  const pdf = await context.newPage();
  await pdf.goto(origin + "/unicode.pdf").catch(() => {});
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/palette.html`);
  await ui.evaluate(() =>
    chrome.storage.local.set({ contentAccessExplained: true }),
  );
  await ui.reload();
  const worker = context.serviceWorkers().find((w) => w.url().includes(id));
  const call = (m) => ui.evaluate((m) => chrome.runtime.sendMessage(m), m);
  await call({ type: "refresh" });
  const find = async (query, url) => {
    let result;
    for (let n = 0; n < 120; n++) {
      result = await call({
        type: "search",
        query,
        filters: { pageText: true },
      });
      const h = result.hits.find((h) => h.url === url);
      if (h && (!h.pdf || h.coverage !== "indexing")) return h;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(`Missing fixture ${query}: ${JSON.stringify(result.coverage)}`);
  };
  const checks = [];
  for (let n = 0; n < fixtures.length; n++) {
    const [locale, text, query] = fixtures[n];
    const hit = await find(query, pages[n].url());
    assert.ok(hit.passages.length);
    for (const p of hit.passages) {
      assert.equal(
        p.text,
        (
          await worker.evaluate(
            async (id) =>
              (await chrome.storage.session.get("records")).records.find(
                (r) => r.id === id,
              ).text,
            hit.id,
          )
        ).slice(p.start, p.end),
      );
      for (const r of p.ranges) assert.ok(r.end > r.start);
    }
    checks.push({
      locale,
      query,
      matched: hit.passage.ranges.map((r) =>
        hit.passage.text.slice(
          r.start - hit.passage.start,
          r.end - hit.passage.start,
        ),
      ),
    });
  }
  for (const [q, pageNo] of [
    ["cafe", 1],
    ["Strasse", 1],
    ["科学研究", 2],
    ["が", 2],
    ["जानकारी", 3],
    ["العلم", 4],
    ["שלום", 5],
  ]) {
    const hit = await find(q, pdf.url());
    assert.equal(hit.passage.page, pageNo);
    assert.ok(
      hit.pdf.status.startsWith("Searched "),
      "Offscreen localization must use the worker catalog",
    );
  }
  const limitedPDF = await find("unknown", pdf.url());
  assert.equal(limitedPDF.coverage, "partial");
  assert.equal(limitedPDF.pdf.replacementCharacters, true);
  assert.ok(limitedPDF.pdf.status.includes("replacement characters"));
  // Overlapping phrase evidence renders its full union without losing the tail.
  await ui.getByRole("combobox").fill('"orbital ceramic" "ceramic engine"');
  await ui
    .locator(".snippet mark")
    .filter({ hasText: "orbital ceramic engine" })
    .first()
    .waitFor();
  // Real source ranges spanning adjacent DOM nodes. This query is absent from the title.
  const hit = await find('"科学研究"', pages[0].url());
  await call({
    type: "navigate",
    id: hit.id,
    query: '"科学研究"',
    url: hit.url,
    updated: hit.updated,
    passageId: hit.passage.id,
  });
  await pages[0].waitForFunction(() =>
    CSS.highlights.has("tabscope-active-match"),
  );
  assert.equal(
    await pages[0].evaluate(() =>
      [...CSS.highlights.get("tabscope-active-match")][0].toString(),
    ),
    "科学研究",
  );
  assert.equal(
    await pages[0].evaluate(() => {
      const r = [...CSS.highlights.get("tabscope-active-match")][0];
      return r.startContainer !== r.endContainer;
    }),
    true,
  );
  // Hindi input must retrieve, preview and navigate to the original Devanagari.
  const hindiIndex = fixtures.findIndex(([locale]) => locale === "hi");
  const hindiPage = pages[hindiIndex];
  for (const query of ["विज्ञान", "जानकारी"]) {
    const hindi = await find(query, hindiPage.url());
    await ui.getByRole("combobox").fill(query);
    await ui
      .getByRole("option")
      .filter({ hasText: fixtures[hindiIndex][1] })
      .locator(".snippet mark")
      .filter({ hasText: query })
      .first()
      .waitFor();
    await call({
      type: "navigate",
      id: hindi.id,
      query,
      url: hindi.url,
      updated: hindi.updated,
      passageId: hindi.passage.id,
    });
    await hindiPage.waitForFunction((expected) => {
      const ink = CSS.highlights.get("tabscope-active-match");
      return ink && [...ink].some((range) => range.toString() === expected);
    }, query);
  }
  for (const query of ["कि", "vigyan", "science"]) {
    const result = await call({
      type: "search",
      query,
      filters: { pageText: true },
    });
    assert.equal(
      result.hits.some((hit) => hit.url === hindiPage.url()),
      false,
      "Hindi search must retain vowel signs and must not translate or transliterate queries",
    );
  }
  // A DOM lang change invalidates worker analysis without changing source text.
  await pages[5].evaluate(() => (document.documentElement.lang = "en"));
  let changedHint = false;
  for (let n = 0; n < 120; n++) {
    const result = await call({
      type: "search",
      query: "ışık",
      filters: { pageText: true },
    });
    if (!result.hits.some((h) => h.url === pages[5].url())) {
      changedHint = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    changedHint,
    true,
    "Document hint changes must invalidate analysis",
  );
  await pages[5].evaluate(() => (document.documentElement.lang = "tr"));
  await find("ışık", pages[5].url());
  // Production UI evidence highlights and mixed directions, with hostile bidi controls.
  await ui.getByRole("combobox").fill("العلم");
  await ui.locator(".row .snippet mark").first().waitFor();
  assert.equal(await ui.locator(".title").first().getAttribute("dir"), "auto");
  assert.equal(
    await ui.locator(".snippet").first().getAttribute("dir"),
    "auto",
  );
  assert.equal(
    await ui.evaluate(
      () => getComputedStyle(document.querySelector(".row")).direction,
    ),
    "ltr",
  );
  assert.ok((await ui.locator("mark").allTextContents()).includes("العِلْم"));
  await ui.setViewportSize({ width: 360, height: 640 });
  assert.equal(
    await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await ui.waitForTimeout(400);
  await ui.screenshot({ path: path.join(evidence, "arabic-narrow.png") });
  await ui.getByRole("combobox").fill("שלום");
  await ui.locator(".snippet mark").first().waitFor();
  await ui.waitForTimeout(400);
  await ui.screenshot({ path: path.join(evidence, "hebrew-narrow.png") });
  await ui.getByRole("combobox").fill("TabScope");
  await ui.waitForFunction(() =>
    [...document.querySelectorAll(".snippet")].some((e) =>
      e.textContent.includes("�"),
    ),
  );
  assert.equal(
    await ui.evaluate(() =>
      [...document.querySelectorAll(".title,.snippet")].some((e) =>
        /[\u202a-\u202e\u2066-\u2069]/.test(e.textContent),
      ),
    ),
    false,
  );
  // Synthetic composition events exercise guards, not a physical OS IME.
  await ui.evaluate(() => {
    window.requests = [];
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...args) => {
      window.requests.push(m.type);
      return original(m, ...args);
    };
    const input = document.querySelector(".field");
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    input.value = "日本語";
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true }),
    );
    for (const key of ["Enter", "ArrowDown", "ArrowUp"]) {
      const e = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      });
      input.dispatchEvent(e);
      if (e.defaultPrevented) throw Error("IME key intercepted");
    }
  });
  await ui.waitForTimeout(250);
  assert.equal(
    await ui.evaluate(() =>
      window.requests.some((t) => t === "navigate" || t === "search"),
    ),
    false,
  );
  await ui.evaluate(() =>
    document.querySelector(".field").dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "日本語",
      }),
    ),
  );
  await ui.waitForFunction(() => window.requests.includes("search"));
  assert.equal(await ui.getByRole("combobox").inputValue(), "日本語");
  // Test-only pseudo-localization: replace Chrome API in this disposable renderer,
  // keeping the shipping catalog English-only. Longer labels exercise narrow layout.
  await ui.evaluate(() => {
    const get = chrome.i18n.getMessage.bind(chrome.i18n);
    chrome.i18n.getMessage = (key, ...args) =>
      "［" + get(key, ...args) + " extended label］";
  });
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  await ui.waitForFunction(() =>
    document.querySelector("h2")?.textContent.includes("extended label"),
  );
  assert.equal(
    await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await ui.waitForTimeout(400);
  await ui.screenshot({ path: path.join(evidence, "pseudo-settings.png") });
  assert.equal(
    await ui.evaluate(() =>
      [...document.querySelectorAll(".setting-row,.shortcut-actions")].every(
        (e) => e.scrollWidth <= e.clientWidth + 1,
      ),
    ),
    true,
  );
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        browser: context.browser().version(),
        passed: true,
        checks,
        pdf: "Synthetic ToUnicode extraction: Latin, Chinese/Japanese, Hindi, Arabic, Hebrew; glyph typography unverified",
        splitNodeHighlight: true,
        hindiInputPreviewAndDestination: true,
        hindiSignificantVowelsAndNoTranslation: true,
        overlappingPhraseHighlights: true,
        dynamicLanguageHint: true,
        ime: "Synthetic composition events only; native IME unverified",
        rtlNarrow: true,
        pseudoLocalization: true,
        segmenter: await ui.evaluate(() =>
          new Intl.Segmenter("en", { granularity: "word" }).resolvedOptions(),
        ),
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: multilingual worker retrieval, Unicode PDF extraction/pages, source-range split-node highlighting, RTL isolation, narrow layout, bidi controls, synthetic IME and pseudo-localization",
  );
} finally {
  await context.close();
  server.close();
}
