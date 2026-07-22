import { test } from "node:test";
import { strict as assert } from "node:assert";
import { computeBetti } from "../core/betti.js";
import { SimplicialModel } from "../core/model.js";
import { normalizeKey } from "../core/normalize.js";

test("computeBetti counts connected components as b0", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addSimplex({ nodes: ["c.md", "d.md"], userDefined: true });

  const betti = computeBetti(model, 2);
  assert.equal(betti.b0, 2);
});

test("computeBetti detects an unfilled triangle as a b1 hole", () => {
  const model = new SimplicialModel();
  // Three pairwise edges but no filling 2-simplex.
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addSimplex({ nodes: ["b.md", "c.md"], userDefined: true });
  model.addSimplex({ nodes: ["a.md", "c.md"], userDefined: true });

  const betti = computeBetti(model, 2);
  assert.equal(betti.b1, 1);
  assert.equal(
    betti.holes.some((hole) => hole.dimension === 1),
    true,
  );
});

test("computeBetti suppresses the b1 hole once the triangle is filled", () => {
  const model = new SimplicialModel();
  // Adding the 2-simplex auto-generates its three edges (faces).
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], userDefined: true });

  const betti = computeBetti(model, 2);
  assert.equal(betti.b1, 0);
});

test("computeBetti detects a hollow tetrahedron as a b2 void", () => {
  const model = new SimplicialModel();
  // Four triangular faces of a tetra, but no filling 3-simplex.
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], userDefined: true });
  model.addSimplex({ nodes: ["a.md", "b.md", "d.md"], userDefined: true });
  model.addSimplex({ nodes: ["a.md", "c.md", "d.md"], userDefined: true });
  model.addSimplex({ nodes: ["b.md", "c.md", "d.md"], userDefined: true });

  const betti = computeBetti(model, 2);
  assert.equal(betti.b2, 1);

  // Filling the tetrahedron closes the void.
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md", "d.md"], userDefined: true });
  assert.equal(computeBetti(model, 2).b2, 0);
});

test("computeBetti does not mutate stored simplex node order (regression)", () => {
  const model = new SimplicialModel();
  // Mixed case so canonical order (localeCompare, lowercased) differs from a
  // default UTF-16 .sort(): canonical is ["a.md","B.md"], UTF-16 is ["B.md","a.md"].
  model.addSimplex({ nodes: ["B.md", "a.md", "C.md"], userDefined: true });
  const key = normalizeKey(["B.md", "a.md", "C.md"]);
  const before = [...model.getSimplex(key)!.nodes];

  computeBetti(model, 2);

  assert.deepEqual(model.getSimplex(key)!.nodes, before);
});
