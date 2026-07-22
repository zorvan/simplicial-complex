import { test } from "node:test";
import { strict as assert } from "node:assert";
import { SimplicialModel } from "../core/model.js";
import { normalizeKey } from "../core/normalize.js";

test("getSimplicesForNode returns every simplex containing a node, including faces", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], userDefined: true });

  const keys = model
    .getSimplicesForNode("a.md")
    .map((simplex) => normalizeKey(simplex.nodes))
    .sort();

  // The 2-simplex plus its two auto-generated edges that touch a.md.
  assert.deepEqual(
    keys,
    [normalizeKey(["a.md", "b.md"]), normalizeKey(["a.md", "b.md", "c.md"]), normalizeKey(["a.md", "c.md"])].sort(),
  );
});

test("getNeighbors reflects simplex membership via the reverse index", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addSimplex({ nodes: ["a.md", "c.md"], userDefined: true });

  assert.deepEqual(model.getNeighbors("a.md").sort(), ["b.md", "c.md"]);
});

test("removeSimplex keeps faces shared with a surviving parent and drops true orphans", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], userDefined: true });
  model.addSimplex({ nodes: ["a.md", "b.md", "d.md"], userDefined: true });

  model.removeSimplex(normalizeKey(["a.md", "b.md", "c.md"]));

  // Shared edge a-b is still a face of the surviving a-b-d simplex.
  assert.equal(model.simplices.has(normalizeKey(["a.md", "b.md"])), true);
  // Edges only owned by the removed triangle are gone.
  assert.equal(model.simplices.has(normalizeKey(["b.md", "c.md"])), false);
  assert.equal(model.simplices.has(normalizeKey(["a.md", "c.md"])), false);
  // The surviving parent and its own faces remain.
  assert.equal(model.simplices.has(normalizeKey(["a.md", "b.md", "d.md"])), true);
});

test("reverse index is invalidated after a node rename", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["old.md", "other.md"], userDefined: true });
  // Prime the index.
  assert.equal(model.getSimplicesForNode("old.md").length, 1);

  model.updateNodeId("old.md", "new.md");

  assert.equal(model.getSimplicesForNode("old.md").length, 0);
  assert.equal(model.getSimplicesForNode("new.md").length, 1);
});
