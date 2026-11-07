import { performance } from "node:perf_hooks";
import os from "node:os";
import { SearchIndex } from "../src/search";
import type { TabRecord } from "../src/types";
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: os.platform(),
      cpu: os.cpus()[0]?.model,
      memoryGB: Math.round(os.totalmem() / 2 ** 30),
    },
    null,
    2,
  ),
);
for (const count of [5, 20, 50, 100, 150]) {
  const records = new Map<number, TabRecord>();
  for (let i = 0; i < count; i++) {
    records.set(i, {
      id: i,
      windowId: 1,
      url: `https://example.test/${i}`,
      title: `Article ${i}`,
      text: (
        "Materials science examines lattice structures, experimental methods and mechanical properties. ".repeat(
          210,
        ) + (i % 7 === 0 ? " orbital ceramic engine" : "")
      ).slice(0, 20000),
      updated: i,
      state: "content",
    });
  }
  const cold: number[] = [];
  let index = new SearchIndex();
  for (let n = 0; n < 10; n++) {
    index = new SearchIndex();
    const start = performance.now();
    index.rebuild(records);
    cold.push(performance.now() - start);
  }
  const warm: number[] = [];
  for (let n = 0; n < 250; n++) {
    const start = performance.now();
    index.search(n % 2 ? "ceramic orbital" : "mechanical lattice");
    warm.push(performance.now() - start);
  }
  const p = (a: number[], q: number) =>
    Number([...a].sort((a, b) => a - b)[Math.floor(a.length * q)].toFixed(2));
  console.log(
    JSON.stringify({
      tabs: count,
      chars: [...records.values()].reduce((n, r) => n + r.text.length, 0),
      coldRebuildRepetitions: cold.length,
      coldP50: p(cold, 0.5),
      coldP95: p(cold, 0.95),
      warmRepetitions: warm.length,
      warmP50: p(warm, 0.5),
      warmP95: p(warm, 0.95),
      heapMB: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
    }),
  );
}
