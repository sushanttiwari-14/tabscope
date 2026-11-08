// Real worker/renderer integration. A disposable manifest grants ONLY the local
// fixture host at installation; this does not exercise Chrome's native prompt.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, cp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(path.join(os.tmpdir(), "tabscope-features-"));
const evidence = path.resolve(
  process.env.TABSCOPE_EVIDENCE || "work/features-browser",
);
await mkdir(evidence, { recursive: true });
await cp("dist", path.join(temp, "extension"), { recursive: true });
const manifestPath = path.join(temp, "extension", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = ["http://127.0.0.1/*"];
await writeFile(manifestPath, JSON.stringify(manifest));
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><title>${req.url === "/metadata" ? "Event horizon reference" : "Observatory notes"}</title><body><input id="prior"><nav>event menu</nav><p>${"navigation filler ".repeat(100)}</p><article>${req.url === "/metadata" ? "Unrelated body" : "The event <b>horizon</b> reveals a café and café boundary."}</article></body>`,
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
  const a = await context.newPage();
  await a.goto(origin + "/body");
  const metadata = await context.newPage();
  await metadata.goto(origin + "/metadata");
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/palette.html`);
  await ui.evaluate(() =>
    chrome.storage.local.set({ contentAccessExplained: true }),
  );
  await ui.reload();
  const call = (m) => ui.evaluate((m) => chrome.runtime.sendMessage(m), m);
  const worker = context.serviceWorkers()[0];
  const tab = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url),
    a.url(),
  );
  await call({ type: "refresh" });
  let result;
  for (let n = 0; n < 100; n++) {
    result = await call({ type: "search", query: "event horizon" });
    if (
      result.hits.some(
        (h) => h.id === tab.id && h.snippet.includes("event horizon"),
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const body = result.hits.find((h) => h.id === tab.id);
  assert.ok(body?.snippet.includes("event horizon"));
  assert.ok(!body.snippet.includes("menu"));
  const pageOnly = await call({
    type: "search",
    query: "event horizon",
    filters: { pageText: true, domain: "127.0.0.1" },
  });
  assert.equal(pageOnly.hits.length, 1);
  const fuzzy = await call({
    type: "search",
    query: "evant horizon",
    filters: { pageText: true },
  });
  assert.equal(fuzzy.hits[0].id, tab.id);
  assert.equal(fuzzy.hits[0].approximate, true);
  // Real-response UX regression checks: no synthetic search renderer data.
  const capture = async (name) => {
    await ui.locator("dialog").evaluate(async (dialog) => {
      await Promise.all(
        dialog
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await ui.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await ui.screenshot({ path: path.join(evidence, name + ".png") });
    const bounds = await ui.locator("dialog").boundingBox();
    if (bounds)
      await ui.screenshot({
        path: path.join(evidence, name + "-detail.png"),
        clip: {
          x: Math.max(0, bounds.x - 24),
          y: Math.max(0, bounds.y - 24),
          width: Math.min(
            1000,
            bounds.width + 48,
            (await ui.evaluate(() => innerWidth)) - Math.max(0, bounds.x - 24),
          ),
          height: Math.min(
            bounds.height + 48,
            (await ui.evaluate(() => innerHeight)) - Math.max(0, bounds.y - 24),
          ),
        },
      });
  };
  await ui.setViewportSize({ width: 1000, height: 820 });
  await ui.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  assert.equal(
    await ui
      .getByRole("region", { name: "Search filters", exact: true })
      .isVisible(),
    false,
  );
  assert.equal(await ui.locator(".active-filters").isVisible(), false);
  await ui.getByRole("combobox").fill("event horizon");
  await ui
    .getByRole("option")
    .filter({ hasText: "Observatory notes" })
    .locator(".snippet")
    .waitFor();
  await capture("search-light");
  await ui.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await capture("search-dark");
  await ui.getByRole("button", { name: "Clear search", exact: true }).click();
  await ui.getByText("Recent tabs", { exact: true }).waitFor();
  assert.equal(await ui.getByRole("combobox").inputValue(), "");
  assert.equal(await ui.locator(".snippet").count(), 0);
  await capture("recent-dark");

  await ui.getByRole("combobox").fill("event horizon");
  await ui.getByRole("button", { name: "Filters", exact: true }).click();
  assert.equal(
    await ui
      .getByRole("checkbox", { name: "Exact host", exact: true })
      .isEnabled(),
    false,
  );
  await ui.getByRole("checkbox", { name: "Page text", exact: true }).check();
  await ui.getByRole("checkbox", { name: "This window", exact: true }).check();
  await ui
    .getByRole("textbox", { name: /Website hostname \(includes/ })
    .fill("127.0.0.1");
  await ui.waitForFunction(
    () =>
      document.querySelectorAll("[role=option]").length === 1 &&
      document.querySelectorAll(".filter-chip").length === 3,
  );
  await capture("filters-dark");
  await ui.setViewportSize({ width: 390, height: 720 });
  await capture("filters-narrow");
  assert.equal(
    await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await ui.keyboard.press("Escape");
  assert.equal(
    await ui
      .getByRole("region", { name: "Search filters", exact: true })
      .isVisible(),
    false,
  );
  assert.equal(
    await ui
      .getByRole("button", { name: "Filters", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(await ui.getByRole("combobox").inputValue(), "event horizon");
  await ui
    .getByRole("button", { name: "Remove Page text filter", exact: true })
    .click();
  await ui.waitForFunction(
    () => document.querySelectorAll("[role=option]").length === 2,
  );
  assert.equal(await ui.getByRole("combobox").inputValue(), "event horizon");
  await ui.getByRole("button", { name: "Clear filters", exact: true }).click();
  await ui.waitForFunction(
    () => document.querySelector(".active-filters").hidden,
  );
  // Native dialog focus stays contained through keyboard traversal.
  for (let step = 0; step < 16; step++) {
    await ui.keyboard.press(step < 8 ? "Tab" : "Shift+Tab");
    assert.equal(
      await ui.evaluate(() =>
        document.querySelector("dialog").contains(document.activeElement),
      ),
      true,
    );
  }
  await ui.setViewportSize({ width: 1000, height: 820 });
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  await ui.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(
    await ui
      .getByRole("button", { name: "Allow all websites", exact: true })
      .isVisible(),
    false,
  );
  await capture("settings-dark");
  await ui.getByText("Excluded sites", { exact: true }).click();
  await ui
    .getByRole("textbox", { name: "Excluded sites", exact: true })
    .fill("excluded.example.test");
  await ui
    .getByRole("button", { name: "Save excluded sites", exact: true })
    .click();
  await ui.getByText("Excluded sites saved.", { exact: true }).waitFor();
  await ui.getByLabel("Appearance", { exact: true }).selectOption("light");
  await ui.getByText("Appearance updated.", { exact: true }).waitFor();
  assert.deepEqual((await call({ type: "settings" })).exclusions, [
    "excluded.example.test",
  ]);
  await capture("settings-light");
  await ui
    .getByRole("textbox", { name: "Excluded sites", exact: true })
    .fill("");
  await ui
    .getByRole("button", { name: "Save excluded sites", exact: true })
    .click();
  await ui.getByText("Excluded sites saved.", { exact: true }).waitFor();
  await ui.getByLabel("Appearance", { exact: true }).selectOption("system");
  await ui.getByText("Appearance updated.", { exact: true }).waitFor();
  await ui
    .getByRole("button", { name: "← Back to search", exact: true })
    .click();
  assert.equal(await ui.getByRole("combobox").inputValue(), "event horizon");
  // Actual navigation and CSS Highlight range in a split-node passage.
  assert.equal(
    (
      await call({
        type: "navigate",
        id: tab.id,
        query: "event horizon",
        url: body.url,
        updated: body.updated,
      })
    ).activated,
    true,
  );
  await a.waitForFunction(() => CSS.highlights.has("tabscope-match"));
  assert.ok(
    (
      await a.evaluate(() =>
        [...CSS.highlights.get("tabscope-match")][0].toString(),
      )
    ).includes("event horizon"),
  );
  // Changed passage: activation still succeeds and feedback lives at destination.
  await a.locator("article").evaluate((e) => {
    e.textContent = "This passage was replaced.";
  });
  assert.equal(
    (
      await call({
        type: "navigate",
        id: tab.id,
        query: "event horizon",
        url: body.url,
        updated: body.updated,
      })
    ).activated,
    true,
  );
  await a.locator("#tabscope-notice").waitFor();
  assert.ok(
    (await a.locator("#tabscope-notice").textContent()).includes(
      "could not be located",
    ),
  );
  await a.locator("#tabscope-notice button").click();
  // Combined filtering + fallback origin-window association across real windows.
  const otherWindow = await worker.evaluate(async () => {
    const w = await chrome.windows.create({
      url: "about:blank",
      type: "normal",
    });
    return w.id;
  });
  await ui.goto(`chrome-extension://${id}/palette.html?window=${tab.windowId}`);
  const allowedIds = await worker.evaluate(
    async (windowId) =>
      (await chrome.tabs.query({ windowId })).map((t) => t.id),
    tab.windowId,
  );
  assert.ok(
    (
      await call({ type: "search", query: "", filters: { thisWindow: true } })
    ).hits.every((h) => allowedIds.includes(h.id)),
  );
  await ui.goto(`chrome-extension://${id}/palette.html?window=${otherWindow}`);
  assert.equal(
    (
      await call({
        type: "search",
        query: "event",
        filters: { thisWindow: true },
      })
    ).hits.length,
    0,
  );
  // Coverage explanation and controls use genuine worker state.
  await call({ type: "save", theme: "dark", exclusions: ["127.0.0.1"] });
  result = await call({ type: "search", query: "" });
  assert.ok(
    result.coverage.some((e) => e.id === tab.id && e.reason === "excluded"),
  );
  await ui.getByRole("button", { name: /Page text/ }).click();
  await ui
    .getByRole("button", { name: "Include this site", exact: true })
    .first()
    .waitFor();
  await call({ type: "clear" });
  assert.equal(
    (await call({ type: "search", query: "Event horizon" })).hits.length,
    1,
  );
  assert.ok(
    (await call({ type: "search", query: "" })).coverage.every(
      (e) => e.reason === "paused",
    ),
  );
  await ui.getByRole("combobox").fill("event");
  await ui.waitForFunction(
    () => document.querySelector(".coverage").textContent === "Indexing paused",
  );
  await ui
    .getByRole("button", { name: "Resume indexing", exact: true })
    .waitFor();
  await ui.setViewportSize({ width: 360, height: 640 });
  await ui.getByRole("button", { name: "Filters", exact: true }).click();
  await ui
    .getByRole("textbox", { name: /Website hostname \(includes/ })
    .fill("bad/path");
  await ui.getByText("No tabs match these filters", { exact: true }).waitFor();
  await ui
    .getByRole("button", { name: "Clear filters", exact: true })
    .last()
    .click();
  assert.equal(
    await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await ui.screenshot({ path: path.join(evidence, "coverage-narrow.png") });
  const targetFor = async (url) =>
    (
      await cdp.send("Target.getTargets", {
        filter: [{ type: "tab" }, { exclude: true }],
      })
    ).targetInfos.find((t) => t.url === url).targetId;
  const originalTarget = await targetFor(a.url());
  await Promise.all(
    Array.from({ length: 3 }, () =>
      cdp.send("Extensions.triggerAction", { id, targetId: originalTarget }),
    ),
  );
  const searchFrame = a.frameLocator("#tabscope-root iframe");
  await searchFrame.getByRole("combobox").fill("preserved query");
  await cdp.send("Extensions.triggerAction", { id, targetId: originalTarget });
  assert.equal(
    await searchFrame.getByRole("combobox").inputValue(),
    "preserved query",
  );
  assert.equal(await a.locator("#tabscope-root").count(), 1);
  await searchFrame.getByRole("combobox").press("Escape");
  await a.locator("#tabscope-root").waitFor({ state: "detached" });
  await a.goto("chrome://version");
  await call({
    type: "navigate",
    id: tab.id,
    query: "event horizon",
    url: body.url,
    updated: body.updated,
  });
  assert.equal(
    await worker.evaluate(
      (tabId) => chrome.action.getBadgeText({ tabId }),
      tab.id,
    ),
    "!",
  );
  assert.ok(
    (
      await worker.evaluate(
        (tabId) => chrome.action.getTitle({ tabId }),
        tab.id,
      )
    ).includes("original passage"),
  );
  // Fault injection: production JS with an intentionally initializer-free overlay
  // shell in a SECOND disposable installation. No shipping file is changed.
  const brokenDir = path.join(temp, "broken-extension");
  await cp(path.join(temp, "extension"), brokenDir, { recursive: true });
  await writeFile(
    path.join(brokenDir, "overlay.html"),
    "<!doctype html><title>Unready test shell</title>",
  );
  const { id: brokenId } = await cdp.send("Extensions.loadUnpacked", {
    path: brokenDir,
  });
  const brokenWorker =
    context.serviceWorkers().find((w) => w.url().includes(brokenId)) ??
    (await context.waitForEvent("serviceworker", {
      predicate: (w) => w.url().includes(brokenId),
    }));
  await brokenWorker.evaluate(() => chrome.runtime.id);
  // Restricted pages and a shell that never initializes both use one popup.
  const blocked = await context.newPage();
  await blocked.goto(origin + "/blocked");
  const blockedTarget = await targetFor(blocked.url());
  await cdp.send("Extensions.triggerAction", {
    id: brokenId,
    targetId: blockedTarget,
  });
  let popups = [];
  for (let n = 0; n < 160; n++) {
    popups = await worker.evaluate(async () =>
      (
        await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] })
      ).filter((w) => w.tabs?.some((t) => t.url?.includes("/palette.html"))),
    );
    if (popups.length) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(popups.length, 1);
  await blocked.locator("#tabscope-root").waitFor({ state: "detached" });
  const restrictedPage = await context.newPage();
  await restrictedPage.goto("chrome://version");
  await cdp.send("Extensions.triggerAction", {
    id: brokenId,
    targetId: await targetFor(restrictedPage.url()),
  });
  await new Promise((r) => setTimeout(r, 100));
  popups = await worker.evaluate(async () =>
    (
      await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] })
    ).filter((w) => w.tabs?.some((t) => t.url?.includes("/palette.html"))),
  );
  assert.equal(popups.length, 1);
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        browser: context.browser().version(),
        passed: true,
        fixtureHostGrantedAtInstall: true,
        nativePermissionPromptTested: false,
        features: [
          "source passage",
          "split-node highlight",
          "destination notice",
          "restricted-destination badge/title",
          "page-text/domain filters",
          "typo recovery",
          "cross-window fallback filtering",
          "excluded/paused coverage",
          "narrow layout",
          "filter chips and Escape dismissal",
          "clear query and recent-state hierarchy",
          "dialog keyboard focus containment",
          "grouped settings and immediate theme persistence",
          "weak body evidence suppressed for complete title matches",
          "rapid invocation/query preservation",
          "initializer-free shell timeout cleanup",
          "restricted singleton fallback",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: real body search, passage/highlight, destination feedback, fuzzy/combined filters, fallback window scope, recovery UI, narrow layout, rapid invocation, unready-shell cleanup and restricted fallback (fixture-only install grant; native prompts untested)",
  );
} finally {
  await context.close();
  server.close();
}
