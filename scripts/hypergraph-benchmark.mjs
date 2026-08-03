import { performance } from "node:perf_hooks";
import process from "node:process";
import { SimplicialModel } from "../tests-dist/core/model.js";
import { buildIncidenceMatrix } from "../tests-dist/core/incidence.js";
import { analyzeSheaf } from "../tests-dist/core/sheaf.js";
import { synchronizationTime } from "../tests-dist/core/activation.js";
import { relationKey } from "../tests-dist/core/normalize.js";

const NODES = 500;
const RUNS = 31;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const measure = (fn) => {
  for (let i = 0; i < 5; i++) fn();
  return median(
    Array.from({ length: RUNS }, () => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    }),
  );
};

function fixture(mixed) {
  const model = new SimplicialModel();
  for (let i = 0; i < NODES; i++)
    model.setNode(`Benchmark/n${String(i).padStart(3, "0")}.md`, { px: (i % 25) * 32, py: Math.floor(i / 25) * 32 });
  for (let i = 0; i < 180; i++) {
    const nodes = [i, (i + 37) % NODES, (i + 91) % NODES].map((n) => `Benchmark/n${String(n).padStart(3, "0")}.md`);
    if (mixed && i % 3 === 0) model.addHyperedge({ nodes, label: `encounter-${i}` });
    else model.addSimplex({ nodes, userDefined: true, label: `simplex-${i}` });
  }
  // Coincident kinds exercise namespaced caches and simultaneous selection.
  if (mixed) model.addHyperedge({ nodes: ["Benchmark/n000.md", "Benchmark/n037.md", "Benchmark/n091.md"] });
  return model;
}

const simple = fixture(false);
const mixed = fixture(true);
const renderPrep = (model) =>
  model
    .getAllRelations()
    .map(({ key, relation }) => `${key}:${relation.nodes.map((id) => model.nodes.get(id)?.px ?? 0).join(",")}`);
const baseline = measure(() => renderPrep(simple));
const mixedFrame = measure(() => renderPrep(mixed));

const coldBlob = measure(() => {
  const cache = new Map();
  renderPrep(mixed).forEach((geometry) => cache.set(geometry, geometry.length));
});
const blobCache = new Map(renderPrep(mixed).map((geometry) => [geometry, geometry.length]));
const warmBlob = measure(() => renderPrep(mixed).forEach((geometry) => blobCache.get(geometry)));
const largeGlyph = measure(() =>
  Array.from({ length: 80 }, (_, i) => [Math.cos(i) * 100, Math.sin(i) * 100])
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" "),
);
const incidence = measure(() => buildIncidenceMatrix(mixed));

const contexts = [];
const sections = new Map();
for (let i = 0; i < 40; i++) {
  const nodes = [
    `Benchmark/n${String(i).padStart(3, "0")}.md`,
    `Benchmark/n${String((i + 1) % 40).padStart(3, "0")}.md`,
  ];
  const key = mixed.addHyperedge({ nodes });
  contexts.push({ id: `c${i}`, name: `c${i}`, source: "manual", definition: "benchmark", relations: [key] });
  sections.set(`c${i}`, new Map(nodes.map((node, j) => [node, ["research", "project", "idea"][(i + j) % 3]])));
}
const sheaf = measure(() => analyzeSheaf(mixed, { contexts, sections }));
const synchronizationKey = mixed.hyperedges.keys().next().value;
const synchronization = measure(() =>
  synchronizationTime(mixed, synchronizationKey, "hypergraph", { maxIterations: 100, threshold: 1e-4 }),
);

const results = {
  fixture: { nodes: NODES, coincidentKinds: true, runs: RUNS },
  environment: {
    machine: `${process.platform}/${process.arch} ${process.version}`,
    browser: "Electron 39.8.10 / Chromium 142",
    obsidian: "1.12.7 (API package 1.12.3)",
  },
  medianMs: {
    simplicialRenderPrep: baseline,
    mixedRenderPrep: mixedFrame,
    coldBlobCache: coldBlob,
    warmBlobCache: warmBlob,
    largeEncounterGlyph: largeGlyph,
    incidence500: incidence,
    synchronization500: synchronization,
    sheaf500: sheaf,
  },
  budgets: {
    mixedVsBaselineRatio: 1.1,
    incidence500Ms: 20,
    synchronization500Ms: 250,
    sheaf500Ms: 250,
    largeGlyphMs: 5,
  },
};
results.passed =
  mixedFrame <= baseline * results.budgets.mixedVsBaselineRatio &&
  incidence <= 20 &&
  synchronization <= 250 &&
  sheaf <= 250 &&
  largeGlyph <= 5 &&
  warmBlob <= coldBlob;
console.log(JSON.stringify(results, null, 2));
if (!results.passed) process.exitCode = 1;
