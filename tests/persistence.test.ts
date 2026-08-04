import { strict as assert } from "node:assert";
import { test } from "node:test";
import { computeBetti } from "../core/betti.js";
import { SimplicialModel } from "../core/model.js";
import { normalizeKey } from "../core/normalize.js";
import { createTopologyInput } from "../core/topology/chain-complex.js";
import { buildFilteredComplex } from "../core/topology/filtered-complex.js";
import {
  computePersistence,
  computePersistenceAsync,
  reduceBoundaryMatrix,
  reduceBoundaryMatrixAsync,
} from "../core/topology/persistence.js";
import {
  bettiAtThreshold,
  intervalsAlive,
  PersistenceCancelledError,
  type PersistenceResult,
} from "../core/topology/persistence-types.js";
import { boundaryIsZero } from "../core/topology/representatives.js";
import { TsTopologyBackend } from "../core/topology/ts-backend.js";

interface Weighted {
  nodes: string[];
  weight?: number;
}

function modelOf(nodes: string[], simplices: Weighted[]): SimplicialModel {
  const model = new SimplicialModel();
  nodes.forEach((id) => model.setNode(id));
  simplices.forEach((simplex) => model.addSimplex(simplex));
  return model;
}

function persistenceOf(model: SimplicialModel, computeRepresentatives = true): PersistenceResult {
  const input = createTopologyInput(model, "test", { maxHomologyDimension: 2, computeRepresentatives });
  return computePersistence(buildFilteredComplex(input), {
    metric: "weight",
    modelRevision: model.revision,
    computeRepresentatives,
  });
}

/** Independent oracle: rebuild the sublevel subcomplex and run static homology on it. */
function staticBettiAtThreshold(model: SimplicialModel, threshold: number): number[] {
  const input = createTopologyInput(model, "prefix", { maxHomologyDimension: 2 });
  const prefix = new SimplicialModel();
  input.vertexKeys.forEach((id) => prefix.setNode(id));
  for (let i = 0; i < input.stableKeys.length; i++) {
    if (input.filtrationValues[i] > threshold) continue;
    const nodes = [...input.simplexVertices.slice(input.simplexOffsets[i], input.simplexOffsets[i + 1])].map(
      (index) => input.vertexKeys[index],
    );
    prefix.addSimplex({ nodes });
  }
  const betti = computeBetti(prefix, 2);
  return [betti.b0, betti.b1, betti.b2];
}

const SQUARE = () =>
  modelOf(
    ["a", "b", "c", "d"],
    [
      { nodes: ["a", "b"], weight: 1 },
      { nodes: ["b", "c"], weight: 1 },
      { nodes: ["c", "d"], weight: 1 },
      { nodes: ["d", "a"], weight: 1 },
    ],
  );

/** Two independent 1-cycles at time 0, filled at distinct later thresholds. */
const BORN_AND_FILLED = () =>
  modelOf(
    ["a", "b", "c", "d"],
    [
      { nodes: ["a", "b"], weight: 1 },
      { nodes: ["b", "c"], weight: 1 },
      { nodes: ["c", "d"], weight: 1 },
      { nodes: ["d", "a"], weight: 1 },
      { nodes: ["a", "c"], weight: 1 },
      { nodes: ["a", "b", "c"], weight: 0.6 },
      { nodes: ["a", "c", "d"], weight: 0.4 },
    ],
  );

const TETRAHEDRON_BOUNDARY = () =>
  modelOf(
    ["a", "b", "c", "d"],
    [
      { nodes: ["a", "b", "c"], weight: 1 },
      { nodes: ["a", "b", "d"], weight: 1 },
      { nodes: ["a", "c", "d"], weight: 1 },
      { nodes: ["b", "c", "d"], weight: 1 },
    ],
  );

test("every ordered prefix of the filtration is a simplicial complex", () => {
  for (const model of [SQUARE(), BORN_AND_FILLED(), TETRAHEDRON_BOUNDARY()]) {
    const complex = buildFilteredComplex(createTopologyInput(model, "order", { maxHomologyDimension: 2 }));
    const seen = new Set<string>();
    for (const simplex of complex.simplices) {
      for (const face of complex.boundaries[simplex.order]) {
        assert.ok(face < simplex.order, `${simplex.key} precedes its own face`);
        assert.ok(seen.has(complex.simplices[face].key), `prefix missing ${complex.simplices[face].key}`);
      }
      seen.add(simplex.key);
    }
  }
});

test("a face weighted below its coface delays the coface and reports the repair", () => {
  const model = modelOf(
    ["a", "b", "c"],
    [
      { nodes: ["a", "b"], weight: 0.2 },
      { nodes: ["a", "b", "c"], weight: 0.9 },
    ],
  );
  const complex = buildFilteredComplex(createTopologyInput(model, "repair", { maxHomologyDimension: 2 }));
  const triangle = complex.simplices.find((simplex) => simplex.dimension === 2);
  assert.ok(triangle);
  // The edge is weak evidence (score 0.2 -> value 0.8); the triangle cannot precede it.
  assert.ok(Math.abs(triangle.rawValue - 0.1) < 1e-12);
  assert.ok(Math.abs(triangle.value - 0.8) < 1e-12);
  const repair = complex.repairs.find((entry) => entry.simplexKey === triangle.key);
  assert.ok(repair, "the repair is reported rather than applied silently");
  assert.equal(repair.faceKey, normalizeKey(["a", "b"]));
});

