import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, cp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fixturePDF } from "../tests/fixtures/pdf.mjs";
const temp = await mkdtemp(path.join(os.tmpdir(), "tabscope-passages-"));
const evidence = path.resolve("work/passages-browser");
await mkdir(evidence, { recursive: true });
await cp("dist", path.join(temp, "extension"), { recursive: true });
const mp = path.join(temp, "extension/manifest.json");
const manifest = JSON.parse(await readFile(mp, "utf8"));
manifest.host_permissions = ["http://127.0.0.1/*"];
await writeFile(mp, JSON.stringify(manifest));
const server = createServer((req, res) => {
  if (req.url.startsWith("/columns.pdf")) {
    res.setHeader("Content-Type", "application/pdf");
    res.end(
      fixturePDF([
        [
          { str: "connection", x: 72, y: 700 },
          { str: "timeout", x: 380, y: 700 },
        ],
      ]),
    );
    return;
  }
  if (
    req.url.startsWith("/document") ||
    req.url.startsWith("/scan") ||
    req.url.startsWith("/large")
  ) {
    res.setHeader("Content-Type", "application/pdf");
    res.end(
      fixturePDF(
        req.url.startsWith("/scan")
          ? ["", ""]
          : req.url.startsWith("/large")
            ? Array.from(
                { length: 45 },
                (_, i) => `orbital ceramic physical page ${i + 1}`,
              )
            : undefined,
      ),
    );
    return;
  }
  if (req.url.startsWith("/bad.pdf")) {
    res.setHeader("Content-Type", "application/pdf");
    res.end("not a PDF");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><title>Repeated passages</title><body><header style="position:sticky;top:0;background:white;height:60px">Sticky header</header><div style="height:250px;overflow:auto"><p id="one">The café orbital <b>ceramic</b> engine is here.</p><p>${"spacer ".repeat(200)}</p><p id="two">The café orbital <b>ceramic</b> engine is here.</p><p>${"spacer ".repeat(200)}</p><p id="three">The café orbital <b>ceramic</b> engine is here.</p></div><p>We are running a configuration experiment.</p></body>`,
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
  const page = await context.newPage();
  await page.goto(origin + "/html");
  const pdf = await context.newPage();
  await pdf.goto(origin + "/document?keep=yes").catch(() => {});
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/palette.html`);
  await ui.evaluate(() =>
    chrome.storage.local.set({ contentAccessExplained: true }),
  );
  await ui.reload();
  let worker = context.serviceWorkers().find((w) => w.url().includes(id));
  worker.on("console", (m) => console.log("worker", m.text()));
  worker.on("pageerror", (e) => console.log(e));
  const call = (m) => ui.evaluate((m) => chrome.runtime.sendMessage(m), m);
  await call({ type: "refresh" });
  const search = async (query, predicate) => {
    let r;
    for (let n = 0; n < 200; n++) {
      r = await call({ type: "search", query });
      if (predicate(r)) return r;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log(JSON.stringify(r));
    console.log("tabs", await worker.evaluate(() => chrome.tabs.query({})));
    console.log(
      "contexts",
      await worker.evaluate(() => chrome.runtime.getContexts({})),
    );
    for (const f of pdf.frames()) {
      try {
        console.log(
          "frame",
          f.url(),
          await f.evaluate(() =>
            document.documentElement.outerHTML.slice(0, 1200),
          ),
        );
      } catch {}
    }
    throw Error("Search did not settle");
  };
  let r = await search("orbital ceramic", (r) =>
    r.hits.some((h) => h.pdf && h.passages?.length === 3),
  );
  let html = r.hits.find((h) => h.url === page.url()),
    pdfHit = r.hits.find((h) => h.pdf);
  assert.equal(html.passages.length, 3);
  assert.equal(pdfHit.passages[2].page, 3);
  await ui.getByRole("combobox").fill("orbital ceramic");
  await ui
    .getByRole("option")
    .filter({ hasText: "Repeated passages" })
    .waitFor();
  // select HTML without activating it, inspect controls/input and stable polling.
  await ui.getByRole("option").filter({ hasText: "Repeated passages" }).hover();
  const controls = ui.getByRole("group", { name: "Selected tab passages" });
  assert.equal(
    await controls
      .getByRole("button", { name: "Previous", exact: true })
      .isDisabled(),
    true,
  );
  await controls.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(
    await ui
      .getByRole("combobox")
      .evaluate((e) => e === document.activeElement),
    true,
  );
  assert.ok((await controls.textContent()).includes("Passage 2 of 3"));
  await new Promise((r) => setTimeout(r, 2100));
  assert.ok((await controls.textContent()).includes("Passage 2 of 3"));
  await controls.getByRole("button", { name: "Next", exact: true }).click();
  assert.ok((await controls.textContent()).includes("Passage 3 of 3"));
  assert.equal(
    await controls
      .getByRole("button", { name: "Next", exact: true })
      .isDisabled(),
    true,
  );
  await controls.getByRole("button", { name: "Previous", exact: true }).click();
  assert.ok((await controls.textContent()).includes("Passage 2 of 3"));
  for (const scheme of ["light", "dark"]) {
    await ui.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await ui.locator("dialog").evaluate(async (e) => {
      await Promise.all(
        e
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {})),
      );
    });
    await ui.screenshot({
      path: path.join(evidence, `passages-${scheme}.png`),
    });
  }
  await ui.setViewportSize({ width: 360, height: 640 });
  await ui.screenshot({ path: path.join(evidence, "passages-narrow.png") });
  assert.equal(
    await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await ui.getByRole("combobox").fill("configurtaion");
  await ui.getByText("Approximate matches", { exact: true }).waitFor();
  assert.ok(
    (await ui.locator(".match-quality").first().textContent()).includes(
      "configuration",
    ),
  );
  await ui.screenshot({ path: path.join(evidence, "approximate-narrow.png") });
  await ui.getByRole("combobox").fill("orbital ceramic");
  await ui.waitForFunction(
    () => document.querySelectorAll("[role=option]").length === 2,
  );
  await worker.evaluate(
    async (id) =>
      chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
          globalThis.__tabscopeAgent?.dispose();
          delete globalThis.__tabscopeAgent;
          globalThis.__tabscope = true;
          // A former agent can leave delayed cleanup and an old message listener.
          setTimeout(() => {
            CSS.highlights.delete("tabscope-match");
            document.getElementById("tabscope-navigator")?.remove();
          }, 1000);
          chrome.runtime.onMessage.addListener((m, _sender, reply) => {
            if (m.type === "highlight") reply(false);
          });
        },
      }),
    html.id,
  );
  for (const i of [1, 2, 0, 1]) {
    const p = html.passages[i];
    const result = await call({
      type: "navigate",
      id: html.id,
      query: "orbital ceramic",
      url: html.url,
      updated: html.updated,
      passageId: p.id,
    });
    assert.equal(result.activated, true);
    await page.waitForFunction(() =>
      CSS.highlights.has("tabscope-active-match"),
    );
    assert.equal(
      await page.evaluate(
        () =>
          [
            ...CSS.highlights.get("tabscope-active-match"),
          ][0].startContainer.parentElement.closest("p").id,
      ),
      ["one", "two", "three"][i],
    );
  }
  await page.locator("body").evaluate((e) => {
    const clock = document.createElement("aside");
    clock.textContent = "Unrelated live update";
    e.append(clock);
  });
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("tabscope-active-match")),
    true,
  );
  await page.screenshot({
    path: path.join(evidence, "destination-highlight.png"),
  });
  await new Promise((resolve) => setTimeout(resolve, 8000));
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("tabscope-active-match")),
    true,
  );
  assert.equal(
    await page.locator("#tabscope-match-navigator button").count(),
    3,
  );
  await page
    .locator("#tabscope-match-navigator")
    .getByRole("button", { name: "Next", exact: true })
    .click();
  assert.ok(
    (await page.locator("#tabscope-match-navigator").textContent()).includes(
      "Match 4 of 6",
    ),
  );
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("tabscope-active-match")),
    true,
  );
  await page
    .locator("#tabscope-match-navigator")
    .getByRole("button", { name: "Previous", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () =>
        [
          ...CSS.highlights.get("tabscope-active-match"),
        ][0].startContainer.parentElement.closest("p").id,
    ),
    "two",
  );
  await page.keyboard.press("ArrowLeft");
  assert.ok(
    (await page.locator("#tabscope-match-navigator").textContent()).includes(
      "Match 2 of 6",
    ),
  );
  await page.keyboard.press("ArrowRight");
  assert.ok(
    (await page.locator("#tabscope-match-navigator").textContent()).includes(
      "Match 3 of 6",
    ),
  );
  assert.equal(
    await page.evaluate(
      () =>
        [
          ...CSS.highlights.get("tabscope-active-match"),
        ][0].startContainer.parentElement.closest("p").id,
    ),
    "two",
  );
  await page.locator("header").click();
  assert.equal(await page.locator("#tabscope-match-navigator").count(), 0);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#tabscope-match-navigator").count(), 0);
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("tabscope-active-match")),
    false,
  );
  // Chrome's actual per-tab zoom, not CSS zoom or viewport emulation.
  const uiTab = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url),
    ui.url(),
  );
  await ui.setViewportSize({ width: 1280, height: 850 });
  for (const factor of [2, 4]) {
    await worker.evaluate(
      async ({ id, factor }) => chrome.tabs.setZoom(id, factor),
      { id: uiTab.id, factor },
    );
    assert.ok(
      Math.abs(
        (await worker.evaluate((id) => chrome.tabs.getZoom(id), uiTab.id)) -
          factor,
      ) < 0.00001,
    );
    assert.equal(
      await ui.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      await ui
        .getByRole("option")
        .first()
        .evaluate((e) => {
          const r = e.getBoundingClientRect(),
            b = document
              .querySelector(".palette-body-content")
              .getBoundingClientRect();
          return r.height > 0 && r.top < b.bottom && r.bottom > b.top;
        }),
      true,
    );
    await ui.screenshot({
      path: path.join(evidence, `zoom-${factor * 100}.png`),
    });
  }
  await worker.evaluate((id) => chrome.tabs.setZoom(id, 1), uiTab.id);
  // Native PDF viewer state, read through browser automation (not extension code).
  for (const n of [3, 1, 2]) {
    r = await search("orbital ceramic", (r) =>
      r.hits.some((h) => h.pdf && h.pdf.searched === 3),
    );
    pdfHit = r.hits.find((h) => h.pdf);
    const p = pdfHit.passages.find((p) => p.page === n);
    const result = await call({
      type: "navigate",
      id: pdfHit.id,
      query: "orbital ceramic",
      url: pdfHit.url,
      updated: pdfHit.updated,
      passageId: p.id,
    });
    assert.equal(result.page, n);
    await pdf.waitForURL(new RegExp(`keep=yes#page=${n}`));
    let current;
    for (let k = 0; k < 100; k++) {
      for (const frame of pdf.frames()) {
        try {
          const value = await frame.evaluate(() => {
            const v = document.querySelector("pdf-viewer");
            const toolbar = v?.shadowRoot?.querySelector("viewer-toolbar");
            const selector = toolbar?.shadowRoot?.querySelector(
              "viewer-page-selector",
            );
            const input = selector?.shadowRoot?.querySelector("input");
            return input ? Number(input.value) : undefined;
          });
          if (value !== undefined) current = value;
          if (current === n) break;
        } catch {}
      }
      if (current === n) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (current !== n) {
      console.log(
        "PDF frames",
        pdf.frames().map((f) => f.url()),
      );
      for (const f of pdf.frames()) {
        try {
          console.log(
            f.url(),
            await f.evaluate(() => ({
              html: document.documentElement.outerHTML.slice(0, 2000),
              selector: document
                .querySelector("pdf-viewer")
                ?.shadowRoot?.querySelector("viewer-toolbar")
                ?.shadowRoot?.querySelector("viewer-page-selector")?.shadowRoot
                ?.innerHTML,
              toolbar: document
                .querySelector("pdf-viewer")
                ?.shadowRoot?.querySelector("viewer-toolbar")
                ?.shadowRoot?.innerHTML.slice(-10000),
              shadow: document
                .querySelector("pdf-viewer")
                ?.shadowRoot?.innerHTML.slice(0, 3000),
            })),
          );
        } catch (e) {
          console.log(e.message);
        }
      }
      await pdf.screenshot({ path: path.join(evidence, "pdf-debug.png") });
    }
    assert.equal(current, n, "native viewer physical page");
  }
  const columns = await context.newPage();
  await columns.goto(origin + "/columns.pdf").catch(() => {});
  await call({ type: "refresh" });
  const col = await search("connection timeout", (r) =>
    r.hits.some((h) => h.url.includes("columns.pdf")),
  );
  assert.ok(
    col.hits
      .find((h) => h.url.includes("columns.pdf"))
      .passages.every((p) => !p.text.includes("\u0000")),
  );
  assert.equal(
    (await call({ type: "search", query: '"connection timeout"' })).hits.some(
      (h) => h.url.includes("columns.pdf"),
    ),
    false,
  );
  const large = await context.newPage();
  await large.goto(origin + "/large.pdf").catch(() => {});
  await call({ type: "refresh" });
  const partial = await search("orbital ceramic", (r) =>
    r.hits.some((h) => h.pdf?.searched === 40),
  );
  assert.equal(partial.hits.find((h) => h.pdf?.searched === 40).pdf.total, 45);
  const scan = await context.newPage();
  await scan.goto(origin + "/scan.pdf").catch(() => {});
  await call({ type: "refresh" });
  let coverage;
  for (let n = 0; n < 150; n++) {
    coverage = (await call({ type: "search", query: "" })).coverage;
    if (coverage.some((e) => e.detail?.includes("Scanned PDFs"))) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(coverage.some((e) => e.detail?.includes("Scanned PDFs")));
  const bad = await context.newPage();
  await bad.goto(origin + "/bad.pdf").catch(() => {});
  await call({ type: "refresh" });
  for (let n = 0; n < 100; n++) {
    coverage = (await call({ type: "search", query: "" })).coverage;
    if (coverage.some((e) => e.detail?.includes("not a valid PDF"))) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(coverage.some((e) => e.detail?.includes("not a valid PDF")));
  // Restart the real MV3 worker without reloading the extension installation.
  const swCDP = await context.newCDPSession(ui);
  let versions = [];
  swCDP.on(
    "ServiceWorker.workerVersionUpdated",
    (e) => (versions = e.versions),
  );
  await swCDP.send("ServiceWorker.enable");
  for (
    let n = 0;
    n < 100 &&
    !versions.some(
      (v) => v.scriptURL === `chrome-extension://${id}/background.js`,
    );
    n++
  )
    await new Promise((r) => setTimeout(r, 25));
  const version = versions.find(
    (v) => v.scriptURL === `chrome-extension://${id}/background.js`,
  );
  assert.ok(version);
  const probe = await worker.evaluate(
    () => (globalThis.__tabscopeProbe = crypto.randomUUID()),
  );
  const restarted = context
    .waitForEvent("serviceworker", {
      predicate: (w) => w.url().includes(id),
      timeout: 1500,
    })
    .catch(() => undefined);
  await swCDP.send("ServiceWorker.stopWorker", {
    versionId: version.versionId,
  });
  await call({ type: "search", query: "orbital ceramic" });
  const nextWorker = await restarted;
  if (nextWorker) worker = nextWorker;
  let workerRestartVerified = false;
  try {
    workerRestartVerified =
      (await worker.evaluate(() => globalThis.__tabscopeProbe)) !== probe;
  } catch {
    /* Debugger can keep the context alive. */
  }
  console.log("Forced worker restart verified:", workerRestartVerified);
  const restored = await call({ type: "search", query: "orbital ceramic" });
  assert.ok(restored.hits.some((h) => h.pdf?.searched === 40));
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        browser: context.browser().version(),
        passed: true,
        workerRestartVerified,
        limitations: workerRestartVerified
          ? []
          : [
              "CDP did not force a verified MV3 restart with the debugger attached; recovery is covered by integration tests",
            ],
        tests: [
          "repeated split-node jumps",
          "nested scroller",
          "preview input focus and polling preservation",
          "native PDF physical pages 3/1/2 in same tab",
          "suffixless PDF content-type detection",
          "PDF image-only and malformed status",
          "light dark narrow reduced motion",
          "actual Chrome 200% and 400% zoom",
          "synthetic whitespace column boundaries in real PDF extraction",
          "40 of 45 physical page cap",
        ],
      },
      null,
      2,
    ),
  );
  console.log("PASS: passages and native PDF page jumps");
} finally {
  await context.close();
  server.close();
}
