import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const evidence = path.resolve(
  process.env.TABSCOPE_EVIDENCE || "work/overlay-browser",
);
await mkdir(evidence, { recursive: true });
const server = createServer((req, res) => {
  if (req.url === "/fixture.css") {
    res.setHeader("content-type", "text/css");
    res.end(
      `*{box-sizing:border-box}body{margin:0;background:#f0e8d9;color:#25363c;font:17px/1.7 system-ui}header{padding:32px 48px;background:#365f67;color:#fff}main{display:flex;gap:40px;max-width:1000px;margin:48px auto;padding:0 32px}aside{width:210px;flex:none;padding:24px;background:#d3e1d8;border-radius:12px}article{flex:1}h1{font-size:32px;margin:0}h2{font-size:22px}p{margin-bottom:28px}.tile{height:160px;margin:24px 0;background:#cbb89a;border-radius:12px}@media(prefers-color-scheme:dark){body{background:#263432;color:#e4ede4}header{background:#365f67}aside{background:#3b5048}.tile{background:#88775e}}`,
    );
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'self'; frame-src chrome-extension:; form-action 'none'",
  );
  res.end(
    '<!doctype html><html lang="en"><head><title>Fixture · Field notes</title><link rel="stylesheet" href="/fixture.css"></head><body><header><h1 id="prior" tabindex="-1">Field notes</h1><span>A small collection of observations</span></header><main><aside><b>Notebook</b><p>Observations<br>Research<br>References<br>Reading list</p></aside><article><h2>Finding patterns in everyday places</h2><p>The city changes gradually. Familiar streets, quiet courtyards and the spaces between buildings tell a story when we take time to look.</p><div class="tile"></div><h2>Keep the page in view</h2><p>This public synthetic fixture should remain visible beneath the floating search palette. Its layout and colors should be dimmed and gently blurred, never replaced by an opaque canvas.</p><p>Return to your reading as soon as the search is dismissed.</p></article></main></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.join(os.tmpdir(), "tabscope-overlay-")),
  {
    executablePath:
      process.env.TABSCOPE_CHROME ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
    viewport: { width: 1100, height: 850 },
  },
);
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", {
    path: path.resolve("dist"),
  });
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${id}/palette.html`);
  await setup.evaluate(() =>
    chrome.storage.local.set({ contentAccessExplained: true }),
  );
  await setup.close();
  const page = await context.newPage();
  await page.goto(origin + "/notes");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.__outsideClicks = 0;
    document.addEventListener("click", () => {
      window.__outsideClicks++;
    });
    document.querySelector("#prior").focus();
  });
  const priorURL = page.url(),
    tabsBefore = context.pages().length;
  const target = (
    await cdp.send("Target.getTargets", {
      filter: [{ type: "tab" }, { exclude: true }],
    })
  ).targetInfos.find((t) => t.url === page.url()).targetId;
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  const frame = page.frameLocator("#tabscope-root iframe");
  await frame.getByRole("combobox").waitFor();
  assert.equal(page.url(), priorURL);
  assert.equal(context.pages().length, tabsBefore);
  const view = page
    .frames()
    .find((f) => f.url() === `chrome-extension://${id}/overlay.html`);
  assert.ok(view);
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const canvas = await view.evaluate(() => ({
      root: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      surface: getComputedStyle(document.querySelector("dialog"))
        .backgroundColor,
    }));
    assert.equal(canvas.root, "rgba(0, 0, 0, 0)");
    assert.equal(canvas.body, "rgba(0, 0, 0, 0)");
    assert.equal(canvas.scheme, "normal");
    assert.notEqual(canvas.surface, "rgba(0, 0, 0, 0)");
    const backdrop = await page.locator("#tabscope-root").evaluate((e) => ({
      blur: getComputedStyle(e).backdropFilter,
      background: getComputedStyle(e).backgroundColor,
    }));
    assert.equal(backdrop.blur, "blur(6px)");
    assert.equal(backdrop.background, "rgba(0, 0, 0, 0.35)");
    await frame.getByRole("combobox").fill("Fixture");
    await frame.getByRole("option").first().waitFor();
    await page.screenshot({
      path: path.join(evidence, `overlay-${theme}.png`),
    });
  }
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  assert.equal(await page.locator("#tabscope-root").count(), 1);
  await frame.getByRole("combobox").click();
  assert.equal(await page.locator("#tabscope-root").count(), 1);
  const box = await frame.getByRole("combobox").boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(24, 24, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator("#tabscope-root").count(), 1);
  await frame.getByRole("button", { name: "Settings", exact: true }).click();
  await frame
    .getByRole("button", { name: "← Back to search", exact: true })
    .waitFor();
  await page.mouse.click(24, 24);
  await page.locator("#tabscope-root").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement.id), "prior");
  assert.equal(await page.evaluate(() => window.__outsideClicks), 0);
  // The same backdrop action also dismisses the ordinary search view.
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  await frame.getByRole("combobox").waitFor();
  await page.mouse.click(24, 24);
  await page.locator("#tabscope-root").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement.id), "prior");
  assert.equal(await page.evaluate(() => window.__outsideClicks), 0);
  // Escape remains supported after reopening.
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  await frame.getByRole("combobox").waitFor();
  await frame.getByRole("combobox").press("Escape");
  await page.locator("#tabscope-root").waitFor({ state: "detached" });
  assert.equal(page.url(), priorURL);
  await page.screenshot({ path: path.join(evidence, "page-restored.png") });
  await writeFile(
    path.join(evidence, "overlay-result.json"),
    JSON.stringify(
      {
        browser: context.browser().version(),
        passed: true,
        modes: ["light", "dark"],
        transparentRootAndBody: true,
        hostCSP: true,
        blur: "6px",
        dimming: 0.35,
        noNavigationOrNewTab: true,
        reinvocationReusesPalette: true,
        escapeRestoresPage: true,
        outsideClickDismissesSearchAndSettings: true,
        insideClickAndDragDoNotDismiss: true,
        backdropDoesNotClickThrough: true,
        outsideDismissRestoresFocus: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: transparent light/dark iframe, visible dimmed/blurred page, host CSP, no new tab/navigation, reinvocation, outside-click dismissal/focus, no click-through, inside/drag safety and Escape",
  );
} finally {
  await context.close();
  server.close();
}
