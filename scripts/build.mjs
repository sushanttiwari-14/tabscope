import { build, context } from "esbuild";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await copyFile("manifest.json", "dist/manifest.json");
await writeFile(
  "dist/palette.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TabScope</title><link rel="stylesheet" href="palette.css"></head><body><script type="module" src="palette.js"></script></body></html>',
);
await writeFile(
  "dist/palette.css",
  (await readFile("src/styles/tokens.css", "utf8")) +
    "\n" +
    (await readFile("src/styles/palette.css", "utf8")),
);
const opts = {
  entryPoints: ["src/background.ts", "src/palette.ts", "src/content.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: !process.argv.includes("--watch"),
  legalComments: "none",
};
if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("Watching TypeScript; rerun build for CSS/manifest changes.");
} else await build(opts);
