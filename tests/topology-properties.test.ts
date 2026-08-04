import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { computeBetti } from "../core/betti.js";
import { SimplicialModel } from "../core/model.js";
import { mulberry32 } from "../core/topology/bootstrap.js";
import { createTopologyInput } from "../core/topology/chain-complex.js";
import { buildFilteredComplex } from "../core/topology/filtered-complex.js";
import { computePersistence } from "../core/topology/persistence.js";
import { bettiAtThreshold } from "../core/topology/persistence-types.js";
import { boundaryIsZero } from "../core/topology/representatives.js";

const SEEDS = Array.from({ length: 40 }, (_, index) => 1000 + index * 7);

/** Bounded random downward-closed complexes. Small enough that the dense checks stay cheap. */
function randomModel(seed: number): SimplicialModel {
  const random = mulberry32(seed);
  const nodeCount = 3 + Math.floor(random() * 6);
  const nodes = Array.from({ length: nodeCount }, (_, index) => `n${index}`);
  const model = new SimplicialModel();
  nodes.forEach((id) => model.setNode(id));

  const edgeChance = 0.35 + random() * 0.4;
  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      if (random() < edgeChance) model.addSimplex({ nodes: [nodes[i], nodes[j]], weight: round(random()) });
    }
  }
  const triangleChance = random() * 0.35;
  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      for (let k = j + 1; k < nodeCount; k++) {
        if (random() < triangleChance) {
          model.addSimplex({ nodes: [nodes[i], nodes[j], nodes[k]], weight: round(random()) });
        }
      }
    }
  }
  return model;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

test("boundary squared is zero on generated complexes", () => {
  for (const seed of SEEDS) {
    const model = randomModel(seed);
    const complex = buildFilteredComplex(createTopologyInput(model, "prop", { maxHomologyDimension: 2 }));
    for (const simplex of complex.simplices) {
      const parity = new Set<number>();
      for (const face of complex.boundaries[simplex.order]) {
        for (const row of complex.boundaries[face]) {
          if (parity.has(row)) parity.delete(row);
          else parity.add(row);
        }
      }
      assert.equal(parity.size, 0, `∂∂≠0 for ${simplex.key} (seed ${seed})`);
    }
  }
});

test("Betti numbers are non-negative integers and satisfy Euler–Poincaré", () => {
  for (const seed of SEEDS) {
    const result = computeBetti(randomModel(seed), 2);
    for (const value of result.betti) {
      assert.ok(Number.isInteger(value) && value >= 0, `β=${value} (seed ${seed})`);
    }
    const eulerFaces = result.chainDimensions.reduce((sum, count, dimension) => sum + (-1) ** dimension * count, 0);
    const eulerBetti = result.chainDimensions.reduce(
      (sum, _, dimension) => sum + (-1) ** dimension * (result.betti[dimension] ?? 0),
      0,
    );
    assert.equal(eulerFaces, eulerBetti, `Euler–Poincaré (seed ${seed})`);
  }
});

test("every persistence representative is a cycle carrying its birth simplex", () => {
  for (const seed of SEEDS) {
    const model = randomModel(seed);
    const complex = buildFilteredComplex(
      createTopologyInput(model, "prop", { maxHomologyDimension: 2, computeRepresentatives: true }),
    );
    const result = computePersistence(complex, {
      metric: "weight",
      modelRevision: model.revision,
      computeRepresentatives: true,
    });
    assert.equal(result.diagnostics.rejectedRepresentativeCount, 0, `withheld a witness (seed ${seed})`);
    const byId = new Map(result.intervals.map((interval) => [interval.id, interval]));
    for (const representative of result.representatives) {
      const chain = Uint32Array.from(representative.simplices.map((key) => complex.order.get(key) as number));
      assert.ok(boundaryIsZero(complex, chain), `∂z≠0 for ${representative.intervalId} (seed ${seed})`);
      assert.ok(
        representative.simplices.includes(byId.get(representative.intervalId)?.birthSimplex ?? ""),
        `witness lost its birth simplex (seed ${seed})`,
      );
    }
  }
});

