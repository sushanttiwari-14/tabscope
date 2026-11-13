// Fresh processes and explicit GC isolate retained index/maps/cache memory.
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const baselineCommit = execFileSync(
  "git",
  [
    "rev-parse",
    "--verify",
    `${process.env.TABSCOPE_BENCHMARK_BASE || "c4d6f6b"}^{commit}`,
  ],
  { encoding: "utf8" },
).trim();
const temp = await mkdtemp(path.join(os.tmpdir(), "tabscope-benchmark-"));
const fixtures = JSON.parse(
  await readFile("tests/fixtures/languages.json", "utf8"),
);
await mkdir(path.join(temp, "baseline/src"), { recursive: true });
for (const file of execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", baselineCommit, "src"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")) {
  await mkdir(path.dirname(path.join(temp, "baseline", file)), {
    recursive: true,
  });
  await writeFile(
    path.join(temp, "baseline", file),
    execFileSync("git", ["show", `${baselineCommit}:${file}`]),
  );
}
for (const [name, root] of [
  ["before", path.join(temp, "baseline")],
  ["after", process.cwd()],
]) {
  await build({
    entryPoints: [path.join(root, "src/search.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    nodePaths: [path.resolve("node_modules")],
    outfile: path.join(temp, name + ".mjs"),
  });
}
// Dynamic import keeps each process bound to just one implementation.
await writeFile(
  path.join(temp, "run.mjs"),
  `import {performance} from 'node:perf_hooks';
const {SearchIndex}=await import('./'+process.argv[2]+'.mjs');
const fixtures=${JSON.stringify(fixtures)};
const scenario=process.argv[3],records=new Map();
for(let id=0;id<(scenario==='long-no-space'?33:100);id++) {
 const f=fixtures[id%fixtures.length];
 const text=scenario==='english'?('Materials science examines lattice structures, experimental methods and mechanical properties. '.repeat(210)+' orbital ceramic configuration running').slice(0,20000):scenario==='mixed'?fixtures.map(f=>f[1]).join(' ').repeat(60).slice(0,20000):'เราศึกษาวิทยาศาสตร์ภาษาไทยทุกวัน'.repeat(3000).slice(0,60000);
 records.set(id,{id,windowId:1,title:'Fixture '+id,url:'https://example.test/'+id,text,locale:scenario==='english'?'en':undefined,state:'content',updated:1});
}
global.gc();const base=process.memoryUsage().heapUsed, baseBuffers=process.memoryUsage().arrayBuffers;let index,cold=[];
for(let n=0;n<3;n++){index=undefined;global.gc();index=new SearchIndex();const at=performance.now();index.rebuild(records);cold.push(performance.now()-at);}
const timings={};
for(const query of scenario==='english'?['ceramic orbital','"orbital ceramic"','configurtaion']:scenario==='mixed'?['lumière','"科学"','ภาษาไทย','العلم','जानकारी']:['ภาษาไทย','"วิทยาศาสตร์"','ภาษาไม่มี']) {
 const times=[];let hits=0;for(let n=0;n<12;n++){index.clearQueryCache();const at=performance.now();hits=index.search(query).length;times.push(performance.now()-at);}times.sort((a,b)=>a-b);timings[query]={p50:+times[6].toFixed(2),p95:+times[11].toFixed(2),hits};
}
index.clearQueryCache();global.gc();cold.sort((a,b)=>a-b);
console.log(JSON.stringify({implementation:process.argv[2],scenario,node:process.version,icu:process.versions.icu,tabs:records.size,textUnits:[...records.values()].reduce((n,r)=>n+r.text.length,0),coldP50:+cold[1].toFixed(2),coldMax:+cold[2].toFixed(2),queries:timings,retainedHeapDeltaMB:+((process.memoryUsage().heapUsed-base)/2**20).toFixed(2),retainedArrayBufferDeltaMB:+((process.memoryUsage().arrayBuffers-baseBuffers)/2**20).toFixed(2),retainedTotalMB:+((process.memoryUsage().heapUsed-base+process.memoryUsage().arrayBuffers-baseBuffers)/2**20).toFixed(2)}));
`,
);
const results = [];
for (const implementation of ["before", "after"])
  for (const scenario of ["english", "mixed", "long-no-space"]) {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ["--expose-gc", path.join(temp, "run.mjs"), implementation, scenario],
        { encoding: "utf8", maxBuffer: 2 ** 20 },
      ),
    );
    results.push(result);
    console.log(JSON.stringify(result));
  }
// Bundles before and after, same Chrome target/minification. Excludes unchanged PDF worker.
const bundles = {};
for (const [name, root] of [
  ["before", path.join(temp, "baseline")],
  ["after", process.cwd()],
]) {
  const result = await build({
    entryPoints: ["content", "palette", "background", "pdf-offscreen"].map(
      (n) => path.join(root, `src/${n}.ts`),
    ),
    bundle: true,
    format: "iife",
    target: "chrome120",
    minify: true,
    loader: { ".css": "text" },
    nodePaths: [path.resolve("node_modules")],
    outdir: path.join(temp, name),
    write: false,
    define: {
      __TABSCOPE_AGENT_VERSION__: '"benchmark"',
      __TABSCOPE_PRODUCTION__: "true",
    },
  });
  bundles[name] = Object.fromEntries(
    result.outputFiles.map((f) => [path.basename(f.path), f.contents.length]),
  );
}
const report = {
  baselineCommit,
  platform: os.platform(),
  memoryGB: Math.round(os.totalmem() / 2 ** 30),
  hardware: os.cpus()[0].model,
  results,
  bundles,
  method:
    "3 cold rebuilds; 12 uncached requests/query; fresh Node process/scenario, explicit GC before and after; retained JS heap plus ArrayBuffer delta includes MiniSearch, token maps, projections, metadata. Observational, not Chrome peak RSS.",
};
await mkdir("work/multilingual-benchmark", { recursive: true });
await writeFile(
  "work/multilingual-benchmark/result.json",
  JSON.stringify(report, null, 2),
);
