import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { computeBetti } from "../core/betti.js";
import { SimplicialModel } from "../core/model.js";
import { createTopologyInput } from "../core/topology/chain-complex.js";
import { buildFilteredComplex } from "../core/topology/filtered-complex.js";
import { NaiveTopologyChecker } from "../core/topology/naive-checker.js";
import { computePersistence } from "../core/topology/persistence.js";
import { bettiAtThreshold } from "../core/topology/persistence-types.js";
import { boundaryIsZero } from "../core/topology/representatives.js";
import { TsTopologyBackend } from "../core/topology/ts-backend.js";

interface TruthFixture {
  notes: string;
  nodes: string[];
  simplices: Array<{ nodes: string[]; weight: number }>;
  hyperedges: Array<{ nodes: string[]; weight: number }>;
  betti: [number, number, number];
  intervals: Array<[number, number, number | null]>;
  expectRepairs?: number;
}

const DIRECTORY = "fixtures/topology/truth";

function loadFixtures(): Array<[string, TruthFixture]> {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(`${DIRECTORY}/${name}`, "utf8"))]);
}

function modelOf(fixture: TruthFixture): SimplicialModel {
  const model = new SimplicialModel();
  fixture.nodes.forEach((id) => model.setNode(id));
  fixture.simplices.forEach((simplex) => model.addSimplex(simplex));
  fixture.hyperedges.forEach((hyperedge) => model.addHyperedge(hyperedge));
  return model;
}

const fixtures = loadFixtures();

test("the fixture set covers every complex the plan names", () => {
  const required = [
    "annulus",
    "equal-weight-face-coface",
    "filled-tetrahedron",
    "hyperedge-only-encounter",
    "square-cycle",
    "tetrahedron-boundary",
    "tree",
    "triangulated-disk",
    "two-components",
    "wedge-two-circles",
    "weighted-cycle-born-and-filled",
  ];
  assert.deepEqual(
    fixtures.map(([name]) => name),
    required,
  );
});

for (const [name, fixture] of fixtures) {
  test(`truth fixture ${name}: static Betti numbers`, () => {
    const result = computeBetti(modelOf(fixture), 2);
    assert.deepEqual([result.b0, result.b1, result.b2], fixture.betti, fixture.notes);
  });

  test(`truth fixture ${name}: barcode`, () => {
    const model = modelOf(fixture);
    const input = createTopologyInput(model, name, { maxHomologyDimension: 2, computeRepresentatives: true });
    const complex = buildFilteredComplex(input);
    const result = computePersistence(complex, {
      metric: "weight",
      modelRevision: model.revision,
      computeRepresentatives: true,
    });

    // Compare the visible barcode. Zero-length bars are retained by the reduction for
    // verification and hidden by default in the UI: every vertex is born and immediately
    // merged by the first edge that reaches it, so listing n-1 of them in each fixture
    // would describe the tie policy rather than the vault.
    const actual = result.intervals
      .filter((interval) => interval.lifetime === null || interval.lifetime > 0)
      .map((interval) => [
        interval.dimension,
        round(interval.birth),
        interval.death === null ? null : round(interval.death),
      ]);
    const expected = fixture.intervals.map(([dimension, birth, death]) => [
      dimension,
      round(birth),
      death === null ? null : round(death),
    ]);
    assert.deepEqual(sortIntervals(actual), sortIntervals(expected), fixture.notes);

    assert.equal(
      result.intervals.length - actual.length,
      result.diagnostics.zeroLengthIntervalCount,
      "hidden bars are exactly the zero-length ones the diagnostics counted",
    );

    if (fixture.expectRepairs !== undefined) {
      assert.equal(complex.repairs.length, fixture.expectRepairs, "filtration repairs are reported, not silent");
    }
  });

  test(`truth fixture ${name}: every prefix is a complex and every witness is a cycle`, () => {
    const model = modelOf(fixture);
    const input = createTopologyInput(model, name, { maxHomologyDimension: 2, computeRepresentatives: true });
    const complex = buildFilteredComplex(input);

    for (const simplex of complex.simplices) {
      for (const face of complex.boundaries[simplex.order]) {
        assert.ok(face < simplex.order, `${simplex.key} must follow its face`);
      }
    }

    const result = computePersistence(complex, {
      metric: "weight",
      modelRevision: model.revision,
      computeRepresentatives: true,
    });
    const byId = new Map(result.intervals.map((interval) => [interval.id, interval]));
    for (const representative of result.representatives) {
      const chain = Uint32Array.from(representative.simplices.map((key) => complex.order.get(key) as number));
      assert.ok(boundaryIsZero(complex, chain), `∂z=0 for ${representative.intervalId}`);
      assert.ok(
        representative.simplices.includes(byId.get(representative.intervalId)?.birthSimplex ?? ""),
        "the witness carries the simplex that created the class",
      );
    }
    assert.equal(result.diagnostics.rejectedRepresentativeCount, 0);
  });

  test(`truth fixture ${name}: Betti at each distinct threshold equals the alive bar count`, () => {
    const model = modelOf(fixture);
    const input = createTopologyInput(model, name, { maxHomologyDimension: 2 });
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
      const staticBetti = computeBetti(prefix, 2);
      assert.deepEqual(
        bettiAtThreshold(result.intervals, threshold, 2),
        [staticBetti.b0, staticBetti.b1, staticBetti.b2],
        `${name} at threshold ${threshold}`,
      );
    }
  });

  test(`truth fixture ${name}: the sparse engine agrees with the dense oracle`, async () => {
    const model = modelOf(fixture);
    const input = createTopologyInput(model, name, { maxHomologyDimension: 2 });
    const sparse = await new TsTopologyBackend().computeStatic(input);
    const dense = await new NaiveTopologyChecker().computeStatic(input);
    assert.deepEqual(sparse.betti, dense.betti);
    assert.deepEqual(sparse.boundaryRanks, dense.boundaryRanks);
  });
}

test("relabelling vertices preserves Betti numbers and the interval multiset", () => {
  for (const [name, fixture] of fixtures) {
    const relabelled: TruthFixture = {
      ...fixture,
      nodes: fixture.nodes.map(rename),
      simplices: fixture.simplices.map((simplex) => ({ ...simplex, nodes: simplex.nodes.map(rename) })),
      hyperedges: fixture.hyperedges.map((edge) => ({ ...edge, nodes: edge.nodes.map(rename) })),
    };
    assert.deepEqual(barcodeOf(relabelled, name), barcodeOf(fixture, name), `${name} under relabelling`);
  }
});

function barcodeOf(fixture: TruthFixture, name: string): Array<Array<number | null>> {
  const model = modelOf(fixture);
  const result = computePersistence(
    buildFilteredComplex(createTopologyInput(model, name, { maxHomologyDimension: 2 })),
    { metric: "weight", modelRevision: model.revision, computeRepresentatives: false },
  );
  return sortIntervals(
    result.intervals
      .filter((interval) => interval.lifetime === null || interval.lifetime > 0)
      .map((interval) => [
        interval.dimension,
        round(interval.birth),
        interval.death === null ? null : round(interval.death),
      ]),
  );
}

/** Reverses alphabetical order too, so a sort that leaked into the answer would show. */
function rename(node: string): string {
  return `z${String.fromCharCode(122 - (node.charCodeAt(0) - 97))}`;
}

function sortIntervals(intervals: Array<Array<number | null>>): Array<Array<number | null>> {
  return [...intervals].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
