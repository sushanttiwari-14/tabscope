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
      `body[inert]> *{visibility:hidden}*{box-sizing:border-box}body{margin:0;background:#f0e8d9;color:#25363c;font:17px/1.7 system-ui}header{padding:32px 48px;background:#365f67;color:#fff}main{display:flex;gap:40px;max-width:1000px;margin:48px auto;padding:0 32px}aside{width:210px;flex:none;padding:24px;background:#d3e1d8;border-radius:12px}article{flex:1}h1{font-size:32px;margin:0}h2{font-size:22px}p{margin-bottom:28px}.tile{height:160px;margin:24px 0;background:#cbb89a;border-radius:12px}@media(prefers-color-scheme:dark){body{background:#263432;color:#e4ede4}header{background:#365f67}aside{background:#3b5048}.tile{background:#88775e}}`,
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
    .find((f) => f.url().startsWith(`chrome-extension://${id}/overlay.html?`));
  assert.ok(view);
  // Spotlight behavior: idle is one field; typing grows down from that anchor.
  const settle = async () => {
    await view.locator("dialog").evaluate(async (dialog) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await Promise.all(
        dialog
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  };
  await settle();
  assert.equal(await frame.getByRole("option").count(), 0);
  assert.equal(await frame.locator("footer").isVisible(), false);
  assert.equal(
    await frame.getByRole("combobox").getAttribute("aria-expanded"),
    "false",
  );
  const compact = await frame.locator("dialog").boundingBox();
  const field = await frame.getByRole("combobox").boundingBox();
  // Model chat editors that refocus themselves after the extension opens.
  // Use real keyboard input: locator.fill() would hide a broken focus handoff.
  await page.evaluate(() => {
    const editor = document.createElement("div");
    editor.id = "chat-editor";
    editor.contentEditable = "true";
    document.body.append(editor);
    editor.focus();
  });
  await page.keyboard.type("focus-check");
  assert.equal(await frame.getByRole("combobox").inputValue(), "focus-check");
  assert.equal(await page.locator("#chat-editor").textContent(), "");
  assert.equal(await page.evaluate(() => document.body.inert), false);
  assert.equal(await page.locator("main").evaluate((e) => e.inert), true);
  assert.equal(
    await page
      .locator("article")
      .evaluate((e) => getComputedStyle(e).visibility),
    "visible",
  );
  await frame.getByRole("combobox").fill("");
  // A delayed page focus request must also leave an intentional filter focus
  // intact, rather than continually forcing the search field.
  await frame.getByRole("button", { name: "Filters", exact: true }).focus();
  await page.evaluate(() => document.querySelector("#chat-editor").focus());
  assert.equal(
    await frame
      .getByRole("button", { name: "Filters", exact: true })
      .evaluate((button) => document.activeElement === button),
    true,
  );
  await frame.getByRole("combobox").focus();
  // Refocusing the iframe alone is insufficient when its document has lost
  // the input caret. A repeated invocation must focus the real search input.
  await frame.getByRole("combobox").evaluate((input) => input.blur());
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  await view.waitForFunction(
    () => document.activeElement?.getAttribute("role") === "combobox",
  );
  await page.keyboard.type("caret-check");
  assert.equal(await frame.getByRole("combobox").inputValue(), "caret-check");
  await frame.getByRole("combobox").fill("");
  await page.screenshot({ path: path.join(evidence, "spotlight-compact.png") });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await frame.getByRole("combobox").fill("Fixture");
  await frame.getByRole("option").first().waitFor();
  await settle();
  const expanded = await frame.locator("dialog").boundingBox();
  const expandedField = await frame.getByRole("combobox").boundingBox();
  assert.ok(expanded.height > compact.height + 50);
  assert.ok(Math.abs(expandedField.y - field.y) < 1);
  assert.ok(Math.abs(expanded.y - compact.y) < 1);
  assert.equal(
    await frame.getByRole("combobox").getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(
    await frame.locator(".palette-body").evaluate((body) => body.scrollTop),
    0,
  );
  await page.screenshot({
    path: path.join(evidence, "spotlight-expanded.png"),
  });
  // Clearing during an expansion and typing again must end in the latest state.
  await frame
    .getByRole("button", { name: "Clear search", exact: true })
    .click();
  await frame.getByRole("combobox").fill("Fixture");
  await frame.getByRole("combobox").fill("");
  await settle();
  assert.equal(await frame.getByRole("option").count(), 0);
  assert.equal(await frame.locator("footer").isVisible(), false);
  assert.ok(
    Math.abs(
      (await frame.locator("dialog").boundingBox()).height - compact.height,
    ) < 1,
  );
  await frame.getByRole("combobox").fill("   ");
  await settle();
  assert.equal(await frame.locator(".search-results").isVisible(), false);
  await frame.getByRole("combobox").fill("no-such-tab-xyz");
  await frame.getByText("No matching tabs", { exact: true }).waitFor();
  await frame.getByRole("combobox").fill("");
  await settle();
  // Settings and filters remain reachable from the compact field.
  await frame.getByRole("button", { name: "Settings", exact: true }).click();
  await frame.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await frame
    .getByRole("button", { name: "← Back to search", exact: true })
    .click();
  await settle();
  assert.equal(await frame.locator(".search-results").isVisible(), false);
  await frame.getByRole("button", { name: "Filters", exact: true }).click();
  await frame
    .getByRole("checkbox", { name: "This window", exact: true })
    .check();
  await frame.getByRole("option").first().waitFor();
  await frame
    .getByRole("button", { name: "Remove This window filter", exact: true })
    .click();
  await frame.getByRole("combobox").press("Escape");
  await settle();
  assert.equal(await frame.locator(".search-results").isVisible(), false);
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
  assert.equal(await page.evaluate(() => document.body.inert), false);
  assert.equal(await page.evaluate(() => window.__outsideClicks), 0);
  // The same backdrop action also dismisses the ordinary search view.
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  await frame.getByRole("combobox").waitFor();
  // Let Chrome commit the new iframe's hit-test region before clicking its backdrop.
  await frame
    .getByRole("combobox")
    .evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await page.mouse.click(24, 24);
  await page.locator("#tabscope-root").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement.id), "prior");
  assert.equal(await page.evaluate(() => window.__outsideClicks), 0);
  // Headless Chrome does not dispatch registered browser shortcuts. Exercise
  // the same content-agent messages used by the separately tested command handler.
  const worker = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith(`chrome-extension://${id}/`));
  const toggle = () =>
    worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return chrome.tabs.sendMessage(tab.id, {
        type: "toggle",
        invocation: crypto.randomUUID(),
        windowId: tab.windowId,
      });
    }, page.url());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await toggle();
  await frame.getByRole("combobox").waitFor();
  await frame.getByRole("combobox").fill("toggle-check");
  assert.equal((await toggle()).closed, true);
  // Reverse an exit before its 120ms fade finishes, retaining the same input.
  await toggle();
  await frame.getByRole("combobox").waitFor();
  assert.equal(await frame.getByRole("combobox").inputValue(), "toggle-check");
  assert.equal((await toggle()).closed, true);
  await page.locator("#tabscope-root").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.body.inert), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "prior");
  await toggle();
  await frame.getByRole("combobox").waitFor();
  assert.equal((await toggle()).closed, true);
  await page.locator("#tabscope-root").waitFor({ state: "detached" });
  // Escape remains supported after reopening.
  await cdp.send("Extensions.triggerAction", { id, targetId: target });
  await frame.getByRole("combobox").waitFor();
  await frame.getByRole("combobox").press("Escape");
  await page.locator("#tabscope-root").waitFor({ state: "detached" });
  assert.equal(page.url(), priorURL);
  await page.screenshot({ path: path.join(evidence, "page-restored.png") });
  if (process.env.TABSCOPE_UI_PREVIEW === "1") {
    // Visual fixtures only: exercise the real renderer without granting site access.
    // Functional checks above use real worker responses. No fixtures ship in src/.
    await cdp.send("Extensions.triggerAction", { id, targetId: target });
    await frame.getByRole("combobox").waitFor();
    const preview = page
      .frames()
      .find((f) =>
        f.url().startsWith(`chrome-extension://${id}/overlay.html?`),
      );
    await preview.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const fixtures = [
        {
          id: 901,
          title: "Design systems — a practical guide",
          url: "https://studio.example.test/design-systems",
          state: "content",
          snippet:
            "A thoughtful design system starts with a few clear decisions. Keep typography consistent, leave room for the content, and make every interaction predictable.",
        },
        {
          id: 902,
          title: "Notes on quiet interfaces",
          url: "https://journal.example.test/quiet-interfaces",
          state: "content",
          snippet:
            "Good interface design makes the next step feel obvious. Reduce visual noise, use gentle contrast, and let the details support the task.",
        },
        {
          id: 903,
          title: "The shape of a useful tool",
          url: "https://notes.example.test/useful-tools",
          state: "content",
          snippet:
            "The best design often removes something. A focused tool should feel familiar from the first interaction and get out of the way when the work is done.",
        },
        {
          id: 904,
          title: "A small reading collection",
          url: "https://library.example.test/collection",
          state: "metadata-only",
          snippet: "",
        },
        {
          id: 905,
          title: "Workspace references",
          url: "https://workspace.example.test/references",
          state: "content",
          snippet:
            "A collected set of observations on typography, alignment and everyday design decisions.",
        },
      ];
      chrome.runtime.sendMessage = async (message) =>
        message.type === "search"
          ? {
              hits: message.query?.trim()
                ? fixtures.filter((h) =>
                    (h.title + " " + h.url + " " + h.snippet)
                      .toLowerCase()
                      .includes(message.query.trim().toLowerCase()),
                  )
                : fixtures,
              total: 5,
              searchable: 4,
              indexing: 0,
              paused: false,
              theme: "system",
            }
          : send(message);
    });
    const settlePreview = async () => {
      await preview.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await frame.getByRole("combobox").fill(" ");
      await frame.getByRole("combobox").fill("");
      await frame.getByRole("option").waitFor({ state: "detached" });
      await frame.locator(".snippet").first().waitFor({ state: "detached" });
      await preview.waitForFunction(
        (theme) =>
          matchMedia("(prefers-color-scheme: dark)").matches ===
          (theme === "dark"),
        theme,
      );
      await settlePreview();
      assert.equal(await page.locator("#tabscope-root").count(), 1);
      console.log(
        "Preview",
        theme,
        "empty",
        await preview.evaluate(() => ({
          value: document.querySelector("input").value,
          surface: getComputedStyle(document.querySelector("dialog"))
            .backgroundColor,
          dialogs: document.querySelectorAll("dialog").length,
          snippets: document.querySelectorAll(".snippet").length,
        })),
      );
      await page.screenshot({
        path: path.join(evidence, `minimal-${theme}-empty.png`),
      });
      await frame.getByRole("combobox").fill("design");
      await frame.locator(".snippet").first().waitFor();
      await settlePreview();
      await page.screenshot({
        path: path.join(evidence, `minimal-${theme}-search.png`),
      });
    }
    await page.setViewportSize({ width: 390, height: 760 });
    await settlePreview();
    await page.screenshot({ path: path.join(evidence, "minimal-narrow.png") });
    assert.equal(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.setViewportSize({ width: 1100, height: 850 });
  }
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
        shortcutTogglesPalette: true,
        interruptedDismissalPreservesInput: true,
        escapeRestoresPage: true,
        outsideClickDismissesSearchAndSettings: true,
        insideClickAndDragDoNotDismiss: true,
        backdropDoesNotClickThrough: true,
        outsideDismissRestoresFocus: true,
        chatEditorCannotStealFocus: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: transparent light/dark iframe, visible dimmed/blurred page, host CSP, no new tab/navigation, reinvocation, shortcut toggle/reversal, outside-click dismissal/focus, no click-through, inside/drag safety and Escape",
  );
} finally {
  await context.close();
  server.close();
}
