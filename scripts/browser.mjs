import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const evidence = path.resolve(process.env.TABSCOPE_EVIDENCE || "work/browser");
await mkdir(evidence, { recursive: true });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><html><head><title>${req.url === "/a" ? "Materials notebook" : "Other page"}</title></head><body style="font:18px system-ui;padding:40px"><input id="prior" placeholder="prior focus"><h1>Materials notebook</h1><p>Fixture page for TabScope testing.</p><div style="height:1400px"></div><article id="passage">The orbital <b>ceramic</b> engine requires careful thermal management across distant research stations.${req.url.startsWith("/bench/") ? " Materials science examines lattice structures, experimental methods and mechanical properties.".repeat(210) : ""}</article><div hidden>hidden-supersecret</div><textarea>form-supersecret</textarea></body></html>`,
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "tabscope-test-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath:
      process.env.TABSCOPE_CHROME ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: process.env.TABSCOPE_HEADED !== "1",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
    viewport: { width: 1100, height: 850 },
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const loaded = await cdp.send("Extensions.loadUnpacked", {
    path: path.resolve("dist"),
  });
  console.log("Loaded", loaded);
  const id = loaded.id;
  assert.ok(id);
  const debug = await context.newPage();
  await debug.goto("chrome://extensions");
  console.log(
    "Manifest warnings",
    await debug.evaluate(async () =>
      (
        await chrome.developerPrivate.getExtensionsInfo({
          includeDisabled: true,
          includeTerminated: true,
        })
      ).map((e) => ({
        state: e.state,
        warnings: e.installWarnings,
        errors: e.manifestErrors,
      })),
    ),
  );
  await debug.close();
  const page = await context.newPage();
  await page.goto(origin + "/a");
  const second = await context.newPage();
  await second.goto(origin + "/b");
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/palette.html`);
  let worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  const call = (message) =>
    ui.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const untilHits = async (query, count) => {
    let result;
    for (let n = 0; n < 150; n++) {
      result = await call({ type: "search", query });
      if (result.hits.length === count) return result;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(result.hits.length, count);
  };
  const permissions = await worker.evaluate(
    async () => await chrome.permissions.getAll(),
  );
  console.log("Initial permissions", permissions);
  let result = await call({ type: "search", query: "orbital ceramic" });
  assert.equal(result.hits.length, 0);
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  await ui
    .getByRole("textbox", { name: "Website hostname for access" })
    .fill("127.0.0.1");
  await ui
    .getByRole("button", { name: "Allow this site", exact: true })
    .click();
  console.log(
    "Awaiting Chrome site-permission approval in the disposable test profile",
  );
  for (let attempt = 0; attempt < 1200; attempt++) {
    if (
      await worker.evaluate(() =>
        chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] }),
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    await worker.evaluate(() =>
      chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] }),
    ),
    true,
  );
  await ui
    .getByRole("button", { name: "← Back to search", exact: true })
    .click();
  await call({ type: "refresh" });
  for (let n = 0; n < 100; n++) {
    result = await call({ type: "search", query: "orbital ceramic" });
    if (result.hits.length === 2) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(result.hits.length, 2);
  assert.ok(result.hits[0].snippet.includes("orbital ceramic"));
  await ui.getByRole("combobox").fill("orbital ceramic");
  await ui.getByRole("option").first().waitFor();
  await ui.screenshot({ path: path.join(evidence, "light.png") });
  await ui.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await ui.screenshot({ path: path.join(evidence, "dark.png") });
  await ui.setViewportSize({ width: 360, height: 640 });
  await ui.screenshot({ path: path.join(evidence, "narrow.png") });
  assert.equal(
    await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await ui.setViewportSize({ width: 1100, height: 850 });
  const tab = await worker.evaluate(
    async (u) => (await chrome.tabs.query({})).find((t) => t.url === u),
    origin + "/a",
  );
  const nav = await call({
    type: "navigate",
    id: tab.id,
    query: "orbital ceramic",
  });
  assert.equal(nav.activated, true);
  assert.equal(nav.warning, undefined);
  assert.ok(await page.evaluate(() => CSS.highlights.has("tabscope-match")));
  assert.ok(await page.evaluate(() => scrollY > 500));
  await page.locator("#prior").focus();
  const tabTargets = await cdp.send("Target.getTargets", {
    filter: [{ type: "tab" }, { exclude: true }],
  });
  const target = tabTargets.targetInfos.find(
    (t) => t.url === page.url(),
  )?.targetId;
  console.log(
    "Action targets",
    tabTargets.targetInfos.map((t) => ({ type: t.type, url: t.url })),
  );
  assert.ok(target);
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  await page.locator("#tabscope-root").waitFor();
  assert.equal(await page.locator("#tabscope-root").count(), 1);
  const frame = page.frameLocator("#tabscope-root iframe");
  await frame.getByRole("combobox").fill("ceramic orbital");
  await frame.getByRole("option").first().waitFor();
  await page.screenshot({ path: path.join(evidence, "overlay.png") });
  await frame.getByRole("combobox").press("ArrowDown");
  assert.equal(await frame.getByRole("option", { selected: true }).count(), 1);
  await frame.getByRole("combobox").press("Escape");
  await page.locator("#tabscope-root").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.id), "prior");
  await page.keyboard.press(
    process.platform === "darwin" ? "Control+Space" : "Control+Shift+Space",
  );
  let commandVerified = false;
  try {
    await page.locator("#tabscope-root").waitFor({ timeout: 1500 });
    commandVerified = true;
    await frame.getByRole("combobox").press("Escape");
  } catch {}
  console.log("Command via browser keyboard event", commandVerified);
  // Content agents must not receive search results.
  const unauthorized = await worker.evaluate(
    async (id) =>
      (
        await chrome.scripting.executeScript({
          target: { tabId: id },
          func: () => chrome.runtime.sendMessage({ type: "search", query: "" }),
        })
      )[0].result,
    tab.id,
  );
  assert.equal(unauthorized.error, "Unauthorized request");
  await page
    .locator("#passage")
    .evaluate((e) =>
      e.append(document.createTextNode(" Updated quasar observation.")),
    );
  await untilHits("updated quasar", 1);
  // Restricted-page invocation must open a separate extension-owned popup.
  const restricted = await context.newPage();
  await restricted.goto("chrome://version");
  const restrictedTarget = (
    await cdp.send("Target.getTargets", {
      filter: [{ type: "tab" }, { exclude: true }],
    })
  ).targetInfos.find((t) => t.url === restricted.url())?.targetId;
  assert.ok(restrictedTarget);
  const fallbackPromise = context.waitForEvent("page");
  await cdp.send("Extensions.triggerAction", {
    id,
    targetId: restrictedTarget,
  });
  const fallback = await fallbackPromise;
  await fallback.waitForLoadState();
  assert.ok(fallback.url().startsWith(`chrome-extension://${id}/palette.html`));
  assert.equal(await fallback.getByRole("combobox").count(), 1);
  assert.equal(
    (await fallback.evaluate(() => chrome.windows.getCurrent())).type,
    "popup",
  );
  await fallback.screenshot({ path: path.join(evidence, "fallback.png") });
  await fallback.close();
  await restricted.close();
  // Move the other fixture to a second normal window and activate it there.
  const secondTab = await worker.evaluate(
    async (u) => (await chrome.tabs.query({})).find((t) => t.url === u),
    origin + "/b",
  );
  const otherWindow = await worker.evaluate(
    async (tabId) => chrome.windows.create({ tabId }),
    secondTab.id,
  );
  const crossNav = await call({
    type: "navigate",
    id: secondTab.id,
    query: "ceramic orbital",
  });
  assert.equal(crossNav.warning, undefined);
  assert.equal(
    (await worker.evaluate(async () => chrome.windows.getLastFocused())).id,
    otherWindow.id,
  );
  assert.equal(
    await second.evaluate(() => CSS.highlights.has("tabscope-match")),
    true,
  );
  // Discarded tabs lose body coverage; querying does not wake them.
  await call({ type: "navigate", id: tab.id, query: "" });
  await worker.evaluate(
    async (id) => chrome.tabs.update(id, { active: true }),
    tab.id,
  );
  // Make a non-target blank tab active in the other window so its fixture can be discarded.
  await worker.evaluate(
    async (windowId) =>
      chrome.tabs.create({ windowId, url: "about:blank", active: true }),
    otherWindow.id,
  );
  const discarded = await worker.evaluate(
    async (id) => chrome.tabs.discard(id),
    secondTab.id,
  );
  assert.equal(
    (await call({ type: "search", query: "ceramic" })).hits.length,
    1,
  );
  assert.equal(
    (await worker.evaluate(async (id) => chrome.tabs.get(id), discarded.id))
      .discarded,
    true,
  );
  await worker.evaluate(
    async (id) => chrome.tabs.update(id, { active: true }),
    discarded.id,
  );
  await untilHits("ceramic", 2);
  // Stop the worker without reloading the extension, then recover session records.
  const swCDP = await context.newCDPSession(ui);
  let versions = [];
  swCDP.on("ServiceWorker.workerVersionUpdated", (e) => {
    versions = e.versions;
  });
  await swCDP.send("ServiceWorker.enable");
  for (
    let n = 0;
    n < 100 &&
    !versions.some(
      (v) => v.scriptURL === `chrome-extension://${id}/background.js`,
    );
    n++
  )
    await new Promise((r) => setTimeout(r, 50));
  const version = versions.find(
    (v) => v.scriptURL === `chrome-extension://${id}/background.js`,
  );
  assert.ok(version);
  const probe = await worker.evaluate(
    () => (globalThis.__tabscopeProbe = crypto.randomUUID()),
  );
  await swCDP.send("ServiceWorker.stopWorker", {
    versionId: version.versionId,
  });
  await untilHits("ceramic", 2);
  worker =
    context
      .serviceWorkers()
      .find((w) => w.url() === `chrome-extension://${id}/background.js`) ??
    worker;
  let workerRestartVerified = false;
  try {
    workerRestartVerified =
      (await worker.evaluate(() => globalThis.__tabscopeProbe)) !== probe;
  } catch {}
  console.log("Forced worker restart verified", workerRestartVerified);
  await call({ type: "save", theme: "system", exclusions: ["127.0.0.1"] });
  assert.equal(
    (await call({ type: "search", query: "ceramic" })).hits.length,
    0,
  );
  await call({ type: "save", theme: "system", exclusions: [] });
  await call({ type: "refresh" });
  await untilHits("ceramic", 2);
  await call({ type: "clear" });
  await call({ type: "refresh" });
  assert.equal(
    (await call({ type: "search", query: "ceramic" })).hits.length,
    0,
  );
  assert.equal((await call({ type: "settings" })).paused, true);
  await call({ type: "resume" });
  await untilHits("ceramic", 2);
  await worker.evaluate(async (id) => chrome.tabs.remove(id), discarded.id);
  assert.equal(
    (await call({ type: "search", query: "ceramic" })).hits.length,
    1,
  );
  await page.goto(origin + "/changed");
  assert.equal(
    (await call({ type: "search", query: "hidden-supersecret" })).hits.length,
    0,
  );
  const benchPages = [page];
  const metrics = [];
  if (process.env.TABSCOPE_LOAD_TEST === "1")
    for (const count of [5, 20, 50, 105]) {
      const start = performance.now();
      while (benchPages.length < count) {
        const p = await context.newPage();
        await p.goto(origin + "/bench/" + benchPages.length);
        benchPages.push(p);
      }
      await call({ type: "refresh" });
      let coverage;
      for (let n = 0; n < 1200; n++) {
        coverage = await call({ type: "search", query: "ceramic orbital" });
        if (
          coverage.indexing === 0 &&
          coverage.searchable >= Math.min(count, 95)
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(coverage.searchable >= Math.min(count, 95));
      const initializationMs = performance.now() - start;
      const samples = [];
      for (let n = 0; n < 30; n++) {
        const start = performance.now();
        await call({
          type: "search",
          query: n % 2 ? "ceramic orbital" : "thermal management",
        });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const stored = await worker.evaluate(async () => {
        const s = await chrome.storage.session.get("records");
        return s.records.reduce((n, r) => n + r.text.length, 0);
      });
      metrics.push({
        tabs: count,
        chars: stored,
        indexed: coverage.searchable,
        repetitions: samples.length,
        initializationMs: Math.round(initializationMs),
        warmRoundtripP50: Number(samples[15].toFixed(2)),
        warmRoundtripP95: Number(samples[28].toFixed(2)),
      });
      console.log("Browser benchmark", metrics.at(-1));
    }
  await writeFile(
    path.join(evidence, "benchmark.json"),
    JSON.stringify(metrics, null, 2),
  );
  await worker.evaluate(
    async (o) =>
      chrome.permissions.remove({
        origins: [new URL(o).protocol + "//" + new URL(o).hostname + "/*"],
      }),
    origin,
  );
  assert.equal(
    (await call({ type: "search", query: "ceramic" })).hits.length,
    0,
  );
  console.log(
    "PASS Chrome extraction/search/highlight/overlay/focus/exclusion/clear/resume/closure/revocation",
  );
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        browser: await context.browser().version(),
        passed: true,
        commandVerified,
        workerRestartVerified,
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close();
  server.close();
}