test("an unfilled square is one essential H1 class", () => {
  const result = persistenceOf(SQUARE());
  const h1 = result.intervals.filter((interval) => interval.dimension === 1);
  assert.equal(h1.length, 1);
  assert.equal(h1[0].death, null, "essential intervals survive to death: null");
  assert.equal(h1[0].lifetime, null);
  assert.equal(result.intervals.filter((interval) => interval.dimension === 0 && interval.death === null).length, 1);
});

test("filling a cycle produces a finite bar that dies at the filling simplex", () => {
  const result = persistenceOf(BORN_AND_FILLED());
  const h1 = result.intervals.filter((interval) => interval.dimension === 1);
  assert.equal(h1.length, 2);
  assert.deepEqual(
    // Same birth, so the barcode orders the longer bar first.
    h1.map((interval) => Number((interval.death ?? -1).toFixed(6))),
    [0.6, 0.4],
  );
  assert.deepEqual(
    h1.map((interval) => interval.deathSimplex),
    [normalizeKey(["a", "c", "d"]), normalizeKey(["a", "b", "c"])],
  );
  assert.equal(
    h1.every((interval) => interval.birth === 0),
    true,
  );
});

test("a hollow tetrahedron is one essential H2 class", () => {
  const result = persistenceOf(TETRAHEDRON_BOUNDARY());
  const h2 = result.intervals.filter((interval) => interval.dimension === 2);
  assert.equal(h2.length, 1);
  assert.equal(h2[0].death, null);
});

test("Betti at every threshold equals the alive interval count", () => {
  for (const model of [SQUARE(), BORN_AND_FILLED(), TETRAHEDRON_BOUNDARY()]) {
    const result = persistenceOf(model);
    const thresholds = [...new Set([0, 0.3, 0.4, 0.5, 0.6, 0.7, 1])];
    for (const threshold of thresholds) {
      assert.deepEqual(
        bettiAtThreshold(result.intervals, threshold, 2),
        staticBettiAtThreshold(model, threshold),
        `Betti at ${threshold}`,
      );
    }
  }
});

test("empty and disconnected complexes reduce without inventing classes", () => {
  const empty = persistenceOf(modelOf([], []));
  assert.deepEqual(empty.intervals, []);

  const disconnected = persistenceOf(
    modelOf(
      ["a", "b", "c", "d"],
      [
        { nodes: ["a", "b"], weight: 1 },
        { nodes: ["c", "d"], weight: 1 },
      ],
    ),
  );
  assert.equal(disconnected.intervals.filter((interval) => interval.death === null).length, 2);
  assert.equal(disconnected.intervals.filter((interval) => interval.dimension > 0).length, 0);
});

test("insertion order does not change the barcode for tie-free input", () => {
  const forward = modelOf(
    ["a", "b", "c", "d"],
    [
      { nodes: ["a", "b"], weight: 0.9 },
      { nodes: ["b", "c"], weight: 0.8 },
      { nodes: ["c", "d"], weight: 0.7 },
      { nodes: ["d", "a"], weight: 0.6 },
      { nodes: ["a", "c"], weight: 0.5 },
    ],
  );
  const reversed = modelOf(
    ["d", "c", "b", "a"],
    [
      { nodes: ["a", "c"], weight: 0.5 },
      { nodes: ["d", "a"], weight: 0.6 },
      { nodes: ["c", "d"], weight: 0.7 },
      { nodes: ["b", "c"], weight: 0.8 },
      { nodes: ["a", "b"], weight: 0.9 },
    ],
  );
  const strip = (result: PersistenceResult) =>
    result.intervals.map((interval) => [interval.dimension, interval.birth, interval.death]);
  assert.deepEqual(strip(persistenceOf(forward)), strip(persistenceOf(reversed)));
});

test("tied simplices pair deterministically across repeated runs", () => {
  const runs = Array.from({ length: 3 }, () => persistenceOf(BORN_AND_FILLED()));
  const encode = (result: PersistenceResult) => JSON.stringify(result.intervals);
  assert.equal(encode(runs[0]), encode(runs[1]));
  assert.equal(encode(runs[1]), encode(runs[2]));
});

