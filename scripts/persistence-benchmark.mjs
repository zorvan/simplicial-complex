import { performance } from "node:perf_hooks";
import { SimplicialModel } from "../tests-dist/core/model.js";
import { createTopologyInput } from "../tests-dist/core/topology/chain-complex.js";
import { buildFilteredComplex } from "../tests-dist/core/topology/filtered-complex.js";
import { computePersistence } from "../tests-dist/core/topology/persistence.js";

/**
 * PH-09. Extends the MC-00 static baselines rather than starting a second harness: the same
 * deterministic fixture and the same three tiers, now measuring the reduction.
 *
 * A breach here is not a licence to improvise. Per plan §4.5, a missed budget opens WASM-00
 * (the deferred Rust/WASM engine spike); it does not get absorbed silently.
 */
const sizes = [500, 2_000, 10_000];

/** Wall-clock ceilings for one reduction, and peak live sparse column entries. */
const budgets = new Map([
  [500, { reduceMs: 150, witnessMs: 250, peakColumnEntries: 200_000 }],
  [2_000, { reduceMs: 500, witnessMs: 900, peakColumnEntries: 800_000 }],
  [10_000, { reduceMs: 2_500, witnessMs: 4_500, peakColumnEntries: 4_000_000 }],
]);

/** Cancellation must be answered promptly; the reduction polls between column batches. */
const CANCELLATION_BUDGET_MS = 50;

let failed = false;

for (const size of sizes) {
  const model = fixture(size);
  const budget = budgets.get(size);

  const bare = createTopologyInput(model, "bench", { maxHomologyDimension: 2, metric: "weight" });
  const withWitnesses = createTopologyInput(model, "bench-witness", {
    maxHomologyDimension: 2,
    metric: "weight",
    computeRepresentatives: true,
  });

  const buildMs = median(Array.from({ length: 3 }, () => timed(() => buildFilteredComplex(bare))));
  const complex = buildFilteredComplex(bare);
  const witnessComplex = buildFilteredComplex(withWitnesses);

  let result = null;
  const reduceMs = median(
    Array.from({ length: 3 }, () =>
      timed(() => {
        result = computePersistence(complex, { metric: "weight", modelRevision: 0, computeRepresentatives: false });
      }),
    ),
  );
  let witnessResult = null;
  const witnessMs = median(
    Array.from({ length: 3 }, () =>
      timed(() => {
        witnessResult = computePersistence(witnessComplex, {
          metric: "weight",
          modelRevision: 0,
          computeRepresentatives: true,
        });
      }),
    ),
  );

  // How fast a cooperative cancel is actually answered, measured rather than assumed.
  const cancelMs = timed(() => {
    try {
      computePersistence(
        complex,
        { metric: "weight", modelRevision: 0, computeRepresentatives: false },
        { shouldCancel: () => true },
      );
    } catch {
      /* expected: PersistenceCancelledError */
    }
  });

  const counts = [...model.simplices.values()].reduce((acc, simplex) => {
    acc[simplex.nodes.length - 1] = (acc[simplex.nodes.length - 1] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify({
      nodes: size,
      edges: counts[1] ?? 0,
      triangles: counts[2] ?? 0,
      tetrahedra: counts[3] ?? 0,
      boundaryNonzeros: complex.boundaries.reduce((sum, column) => sum + column.length, 0),
      simplicesInFiltration: complex.simplices.length,
      filtrationRepairs: complex.repairs.length,
      buildMs,
      reduceMs,
      witnessMs,
      cancelMs,
      intervals: result?.intervals.length ?? 0,
      essential: result?.diagnostics.essentialIntervalCount ?? 0,
      peakColumnEntries: witnessResult?.diagnostics.peakColumnEntries ?? 0,
      columnOperations: result?.diagnostics.columnOperations ?? 0,
      budgetReduceMs: budget.reduceMs,
      budgetWitnessMs: budget.witnessMs,
      budgetPeakColumnEntries: budget.peakColumnEntries,
      budgetCancelMs: CANCELLATION_BUDGET_MS,
    }),
  );

  if (reduceMs > budget.reduceMs) failed = true;
  if (witnessMs > budget.witnessMs) failed = true;
  if (cancelMs > CANCELLATION_BUDGET_MS) failed = true;
  if ((witnessResult?.diagnostics.peakColumnEntries ?? 0) > budget.peakColumnEntries) failed = true;
}

if (failed) {
  console.error("[simplicial-complex] a persistence budget was missed; open WASM-00 rather than absorbing it");
  process.exitCode = 1;
}

/** The MC-00 fixture, with weights so the filtration is non-trivial and deterministic. */
function fixture(size) {
  const model = new SimplicialModel();
  const id = (index) => `note-${String(index).padStart(5, "0")}.md`;
  for (let i = 0; i < size; i++) model.setNode(id(i));
  for (let i = 0; i + 1 < size; i++) model.addSimplex({ nodes: [id(i), id(i + 1)], weight: weightFor(i) });
  for (let i = 0; i + 2 < size; i += 5)
    model.addSimplex({ nodes: [id(i), id(i + 1), id(i + 2)], weight: weightFor(i) * 0.9 });
  for (let i = 0; i + 3 < size; i += 50)
    model.addSimplex({ nodes: [id(i), id(i + 1), id(i + 2), id(i + 3)], weight: weightFor(i) * 0.8 });
  return model;
}

/** Deterministic spread over [0.1, 1]; no randomness, so runs are comparable across machines. */
function weightFor(index) {
  return 0.1 + ((index * 37) % 90) / 100;
}

function timed(fn) {
  const start = performance.now();
  fn();
  return Number((performance.now() - start).toFixed(3));
}

function median(values) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}
