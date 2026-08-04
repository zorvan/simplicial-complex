import { strict as assert } from "node:assert";
import { test } from "node:test";
import { computeBetti } from "../core/betti.js";
import { buildFiltration } from "../core/filtration.js";
import { findMissingFaces } from "../core/missing-faces.js";
import { SimplicialModel } from "../core/model.js";
import { buildChainComplex, createTopologyInput } from "../core/topology/chain-complex.js";
import { NaiveTopologyChecker } from "../core/topology/naive-checker.js";
import { TsTopologyBackend } from "../core/topology/ts-backend.js";

function modelWith(nodes: string[], maximal: string[][]): SimplicialModel {
  const model = new SimplicialModel();
  nodes.forEach((id) => model.setNode(id));
  maximal.forEach((simplex) => model.addSimplex({ nodes: simplex }));
  return model;
}

const truth: Array<[string, SimplicialModel, [number, number, number]]> = [
  ["empty", modelWith([], []), [0, 0, 0]],
  ["isolated vertices", modelWith(["a", "b", "c"], []), [3, 0, 0]],
  [
    "tree",
    modelWith(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
      ],
    ),
    [1, 0, 0],
  ],
  [
    "square boundary",
    modelWith(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
        ["d", "a"],
      ],
    ),
    [1, 1, 0],
  ],
  [
    "filled disk",
    modelWith(
      ["a", "b", "c", "d"],
      [
        ["a", "b", "c"],
        ["a", "c", "d"],
      ],
    ),
    [1, 0, 0],
  ],
  [
    "wedge of circles",
    modelWith(
      ["a", "b", "c", "d", "e"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["a", "d"],
        ["d", "e"],
        ["e", "a"],
      ],
    ),
    [1, 2, 0],
  ],
  [
    "tetrahedron boundary",
    modelWith(
      ["a", "b", "c", "d"],
      [
        ["a", "b", "c"],
        ["a", "b", "d"],
        ["a", "c", "d"],
        ["b", "c", "d"],
      ],
    ),
    [1, 0, 1],
  ],
  ["filled tetrahedron", modelWith(["a", "b", "c", "d"], [["a", "b", "c", "d"]]), [1, 0, 0]],
  [
    "two circles",
    modelWith(
      ["a", "b", "c", "d", "e", "f"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["d", "e"],
        ["e", "f"],
        ["f", "d"],
      ],
    ),
    [2, 2, 0],
  ],
];

for (const [name, model, expected] of truth) {
  test(`static homology truth fixture: ${name}`, () => {
    const result = computeBetti(model, 2);
    assert.deepEqual([result.b0, result.b1, result.b2], expected);
    const eulerFaces = result.chainDimensions.reduce((sum, count, dimension) => sum + (-1) ** dimension * count, 0);
    const eulerBetti = result.chainDimensions.reduce(
      (sum, _, dimension) => sum + (-1) ** dimension * (result.betti[dimension] ?? 0),
      0,
    );
    assert.equal(eulerFaces, eulerBetti, `Euler–Poincaré on the ${result.maxDimension}-skeleton`);
  });
}

test("one empty triangle is exactly one missing face and enumeration is immutable", () => {
  const model = modelWith(
    ["C", "a", "B"],
    [
      ["C", "a"],
      ["a", "B"],
      ["B", "C"],
    ],
  );
  const before = [...model.simplices.values()].map((simplex) => [...simplex.nodes]);
  assert.equal(findMissingFaces(model, 2).length, 1);
  assert.deepEqual(
    [...model.simplices.values()].map((simplex) => simplex.nodes),
    before,
  );
});

test("square boundary has homology but no triangular missing face", () => {
  const square = truth.find(([name]) => name === "square boundary")![1];
  assert.equal(findMissingFaces(square, 1).length, 0);
  assert.equal(computeBetti(square, 1).b1, 1);
});

test("boundary squared is zero on every truth fixture", () => {
  for (const [, model] of truth) {
    const chain = buildChainComplex(model, 3);
    for (let dimension = 2; dimension <= chain.maxDimension; dimension++) {
      const lower = chain.boundaries[dimension - 2];
      const upper = chain.boundaries[dimension - 1];
      for (const column of upper.data) {
        const parity = new Set<number>();
        column.forEach((face) =>
          lower.data[face].forEach((row) => (parity.has(row) ? parity.delete(row) : parity.add(row))),
        );
        assert.equal(parity.size, 0, `boundary squared in dimension ${dimension}`);
      }
    }
  }
});

test("filtration converts superlevel score and orders faces before tied cofaces", () => {
  const model = modelWith(["a", "b", "c"], []);
  model.addSimplex({ nodes: ["a", "b", "c"], weight: 0.7 });
  const filtration = buildFiltration(model, "weight");
  assert.ok(Math.abs((filtration.at(-1)?.value ?? 0) - 0.3) < 1e-12);
  assert.deepEqual(
    filtration.map((entry) => entry.dimension),
    [1, 1, 1, 2],
  );
});

test("sparse backend agrees with the independent dense checker", async () => {
  for (const [, model] of truth) {
    const input = createTopologyInput(model, "conformance", 2);
    const sparse = await new TsTopologyBackend().computeStatic(input);
    const dense = await new NaiveTopologyChecker().computeStatic(input);
    assert.deepEqual(sparse.betti, dense.betti);
    assert.deepEqual(sparse.boundaryRanks, dense.boundaryRanks);
  }
});