test("every representative is a verified cycle carrying its birth simplex", () => {
  for (const model of [SQUARE(), BORN_AND_FILLED(), TETRAHEDRON_BOUNDARY()]) {
    const input = createTopologyInput(model, "witness", { maxHomologyDimension: 2, computeRepresentatives: true });
    const complex = buildFilteredComplex(input);
    const result = computePersistence(complex, {
      metric: "weight",
      modelRevision: model.revision,
      computeRepresentatives: true,
    });
    assert.equal(result.diagnostics.rejectedRepresentativeCount, 0);

    const byId = new Map(result.intervals.map((interval) => [interval.id, interval]));
    for (const representative of result.representatives) {
      const interval = byId.get(representative.intervalId);
      assert.ok(interval, "every representative names a real interval");
      assert.equal(representative.canonical, false);
      assert.ok(
        representative.simplices.includes(interval.birthSimplex),
        "the witness contains the simplex that created the class",
      );
      const chain = Uint32Array.from(representative.simplices.map((key) => complex.order.get(key) as number));
      assert.ok(boundaryIsZero(complex, chain), `∂z=0 for ${representative.intervalId}`);
    }
    assert.equal(
      result.representatives.length,
      result.intervals.filter((interval) => interval.dimension >= 1).length,
      "every bar above dimension 0 exposes a witness",
    );
  }
});

test("representatives are withheld unless requested", () => {
  const result = persistenceOf(BORN_AND_FILLED(), false);
  assert.deepEqual(result.representatives, []);
  assert.equal(result.diagnostics.representativesRequested, false);
});

test("cooperative cancellation stops the reduction without destroying state", () => {
  const complex = buildFilteredComplex(createTopologyInput(BORN_AND_FILLED(), "cancel", { maxHomologyDimension: 2 }));
  assert.throws(
    () => reduceBoundaryMatrix(complex, { shouldCancel: () => true }),
    (error: unknown) => error instanceof PersistenceCancelledError,
  );
});

test("adding a hyperedge alone leaves the barcode unchanged", () => {
  const model = BORN_AND_FILLED();
  const before = JSON.stringify(persistenceOf(model).intervals);
  model.addHyperedge({ nodes: ["a", "b", "c", "d"], label: "encounter", weight: 1 });
  assert.equal(JSON.stringify(persistenceOf(model).intervals), before);
});

test("the backend reaches the same barcode as a direct reduction", async () => {
  const model = BORN_AND_FILLED();
  const input = createTopologyInput(model, "backend", { maxHomologyDimension: 2, computeRepresentatives: true });
  const viaBackend = await new TsTopologyBackend().computePersistence(input);
  const direct = computePersistence(buildFilteredComplex(input), {
    metric: "weight",
    modelRevision: model.revision,
    computeRepresentatives: true,
  });
  assert.deepEqual(viaBackend.intervals, direct.intervals);
  assert.equal(viaBackend.coefficientField, "F2");
  assert.equal(viaBackend.direction, "increasing");
});

test("alive intervals at a threshold exclude zero-length bars", () => {
  const result = persistenceOf(BORN_AND_FILLED());
  for (const interval of result.intervals) {
    if (interval.lifetime !== 0) continue;
    assert.ok(!intervalsAlive(result.intervals, interval.birth).includes(interval));
  }
});

/** A complex big enough that the reduction spans more than one column batch. */
function LONG_CHAIN(): SimplicialModel {
  const model = new SimplicialModel();
  const id = (index: number) => `n${String(index).padStart(4, "0")}`;
  for (let i = 0; i < 900; i++) model.setNode(id(i));
  for (let i = 0; i + 1 < 900; i++) model.addSimplex({ nodes: [id(i), id(i + 1)], weight: 1 });
  return model;
}

test("a long reduction yields, so a cancel that arrives mid-run is observed", async () => {
  const model = LONG_CHAIN();
  const complex = buildFilteredComplex(createTopologyInput(model, "yield", { maxHomologyDimension: 2 }));

  // The flag flips from a timer, which can only fire if the reduction returns to the event
  // loop. A synchronous loop would finish first and never see it — which is exactly the
  // bug this async driver exists to fix: in a worker, the `cancel` message cannot even be
  // dequeued while a synchronous reduction is running.
  let cancelled = false;
  setTimeout(() => {
    cancelled = true;
  }, 0);

  await assert.rejects(
    reduceBoundaryMatrixAsync(complex, { shouldCancel: () => cancelled }, undefined, 0),
    (error: unknown) => error instanceof PersistenceCancelledError,
  );
});

test("the async driver reaches the same barcode as the synchronous one", async () => {
  const model = BORN_AND_FILLED();
  const complex = buildFilteredComplex(
    createTopologyInput(model, "async", { maxHomologyDimension: 2, computeRepresentatives: true }),
  );
  const context = { metric: "weight" as const, modelRevision: model.revision, computeRepresentatives: true };

  const asynchronous = await computePersistenceAsync(complex, context);
  const synchronous = computePersistence(complex, context);
  assert.deepEqual(asynchronous.intervals, synchronous.intervals);
  assert.deepEqual(asynchronous.representatives, synchronous.representatives);
});

test("a reduction that finishes quickly never pays for a yield", async () => {
  const model = BORN_AND_FILLED();
  const complex = buildFilteredComplex(createTopologyInput(model, "fast", { maxHomologyDimension: 2 }));
  let yields = 0;
  await reduceBoundaryMatrixAsync(complex, {}, async () => {
    yields++;
    await Promise.resolve();
  });
  assert.equal(yields, 0, "yielding is gated on elapsed time, so the common case costs nothing");
});
