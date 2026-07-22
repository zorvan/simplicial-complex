import { test } from "node:test";
import { strict as assert } from "node:assert";
import { computeFiltrationEvents, getEventThresholds } from "../core/filtration.js";
import { SimplicialModel } from "../core/model.js";
import { normalizeKey } from "../core/normalize.js";

test("computeFiltrationEvents emits component-merge events as edges join components", () => {
  const model = new SimplicialModel();
  // Two separate edges (two components), then an edge that bridges them.
  model.addSimplex({ nodes: ["a.md", "b.md"], weight: 0.9, userDefined: true });
  model.addSimplex({ nodes: ["c.md", "d.md"], weight: 0.8, userDefined: true });
  model.addSimplex({ nodes: ["b.md", "c.md"], weight: 0.5, userDefined: true });

  const events = computeFiltrationEvents(model, "weight");
  const merges = events.filter((event) => event.type === "component-merge");
  // a-b, c-d, and the bridging b-c each drop the component count.
  assert.equal(merges.length, 3);
  // The bridge is the lowest-threshold merge.
  assert.equal(
    merges.some((event) => event.threshold === 0.5),
    true,
  );
});

test("computeFiltrationEvents emits a triangle-close event when a filled triangle appears late", () => {
  const model = new SimplicialModel();
  // Three strong edges, then a weaker filling triangle: the 2-simplex closes the
  // 1-cycle once all of its higher-weight edges already exist.
  model.addSimplex({ nodes: ["a.md", "b.md"], weight: 0.9, userDefined: true });
  model.addSimplex({ nodes: ["b.md", "c.md"], weight: 0.8, userDefined: true });
  model.addSimplex({ nodes: ["a.md", "c.md"], weight: 0.7, userDefined: true });
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], weight: 0.6, userDefined: true });

  const events = computeFiltrationEvents(model, "weight");
  assert.equal(
    events.some((event) => event.type === "triangle-close"),
    true,
  );
});

test("computeFiltrationEvents returns events sorted by descending threshold", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], weight: 0.9, userDefined: true });
  model.addSimplex({ nodes: ["b.md", "c.md"], weight: 0.4, userDefined: true });

  const events = computeFiltrationEvents(model, "weight");
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i - 1].threshold >= events[i].threshold);
  }
});

test("getEventThresholds dedupes and sorts ascending", () => {
  const thresholds = getEventThresholds([
    { threshold: 0.5, type: "edge-appear", nodes: [], description: "" },
    { threshold: 0.5, type: "edge-appear", nodes: [], description: "" },
    { threshold: 0.2, type: "edge-appear", nodes: [], description: "" },
  ]);
  assert.deepEqual(thresholds, [0.2, 0.5]);
});

test("computeFiltrationEvents does not mutate stored simplex node order (regression)", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["B.md", "a.md", "C.md"], weight: 0.7, userDefined: true });
  const key = normalizeKey(["B.md", "a.md", "C.md"]);
  const before = [...model.getSimplex(key)!.nodes];

  computeFiltrationEvents(model, "weight");

  assert.deepEqual(model.getSimplex(key)!.nodes, before);
});