test("static Betti at each filtration value equals the alive interval count", () => {
  for (const seed of SEEDS) {
    const model = randomModel(seed);
    const input = createTopologyInput(model, "prop", { maxHomologyDimension: 2 });
    const complex = buildFilteredComplex(input);
    const result = computePersistence(complex, {
      metric: "weight",
      modelRevision: model.revision,
      computeRepresentatives: false,
    });

    for (const threshold of [...new Set(complex.simplices.map((simplex) => simplex.value))]) {
      // Build the prefix from the *repaired* values the reduction actually used. Filtering
      // on the raw metric values would disagree with the barcode exactly on the inputs
      // where a coface had to be delayed to keep the sublevel set a complex.
      const prefix = new SimplicialModel();
      input.vertexKeys.forEach((id) => prefix.setNode(id));
      for (const simplex of complex.simplices) {
        if (simplex.dimension === 0 || simplex.value > threshold) continue;
        prefix.addSimplex({ nodes: simplex.vertices.map((index) => input.vertexKeys[index]) });
      }
      const expected = computeBetti(prefix, 2);
      assert.deepEqual(
        bettiAtThreshold(result.intervals, threshold, 2),
        [expected.b0, expected.b1, expected.b2],
        `seed ${seed} at threshold ${threshold}`,
      );
    }
  }
});

test("adding hyperedges alone leaves every simplicial invariant unchanged", () => {
  for (const seed of SEEDS.slice(0, 15)) {
    const model = randomModel(seed);
    const before = JSON.stringify(computeBetti(model, 2).betti);
    const nodes = [...model.nodes.keys()];
    if (nodes.length >= 3) model.addHyperedge({ nodes: nodes.slice(0, 3), label: "encounter", weight: 1 });
    assert.equal(JSON.stringify(computeBetti(model, 2).betti), before, `seed ${seed}`);
  }
});

// --- §7.3 terminology regressions -----------------------------------------
//
// These guard the correction v0.4.5 shipped. A name that overstates what was computed is
// the defect; a test that only checks numbers would not catch it coming back.

test("missing-face explanations never call a motif a Betti number", () => {
  const sources = ["data/explainer.ts", "core/missing-faces.ts", "render/components/holes.ts"];
  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    const strings = [...source.matchAll(/"([^"\\]*)"|`([^`\\]*)`/gu)].map((match) => match[1] ?? match[2] ?? "");
    for (const text of strings) {
      assert.ok(!/β|betti/iu.test(text), `${path} presents a missing face as homology: ${JSON.stringify(text)}`);
    }
  }
});

test("the holonomy report never claims H¹ before a cochain complex exists", () => {
  const source = readFileSync("core/sheaf.ts", "utf8");
  assert.ok(!/\bh1\b/iu.test(source.replace(/obstructionRank/gu, "")), "core/sheaf.ts still names an h1");
  assert.ok(/obstructionRank/u.test(source), "the rank is named as an obstruction rank");
});

test("storage persistence and encounter recurrence are not persistent homology", () => {
  // Three unrelated meanings shared one word before v0.5.0. The type system now keeps
  // them apart; this asserts the vocabulary stayed apart too.
  const intervals = readFileSync("core/topology/persistence-types.ts", "utf8");
  assert.ok(/PersistenceInterval/u.test(intervals));
  assert.ok(
    !/EncounterPersistence|persistenceMode/u.test(intervals),
    "the persistence-interval module must not reference storage or recurrence persistence",
  );

  const storage = readFileSync("data/persistence.ts", "utf8");
  assert.ok(
    !/PersistenceInterval|barcode|persistent homology/iu.test(storage),
    "the storage module must not reference persistent homology",
  );
});
