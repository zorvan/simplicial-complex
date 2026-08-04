import { performance } from "node:perf_hooks";
import { computeBetti } from "../tests-dist/core/betti.js";
import { findMissingFaces } from "../tests-dist/core/missing-faces.js";
import { SimplicialModel } from "../tests-dist/core/model.js";

const sizes = [500, 2_000, 10_000];
const budgets = new Map([
  [500, 100],
  [2_000, 300],
  [10_000, 1_500],
]);
let failed = false;

for (const size of sizes) {
  const model = fixture(size);
  computeBetti(model, 2);
  const homologyMs = median(Array.from({ length: 5 }, () => timed(() => computeBetti(model, 2))));
  const summaryMs = timed(() => model.getAnalysisSummary());
  const fullScanMs = median(Array.from({ length: 5 }, () => timed(() => findMissingFaces(model, 2))));
  const counts = [...model.simplices.values()].reduce((acc, simplex) => {
    acc[simplex.nodes.length - 1] = (acc[simplex.nodes.length - 1] ?? 0) + 1;
    return acc;
  }, {});
  const boundaryNonzeros = [...model.simplices.values()].reduce(
    (sum, simplex) => sum + (simplex.nodes.length > 1 ? simplex.nodes.length : 0),
    0,
  );
  const budget = budgets.get(size);
  console.log(
    JSON.stringify({
      nodes: size,
      edges: counts[1] ?? 0,
      triangles: counts[2] ?? 0,
      tetrahedra: counts[3] ?? 0,
      boundaryNonzeros,
      homologyMs,
      summaryMs,
      fullScanMs,
      mainThreadBlockMs: homologyMs,
      budgetMs: budget,
    }),
  );
  if (homologyMs > budget) failed = true;
}

if (failed) process.exitCode = 1;

function fixture(size) {
  const model = new SimplicialModel();
  for (let i = 0; i < size; i++) model.setNode(`note-${String(i).padStart(5, "0")}.md`);
  for (let i = 0; i + 1 < size; i++)
    model.addSimplex({ nodes: [`note-${String(i).padStart(5, "0")}.md`, `note-${String(i + 1).padStart(5, "0")}.md`] });
  for (let i = 0; i + 2 < size; i += 5)
    model.addSimplex({
      nodes: [
        `note-${String(i).padStart(5, "0")}.md`,
        `note-${String(i + 1).padStart(5, "0")}.md`,
        `note-${String(i + 2).padStart(5, "0")}.md`,
      ],
    });
  for (let i = 0; i + 3 < size; i += 50)
    model.addSimplex({
      nodes: [
        `note-${String(i).padStart(5, "0")}.md`,
        `note-${String(i + 1).padStart(5, "0")}.md`,
        `note-${String(i + 2).padStart(5, "0")}.md`,
        `note-${String(i + 3).padStart(5, "0")}.md`,
      ],
    });
  return model;
}

function timed(fn) {
  const start = performance.now();
  fn();
  return Number((performance.now() - start).toFixed(3));
}
function median(values) {
  return values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
}
