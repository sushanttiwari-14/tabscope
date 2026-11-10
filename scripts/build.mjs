import { createHash } from "node:crypto";
import { build, context } from "esbuild";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
await copyFile("manifest.json", "dist/manifest.json");
await copyFile("THIRD_PARTY_NOTICES.txt", "dist/THIRD_PARTY_NOTICES.txt");
await writeFile(
  "dist/palette.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${manifest.name}</title><link rel="stylesheet" href="palette.css"></head><body><script type="module" src="palette.js"></script></body></html>`,
);
// Overlay transparency is static HTML: no opaque canvas while JS starts.
await writeFile(
  "dist/overlay.html",
  `<!doctype html><html lang="en" class="overlay"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${manifest.name}</title><link rel="stylesheet" href="palette.css"></head><body class="overlay"><script type="module" src="palette.js"></script></body></html>`,
);
await writeFile(
  "dist/palette.css",
  (await readFile("src/styles/tokens.css", "utf8")) +
    "\n" +
    (await readFile("src/styles/palette.css", "utf8")),
);
await copyFile(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "dist/pdf.worker.mjs",
);
await copyFile("node_modules/pdfjs-dist/LICENSE", "dist/PDFJS_LICENSE.txt");
await writeFile(
  "dist/pdf-offscreen.html",
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="pdf-offscreen.js"></script></body></html>',
);
const agentHash = createHash("sha256");
for (const file of [
  "src/content.ts",
  "src/extract.ts",
  "src/search.ts",
  "src/matching.ts",
  "src/types.ts",
  "src/styles/tokens.css",
  "package-lock.json",
])
  agentHash.update(await readFile(file));
const opts = {
  define: {
    __TABSCOPE_AGENT_VERSION__: JSON.stringify(
      agentHash.digest("hex").slice(0, 16),
    ),
  },
  entryPoints: [
    "src/background.ts",
    "src/palette.ts",
    "src/content.ts",
    "src/pdf-offscreen.ts",
  ],
  outdir: "dist",
  bundle: true,
  loader: { ".css": "text" },
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
