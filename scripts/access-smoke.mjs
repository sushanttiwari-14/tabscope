import { chromium } from "playwright";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const evidence = path.resolve(
  process.env.TABSCOPE_EVIDENCE || "work/access-browser",
);
await mkdir(evidence, { recursive: true });
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.join(os.tmpdir(), "tabscope-access-")),
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
    path: path.join(root, "dist"),
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`chrome-extension://${id}/palette.html`);
  const command = await page.evaluate(async () =>
    (await chrome.commands.getAll()).find((c) => c.name === "open-search"),
  );
  assert.ok(command?.shortcut && /space/i.test(command.shortcut));
  console.log("Registered shortcut:", command.shortcut);
  const prompt = page.getByRole("region", { name: "Search inside your tabs" });
  await prompt.waitFor();
  assert.equal(
    (await page.evaluate(() => chrome.permissions.getAll())).origins.length,
    0,
  );
  await page.setViewportSize({ width: 640, height: 800 });
  for (let n = 0; n < 8; n++) await context.newPage();
  await page.bringToFront();
  await page.getByRole("combobox").fill(" ");
  await page.waitForFunction(
    () => document.querySelectorAll("[role=option]").length >= 10,
  );
  await page.setViewportSize({ width: 360, height: 640 });
  assert.equal(
    await page.evaluate(() => {
      const dialog = document.querySelector("dialog").getBoundingClientRect();
      const footer = document.querySelector("footer").getBoundingClientRect();
      return (
        footer.bottom <= dialog.bottom &&
        document.documentElement.scrollWidth <= innerWidth
      );
    }),
    true,
  );
  await page.screenshot({ path: path.join(evidence, "first-open.png") });
  await page
    .getByRole("button", { name: "Titles & URLs only", exact: true })
    .click();
  await prompt.waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("combobox").waitFor();
  assert.equal(await prompt.isVisible(), false);
  assert.equal(
    (await page.evaluate(() => chrome.permissions.getAll())).origins.length,
    0,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Website access", { exact: true }).click();
  await page
    .getByRole("button", { name: "Allow all websites", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".shortcut-key").textContent(),
    command.shortcut,
  );
  console.log(
    "PASS: fresh-profile explanation, no automatic grant, metadata-only dismissal, restart persistence, and Settings access",
  );
} finally {
  await context.close();
}
