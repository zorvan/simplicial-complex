import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SimplicialModel } from "../core/model.js";
import { createTopologyInput } from "../core/topology/chain-complex.js";
import { buildFilteredComplex } from "../core/topology/filtered-complex.js";
import { computePersistence } from "../core/topology/persistence.js";
import type { PersistenceResult } from "../core/topology/persistence-types.js";
import { rankPersistentGaps } from "../data/inference/persistent-gaps.js";

/** Mixed-case paths on purpose: real vault paths are not lowercase. */
const PATHS = ["Ideas/Deep Work.md", "Ideas/Attention.md", "Reading/Flow.md", "Projects/Writing.md"];

function vaultModel(): SimplicialModel {
  const model = new SimplicialModel();
  PATHS.forEach((id) => model.setNode(id));
  [
    [PATHS[0], PATHS[1]],
    [PATHS[1], PATHS[2]],
    [PATHS[2], PATHS[3]],
    [PATHS[3], PATHS[0]],
  ].forEach((nodes) => model.addSimplex({ nodes, weight: 1, userDefined: true }));
  return model;
}

function persistenceOf(model: SimplicialModel): PersistenceResult {
  const input = createTopologyInput(model, "gaps", { maxHomologyDimension: 2, computeRepresentatives: true });
  return computePersistence(buildFilteredComplex(input), {
    metric: "weight",
    modelRevision: model.revision,
    computeRepresentatives: true,
  });
}

test("a persistent loop becomes a ranked prompt", () => {
  const model = vaultModel();
  const gaps = rankPersistentGaps(model, persistenceOf(model));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].explanation.kind, "persistent-gap");
  assert.equal(gaps[0].explanation.suggestedAction, "write");
});

test("evidence paths are openable vault paths, not normalized keys", () => {
  const model = vaultModel();
  const [gap] = rankPersistentGaps(model, persistenceOf(model));
  assert.ok(gap);

  for (const path of gap.explanation.evidencePaths) {
    assert.ok(
      model.nodes.has(path),
      `evidencePaths must name real notes; ${JSON.stringify(path)} is not a node in the model`,
    );
  }
  assert.deepEqual([...gap.explanation.evidencePaths].sort(), [...PATHS].sort());
  assert.deepEqual([...gap.nodes].sort(), [...PATHS].sort());
});

test("the witness keys are carried so the canvas highlights the actual cycle", () => {
  const model = vaultModel();
  const result = persistenceOf(model);
  const [gap] = rankPersistentGaps(model, result);
  assert.ok(gap);

  const representative = result.representatives.find((entry) => entry.intervalId === gap.intervalId);
  assert.ok(representative);
  assert.deepEqual(gap.witnessKeys, representative.simplices, "the highlight draws the verified witness itself");
});

test("recurring encounters over the witness raise the recurrence term", () => {
  const withoutEncounter = vaultModel();
  const baseline = rankPersistentGaps(withoutEncounter, persistenceOf(withoutEncounter))[0];

  const withEncounter = vaultModel();
  // An encounter spanning notes *after* the first one alphabetically, so a scan that only
  // looked at nodes[0] would miss it entirely.
  withEncounter.addHyperedge({
    nodes: [PATHS[2], PATHS[3]],
    label: "encounter",
    weight: 1,
    persistence: "recurring",
  });
  const raised = rankPersistentGaps(withEncounter, persistenceOf(withEncounter))[0];

  assert.ok(baseline && raised);
  assert.equal(baseline.explanation.scoreComponents.encounterRecurrence, 0);
  assert.ok(
    raised.explanation.scoreComponents.encounterRecurrence > 0,
    "a recurring encounter over the witness is evidence and must score",
  );
});

test("authored and inferred relations are reported separately", () => {
  const model = vaultModel();
  const [gap] = rankPersistentGaps(model, persistenceOf(model));
  assert.ok(gap);
  assert.equal(gap.explanation.inferredInputs.length, 0, "every relation here was authored");
  assert.equal(gap.explanation.authoredInputs.length, 4);
  assert.equal(gap.explanation.scoreComponents.inferredEdgePenalty, 0);
});

test("a loop the user already synthesized is not proposed again", () => {
  const model = vaultModel();
  model.addSimplex({ nodes: PATHS, weight: 1, userDefined: true });
  assert.deepEqual(rankPersistentGaps(model, persistenceOf(model)), []);
});

test("the score is decomposed and never collapsed into one number", () => {
  const model = vaultModel();
  const [gap] = rankPersistentGaps(model, persistenceOf(model));
  assert.ok(gap);
  const components = Object.keys(gap.explanation.scoreComponents);
  for (const required of ["normalizedLifetime", "crossDomainDiversity", "representativeCompactness"]) {
    assert.ok(components.includes(required), `missing ${required}`);
  }
  assert.ok(!components.includes("significance"));
});

test("uncertainty language never promises a confidence band", () => {
  const model = vaultModel();
  const [gap] = rankPersistentGaps(model, persistenceOf(model));
  assert.ok(gap);
  const text = gap.explanation.uncertainty.join(" ");
  assert.ok(/not canonical/u.test(text), "the non-canonical witness caveat is always present");
  assert.ok(!/confidence (band|interval)/iu.test(text));
});
