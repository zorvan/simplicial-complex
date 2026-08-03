import { test } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeKey, normalizeNodes, parseRelationKey, relationKey } from "../core/normalize.js";
import { SimplicialModel } from "../core/model.js";
import { RelationHistory, deserializeEvent, serializeEvent, syncEncounterPersistence } from "../core/history.js";
import { LayoutEngine } from "../layout/engine.js";
import type { LayoutNode } from "../core/types.js";
import { parseRelations, type ParserDeps } from "../data/parser-core.js";
import {
  parseManagedFrontmatter,
  serializeFrontmatter,
  updateManagedArray,
  type YamlCodec,
} from "../data/frontmatter.js";
import {
  buildIncidenceMatrix,
  crossLayerMap,
  edgeSizes,
  nodeDegrees,
  pairwiseCooccurrence,
} from "../core/incidence.js";
import {
  closureDeficit,
  encounterDiagnostics,
  encounterVitality,
  faceIndependence,
  hypergraphComponents,
  overlapPressure,
  simpliciality,
} from "../core/diagnostics.js";
import { explainEncounter, explainSimpliciality } from "../data/explainer.js";
import { suggestEncounters } from "../data/inference/encounters.js";
import { PULSE_PERIOD_MS, encounterStyle, pulsePhase, pulsedNodeRadius } from "../render/encounter-style.js";
import {
  ActivationState,
  DEFAULT_SOURCE_WEIGHTS,
  KERNEL_NAMES,
  competingRhythms,
  createKernel,
  kernelGroups,
  orderParameter,
  propagate,
  synchronizationTime,
  synchronizationTimeSliced,
  type ActivationField,
} from "../core/activation.js";
import { frac, fromNumbers, nullspace, rank, sheafLaplacian, solve } from "../core/linalg.js";
import {
  analyzeSheaf,
  backfillSection,
  contextOverlaps,
  contextSupport,
  contextualFraction,
  restrict,
  suggestRoleRefinements,
  type LocalSection,
  type SheafContext,
  type SheafData,
  type SheafRole,
} from "../core/sheaf.js";
import { migrateSettings } from "../core/settings.js";
import { SheafScratch } from "../core/sheaf-workflow.js";

// ---------------------------------------------------------------------------
// HG-01 — namespaced relation keys
// ---------------------------------------------------------------------------

test("relationKey round-trips through parseRelationKey", () => {
  const key = relationKey("hyperedge", ["Levinas.md", "AI Agent.md", "refusal.md"]);
  const parsed = parseRelationKey(key);
  assert.ok(parsed);
  assert.equal(parsed!.kind, "hyperedge");
  assert.equal(parsed!.nodeKey, normalizeKey(["Levinas.md", "AI Agent.md", "refusal.md"]));
});

test("a simplex and a hyperedge over the same nodes produce distinct keys", () => {
  const nodes = ["a.md", "b.md", "c.md"];
  assert.notEqual(relationKey("simplex", nodes), relationKey("hyperedge", nodes));
  assert.notEqual(relationKey("hyperedge", nodes), normalizeKey(nodes));
});

test("parseRelationKey rejects bare simplex keys", () => {
  assert.equal(parseRelationKey(normalizeKey(["a.md", "b.md"])), null);
  assert.equal(parseRelationKey("x:a.md|b.md"), null);
});

// ---------------------------------------------------------------------------
// HG-02 — the hyperedge store cannot leak into the simplicial layer
// ---------------------------------------------------------------------------

test("adding a hyperedge leaves the simplicial layer untouched", () => {
  const model = new SimplicialModel();
  const before = model.simplices.size;
  const key = model.addHyperedge({ nodes: ["levinas.md", "ai-agent.md", "refusal.md"] });

  assert.equal(model.simplices.size, before);
  assert.equal(model.hyperedges.size, 1);
  assert.ok(model.getHyperedge(key));
  // No faces: none of the three pairs exists as a simplex.
  assert.equal(model.simplices.has(normalizeKey(["levinas.md", "ai-agent.md"])), false);
  assert.equal(model.simplices.has(normalizeKey(["levinas.md", "refusal.md"])), false);
  assert.equal(model.simplices.has(normalizeKey(["ai-agent.md", "refusal.md"])), false);
});

test("addSimplex refuses an object tagged as a hyperedge", () => {
  const model = new SimplicialModel();
  const key = model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], kind: "hyperedge" } as never);

  assert.equal(key, "");
  assert.equal(model.simplices.size, 0);
});

test("hyperedges do not perturb Betti numbers", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addSimplex({ nodes: ["b.md", "c.md"], userDefined: true });
  model.addSimplex({ nodes: ["a.md", "c.md"], userDefined: true });
  const before = model.getCachedBetti();
  assert.ok(before.b1 > 0, "three edges with no filling triangle leaves an unfilled cycle");

  model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"], label: "irreducible encounter" });
  const after = model.getCachedBetti();

  assert.deepEqual(
    { b0: after.b0, b1: after.b1, b2: after.b2 },
    { b0: before.b0, b1: before.b1, b2: before.b2 },
    "an encounter over the triad does not fill the hole — only a simplex does",
  );
});

test("inferred hyperedges never generate faces or alter Betti values", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addSimplex({ nodes: ["b.md", "c.md"], userDefined: true });
  model.addSimplex({ nodes: ["a.md", "c.md"], userDefined: true });
  const before = model.getCachedBetti();
  model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"], inferred: true, confidence: 0.9 });
  assert.equal(model.simplices.has(normalizeKey(["a.md", "b.md", "c.md"])), false);
  assert.deepEqual(model.getCachedBetti(), before);
});

test("settings saved before inferenceEmits migrate to the simplex compatibility default", () => {
  const defaults = { inferenceEmits: "simplex" as const, showHyperedges: true, opacity: 0.55 };
  const migrated = migrateSettings(defaults, { showHyperedges: false });
  assert.equal(migrated.inferenceEmits, "simplex");
  assert.equal(migrated.showHyperedges, false);
});

test("Contextuality Lab scratch actions persist only on acceptance and discard explicitly", () => {
  const sections: Record<string, Record<string, SheafRole>> = { c1: {} };
  const scratch = new SheafScratch();
  scratch.set({ contextId: "c1", nodeId: "a.md", role: "research" });
  scratch.set({ contextId: "c2", nodeId: "b.md", role: "project" });
  assert.deepEqual(sections, { c1: {} }, "preview does not mutate persisted plugin data");
  scratch.discard();
  assert.equal(scratch.list().length, 0);
  scratch.set({ contextId: "c1", nodeId: "a.md", role: "idea" });
  assert.equal(scratch.accept(sections).length, 1);
  assert.equal(sections.c1["a.md"], "idea");
  assert.equal(scratch.list().length, 0);
});

test("removeNode drops every hyperedge the node participated in", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  model.addHyperedge({ nodes: ["d.md", "e.md"] });

  model.removeNode("b.md");

  assert.equal(model.hyperedges.size, 1);
  assert.equal(model.getHyperedgesForNode("a.md").length, 0);
});

test("updateNodeId rewrites hyperedge membership and rekeys it", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["old.md", "other.md"], label: "encounter" });

  model.updateNodeId("old.md", "new.md");

  assert.equal(model.hyperedges.has(relationKey("hyperedge", ["new.md", "other.md"])), true);
  assert.equal(model.hyperedges.has(relationKey("hyperedge", ["old.md", "other.md"])), false);
  assert.equal(model.getHyperedgesForNode("new.md")[0].label, "encounter");
});

test("replaceSourceRelations clears both layers for the path it owns", () => {
  const model = new SimplicialModel();
  model.replaceSourceRelations(
    "note.md",
    [{ nodes: ["a.md", "b.md"], userDefined: true }],
    [{ nodes: ["c.md", "d.md", "e.md"] }],
  );
  assert.equal(model.hyperedges.size, 1);

  model.replaceSourceRelations("note.md", [], []);

  assert.equal(model.hyperedges.size, 0);
  assert.equal(
    [...model.simplices.values()].filter((simplex) => simplex.sourcePath === "note.md" && !simplex.autoGenerated)
      .length,
    0,
  );
});

test("getAllRelations tags each layer with its kind", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addHyperedge({ nodes: ["a.md", "b.md"] });

  const relations = model.getAllRelations();
  const kinds = relations.map((entry) => entry.relation.kind).sort();

  assert.deepEqual(kinds, ["hyperedge", "simplex"]);
  assert.equal(new Set(relations.map((entry) => entry.key)).size, 2, "same nodes, two distinct keys");
});

test("replacing inferred encounters preserves authored encounters and simplicial topology", () => {
  const model = new SimplicialModel();
  ["d.md", "e.md", "f.md", "g.md", "h.md", "i.md"].forEach((nodeId) => model.setNode(nodeId));
  const authored = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"], label: "authored" });
  model.addSimplex({ nodes: ["x.md", "y.md"], userDefined: true });
  const before = model.getCachedBetti();

  model.replaceInferredHyperedges([
    { nodes: ["d.md", "e.md", "f.md"], inferred: true, suggested: true, confidence: 0.8 },
  ]);
  model.replaceInferredHyperedges([
    { nodes: ["g.md", "h.md", "i.md"], inferred: true, suggested: true, confidence: 0.9 },
  ]);

  assert.equal(model.getHyperedge(authored)?.label, "authored");
  assert.equal(model.getHyperedge(relationKey("hyperedge", ["d.md", "e.md", "f.md"])), undefined);
  assert.ok(model.getHyperedge(relationKey("hyperedge", ["g.md", "h.md", "i.md"])));
  assert.equal(model.simplices.has(normalizeKey(["g.md", "h.md", "i.md"])), false);
  assert.deepEqual(model.getCachedBetti(), before);
});

// ---------------------------------------------------------------------------
// HG-03 — incidence matrix and cross-layer map
// ---------------------------------------------------------------------------

test("incidence matrix matches a brute-force reference", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  model.addHyperedge({ nodes: ["c.md", "d.md"] });

  const incidence = buildIncidenceMatrix(model);

  incidence.nodes.forEach((nodeId, row) => {
    incidence.edges.forEach((edgeKey, column) => {
      const expected = model.getHyperedge(edgeKey)!.nodes.includes(nodeId) ? 1 : 0;
      assert.equal(incidence.matrix[row * incidence.edges.length + column], expected, `${nodeId} × ${edgeKey}`);
    });
  });

  assert.equal(nodeDegrees(incidence).get("c.md"), 2);
  assert.equal(nodeDegrees(incidence).get("a.md"), 1);
  assert.equal(edgeSizes(incidence).get(relationKey("hyperedge", ["a.md", "b.md", "c.md"])), 3);
});

test("pairwise co-occurrence counts shared encounters without asserting the pairs", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  model.addHyperedge({ nodes: ["a.md", "b.md"] });

  const counts = pairwiseCooccurrence(model);

  assert.equal(counts.get(normalizeKey(["a.md", "b.md"])), 2);
  assert.equal(counts.get(normalizeKey(["a.md", "c.md"])), 1);
  assert.equal(model.simplices.size, 0, "co-occurrence is a measurement, not a mutation");
});

test("cross-layer map separates present from missing implied faces", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });

  const map = crossLayerMap(model);
  const entry = map.hyperedges.get(key)!;

  assert.equal(entry.unbounded, false);
  // Implied: {a,b}, {a,c}, {b,c}, {a,b,c} — 2^3 − 3 − 1 = 4.
  assert.equal(entry.impliedFaceCount, 4);
  assert.deepEqual(entry.presentFaces, [normalizeKey(["a.md", "b.md"])]);
  assert.equal(entry.missingFaces.length, 3);
  assert.deepEqual(map.simplexCoveredBy.get(normalizeKey(["a.md", "b.md"])), [key]);
});

test("cross-layer map refuses to enumerate an oversized encounter", () => {
  const model = new SimplicialModel();
  const nodes = Array.from({ length: 12 }, (_, index) => `n${index}.md`);
  const key = model.addHyperedge({ nodes });

  const entry = crossLayerMap(model).hyperedges.get(key)!;

  assert.equal(entry.unbounded, true);
  assert.equal(entry.missingFaces.length, 0);
  assert.equal(entry.impliedFaceCount, Number.POSITIVE_INFINITY);
});

test("cross-layer cache invalidates on relation mutation", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  assert.equal(crossLayerMap(model).hyperedges.get(key)!.presentFaces.length, 0);

  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });

  assert.equal(crossLayerMap(model).hyperedges.get(key)!.presentFaces.length, 1);
});

// ---------------------------------------------------------------------------
// HG-04 — ◇ syntax, hyperedges: frontmatter, and the frontmatter/inline merge
// ---------------------------------------------------------------------------

/** Identity resolution plus a JSON stand-in for Obsidian's YAML, which tests cannot load. */
function parserDeps(frontmatter: Record<string, unknown> | null = null): ParserDeps {
  return {
    canonicalize: (rawId) => rawId.trim(),
    parseYaml: () => frontmatter,
  };
}

test("◇ produces a hyperedge and generates no faces", () => {
  const parsed = parseRelations("◇ Levinas AI-Agent refusal\n", "note.md", parserDeps());

  assert.equal(parsed.simplices.length, 0);
  assert.equal(parsed.hyperedges.length, 1);
  assert.deepEqual(parsed.hyperedges[0].nodes, normalizeNodes(["Levinas", "AI-Agent", "refusal"]));

  const model = new SimplicialModel();
  model.replaceSourceRelations("note.md", parsed.simplices, parsed.hyperedges);
  assert.equal(model.simplices.size, 0, "an encounter creates no faces");
});

test("hyperedge arity is unbounded, unlike △ and △△", () => {
  const parsed = parseRelations("◇ a b c d e f g\n△ a b c d e f g\n", "note.md", parserDeps());

  assert.equal(parsed.hyperedges[0].nodes.length, 7);
  assert.equal(parsed.simplices[0].nodes.length, 3, "△ still takes exactly three");
});

test("encounter: and hyperedge: are accepted as prose aliases for ◇", () => {
  const parsed = parseRelations("encounter: a b c\nhyperedge: d e\n", "note.md", parserDeps());

  assert.equal(parsed.hyperedges.length, 2);
});

test("frontmatter and inline markers merge instead of the frontmatter winning outright", () => {
  const content = ["---", "simplices: []", "hyperedges: []", "---", "", "△ x y z", "◇ p q r", ""].join("\n");
  const frontmatter = {
    simplices: [{ nodes: ["Levinas", "responsibility", "Other"], label: "ethical responsibility" }],
    hyperedges: [{ nodes: ["Levinas", "AI Agent", "refusal"], label: "unmandated interruption", mode: "encounter" }],
  };

  const parsed = parseRelations(content, "note.md", parserDeps(frontmatter));

  assert.equal(parsed.simplices.length, 2, "frontmatter simplex plus the inline △ — the old code dropped the latter");
  assert.equal(parsed.hyperedges.length, 2);
  assert.equal(parsed.hyperedges[0].label, "unmandated interruption");
  assert.equal(parsed.hyperedges[0].mode, "encounter");
});

test("dedupe is per kind, so a simplex and an encounter over the same nodes both survive", () => {
  const content = ["---", "x: y", "---", "△ a b c", "◇ a b c", "◇ a b c"].join("\n");

  const parsed = parseRelations(content, "note.md", parserDeps({ x: "y" }));

  assert.equal(parsed.simplices.length, 1);
  assert.equal(parsed.hyperedges.length, 1, "identical encounters in one note collapse");
  assert.deepEqual(parsed.simplices[0].nodes, parsed.hyperedges[0].nodes);
});

// ---------------------------------------------------------------------------
// HG-05 / HG-06 — persistence and back-compat
// ---------------------------------------------------------------------------

const jsonYaml: YamlCodec = {
  parse: (source) => JSON.parse(source) as Record<string, unknown>,
  stringify: (value) => JSON.stringify(value),
};

test("hyperedge write-back leaves unrelated frontmatter keys untouched", () => {
  const original = {
    title: "Encounters",
    tags: ["philosophy", "ai"],
    aliases: ["the refusal note"],
    cssclass: "wide",
    simplices: [{ nodes: ["a.md", "b.md"] }],
  };
  const content = `---\n${JSON.stringify(original)}\n---\nbody text\n`;

  const { frontmatter, body } = parseManagedFrontmatter(content, jsonYaml);
  updateManagedArray(frontmatter, "hyperedges", normalizeKey(["c.md", "d.md"]), {
    nodes: ["c.md", "d.md"],
    mode: "encounter",
  });

  assert.equal(frontmatter.title, "Encounters");
  assert.deepEqual(frontmatter.tags, ["philosophy", "ai"]);
  assert.deepEqual(frontmatter.aliases, ["the refusal note"]);
  assert.equal(frontmatter.cssclass, "wide");
  assert.deepEqual(frontmatter.simplices, [{ nodes: ["a.md", "b.md"] }], "the other layer is not disturbed");
  assert.equal(body, "body text\n");
});

test("writing a hyperedge does not stamp an empty simplices array onto a note that never had one", () => {
  const content = `---\n${JSON.stringify({ title: "Plain note" })}\n---\nbody\n`;

  const { frontmatter } = parseManagedFrontmatter(content, jsonYaml);
  updateManagedArray(frontmatter, "hyperedges", normalizeKey(["a.md", "b.md"]), { nodes: ["a.md", "b.md"] });

  assert.equal(Object.prototype.hasOwnProperty.call(frontmatter, "simplices"), false);
  assert.deepEqual(frontmatter.hyperedges, [{ nodes: ["a.md", "b.md"] }]);
});

test("managed array update replaces the matching entry rather than appending a duplicate", () => {
  const frontmatter: Record<string, unknown> = {
    hyperedges: [
      { nodes: ["a.md", "b.md"], label: "first" },
      { nodes: ["c.md", "d.md"], label: "other" },
    ],
  };

  updateManagedArray(frontmatter, "hyperedges", normalizeKey(["b.md", "a.md"]), {
    nodes: ["a.md", "b.md"],
    label: "second",
  });

  const entries = frontmatter.hyperedges as Array<Record<string, unknown>>;
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => (entry.nodes as string[])[0] === "a.md")!.label, "second");
});

test("a hyperedge survives serialize → parse → model round-trip with its metadata", () => {
  const frontmatter: Record<string, unknown> = {};
  updateManagedArray(frontmatter, "hyperedges", normalizeKey(["levinas.md", "refusal.md"]), {
    nodes: ["levinas.md", "refusal.md"],
    label: "unmandated ethical interruption",
    mode: "encounter",
    occurredAt: 1700000000000,
    persistence: "momentary",
  });
  const written = serializeFrontmatter(frontmatter, "body\n", jsonYaml);

  const parsed = parseRelations(written, "note.md", {
    canonicalize: (rawId) => rawId.trim(),
    parseYaml: (source) => JSON.parse(source) as Record<string, unknown>,
  });

  assert.equal(parsed.hyperedges.length, 1);
  assert.equal(parsed.hyperedges[0].label, "unmandated ethical interruption");
  assert.equal(parsed.hyperedges[0].mode, "encounter");
  assert.equal(parsed.hyperedges[0].occurredAt, 1700000000000);

  const model = new SimplicialModel();
  model.replaceSourceRelations("note.md", parsed.simplices, parsed.hyperedges);
  const restored = model.getHyperedge(relationKey("hyperedge", ["levinas.md", "refusal.md"]));
  assert.equal(restored!.mode, "encounter");
  assert.equal(model.simplices.size, 0);
});

// ---------------------------------------------------------------------------
// HG-30 — append-only relation event log
// ---------------------------------------------------------------------------

test("the event log is append-only: recorded events cannot be mutated or dropped", () => {
  const history = new RelationHistory();
  const event = history.append({ type: "encountered", kind: "hyperedge", nodes: ["a.md", "b.md"], actor: "user" });

  assert.throws(() => {
    (event as { timestamp: number }).timestamp = 0;
  }, TypeError);

  const copy = history.all();
  copy.length = 0;
  copy.push(event);
  assert.equal(history.size, 1, "callers get a defensive copy, not the log itself");
});

test("promote → relax → promote leaves three events and a reconstructible history", () => {
  const history = new RelationHistory();
  const nodes = ["a.md", "b.md", "c.md"];
  history.append({ type: "encountered", kind: "hyperedge", nodes, actor: "user", timestamp: 1 });
  history.append({ type: "promoted", kind: "hyperedge", nodes, actor: "user", timestamp: 2 });
  history.append({ type: "relaxed", kind: "simplex", nodes, actor: "user", timestamp: 3 });
  history.append({ type: "promoted", kind: "hyperedge", nodes, actor: "user", timestamp: 4 });

  const thread = history.forNodes(nodes);

  assert.deepEqual(
    thread.map((event) => event.type),
    ["encountered", "promoted", "relaxed", "promoted"],
    "both kinds share a node key, so the thread reads as one journey",
  );
});

test("dissolving a relation does not dissolve its history", () => {
  const model = new SimplicialModel();
  const history = new RelationHistory();
  const nodes = ["a.md", "b.md"];
  const key = model.addHyperedge({ nodes });
  history.append({ type: "encountered", kind: "hyperedge", nodes, actor: "user" });

  model.removeHyperedge(key);
  history.append({ type: "dissolved", kind: "hyperedge", nodes, actor: "user" });

  assert.equal(model.hyperedges.size, 0);
  assert.equal(history.forNodes(nodes).length, 2);
});

test("events survive serialization round-trip", () => {
  const history = new RelationHistory();
  history.append({
    type: "crystallized",
    kind: "hyperedge",
    nodes: ["a.md", "b.md"],
    actor: "user",
    timestamp: 1700000000000,
    detail: { conceptNote: "concept.md" },
  });

  const restored = new RelationHistory();
  restored.load(history.all().map((event) => deserializeEvent(serializeEvent(event))!));

  assert.equal(restored.size, 1);
  assert.equal(restored.all()[0].type, "crystallized");
  assert.equal(restored.all()[0].detail!.conceptNote, "concept.md");
  assert.equal(restored.all()[0].relationKey, relationKey("hyperedge", ["a.md", "b.md"]));
});

test("deserializeEvent rejects junk lines rather than inventing history", () => {
  assert.equal(deserializeEvent("not json"), null);
  assert.equal(deserializeEvent('{"t":1,"e":"invented","k":"hyperedge","n":["a.md"]}'), null);
  assert.equal(deserializeEvent('{"e":"created","k":"simplex","n":["a.md"]}'), null);
});

test("journey replay reconstructs relations at each lifecycle timestamp", () => {
  const history = new RelationHistory();
  const nodes = ["a.md", "b.md", "c.md"];
  history.append({ type: "encountered", kind: "hyperedge", nodes, actor: "user", timestamp: 10 });
  history.append({ type: "promoted", kind: "hyperedge", nodes, actor: "user", timestamp: 20 });
  history.append({ type: "relaxed", kind: "simplex", nodes, actor: "user", timestamp: 30 });
  history.append({ type: "promoted", kind: "hyperedge", nodes, actor: "user", timestamp: 40 });

  assert.equal(history.replayAt(10).hyperedges.size, 1);
  assert.equal(history.replayAt(10).simplices.size, 0);
  assert.equal(history.replayAt(20).simplices.size, 1);
  assert.equal(history.replayAt(30).simplices.size, 0);
  assert.equal(history.replayAt(40).simplices.size, 1);
});

test("consequence lineage survives event serialization and reload", () => {
  const nodes = ["a.md", "b.md"];
  const original = new RelationHistory();
  original.append({
    type: "crystallized",
    kind: "hyperedge",
    nodes,
    actor: "user",
    timestamp: 50,
    detail: { conceptNote: "concept.md" },
  });
  const restored = new RelationHistory();
  restored.load(original.all().map((event) => deserializeEvent(serializeEvent(event))!));

  const fromEncounter = restored.lineageFor(relationKey("hyperedge", nodes));
  const fromNote = restored.lineageFor("concept.md");
  assert.equal(fromEncounter[0].target, "n:concept.md");
  assert.deepEqual(fromNote, fromEncounter);
});

// ---------------------------------------------------------------------------
// HG-13 (derived) — recurrence
// ---------------------------------------------------------------------------

test("a configuration encountered three times becomes recurring", () => {
  const model = new SimplicialModel();
  const history = new RelationHistory();
  const nodes = ["a.md", "b.md", "c.md"];
  model.addHyperedge({ nodes });

  history.append({ type: "encountered", kind: "hyperedge", nodes, actor: "user", timestamp: 1 });
  syncEncounterPersistence(model, history, 3);
  assert.equal(model.getHyperedge(relationKey("hyperedge", nodes))!.persistence, "momentary");

  history.append({ type: "recurred", kind: "hyperedge", nodes, actor: "user", timestamp: 2 });
  history.append({ type: "recurred", kind: "hyperedge", nodes, actor: "user", timestamp: 3 });
  syncEncounterPersistence(model, history, 3);

  const hyperedge = model.getHyperedge(relationKey("hyperedge", nodes))!;
  assert.equal(hyperedge.persistence, "recurring");
  assert.deepEqual(hyperedge.occurrences, [1, 2, 3]);
  assert.equal(model.simplices.size, 0, "recurrence is evidence, not proof — nothing was promoted");
});

// ---------------------------------------------------------------------------
// HG-07 / HG-08 / HG-09 / HG-10 — the four transformations
// ---------------------------------------------------------------------------

test("promotion creates the simplex and its faces, and keeps the encounter as provenance", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"], label: "triad" });

  const planned = model.facesImpliedByPromotion(key);
  const result = model.promoteToSimplex(key)!;

  assert.equal(planned.length, 3, "the confirmation list matches what generateFaces will do");
  assert.equal(result.createdFaces.length, 3);
  assert.equal(model.simplices.has(normalizeKey(["a.md", "b.md", "c.md"])), true);
  assert.equal(model.simplices.has(normalizeKey(["a.md", "b.md"])), true);
  assert.equal(model.simplices.has(normalizeKey(["b.md", "c.md"])), true);
  assert.equal(model.getHyperedge(key)!.promotedTo, result.simplexKey, "the encounter is retained, marked promoted");
});

test("promotion recomputes Betti — the asserted triangle fills the hole", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addSimplex({ nodes: ["b.md", "c.md"], userDefined: true });
  model.addSimplex({ nodes: ["a.md", "c.md"], userDefined: true });
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  assert.ok(model.getCachedBetti().b1 > 0);

  model.promoteToSimplex(key);

  assert.equal(model.getCachedBetti().b1, 0);
});

test("promote then relax returns to the pre-promote state, keeping provenance", () => {
  const model = new SimplicialModel();
  const nodes = ["a.md", "b.md", "c.md"];
  const key = model.addHyperedge({ nodes, label: "triad" });
  const simplicesBefore = model.simplices.size;

  const promoted = model.promoteToSimplex(key)!;
  const relaxedKey = model.relaxToHyperedge(promoted.simplexKey);

  assert.equal(relaxedKey, key);
  assert.equal(model.simplices.size, simplicesBefore, "the asserted faces are withdrawn with the claim");
  assert.equal(model.hyperedges.size, 1);
  assert.equal(model.getHyperedge(key)!.promotedTo, undefined);
  assert.equal(model.getHyperedge(key)!.label, "triad");
});

test("relaxing does not delete faces an unrelated simplex still asserts", () => {
  const model = new SimplicialModel();
  // An independent user-defined simplex over {a,b} — nobody else's claim to withdraw.
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true, label: "independent" });
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  const promoted = model.promoteToSimplex(key)!;

  model.relaxToHyperedge(promoted.simplexKey);

  assert.equal(model.simplices.has(normalizeKey(["a.md", "b.md"])), true, "the independent edge survives");
  assert.equal(model.simplices.get(normalizeKey(["a.md", "b.md"]))!.label, "independent");
  assert.equal(model.simplices.has(normalizeKey(["a.md", "c.md"])), false, "faces created by the promotion are gone");
  assert.equal(model.simplices.has(normalizeKey(["a.md", "b.md", "c.md"])), false);
});

test("relax preserves the original encounter time — relaxing is not a new encounter", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md"], occurredAt: 1234 });
  const promoted = model.promoteToSimplex(key)!;

  model.relaxToHyperedge(promoted.simplexKey);

  assert.equal(model.getHyperedge(key)!.occurredAt, 1234);
});

test("relax refuses auto-generated faces", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], userDefined: true });
  const faceKey = normalizeKey(["a.md", "b.md"]);
  assert.equal(model.simplices.get(faceKey)!.autoGenerated, true);

  assert.equal(model.relaxToHyperedge(faceKey), null);
});

test("crystallize wires the concept node and leaves the encounter unpromoted", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"], persistence: "recurring" });

  const ok = model.crystallizeHyperedge(key, "concept.md");

  assert.equal(ok, true);
  assert.equal(model.nodes.has("concept.md"), true);
  assert.equal(model.getHyperedge(key)!.crystallizedInto, "concept.md");
  assert.equal(model.getHyperedge(key)!.promotedTo, undefined, "repetition is evidence, not proof");
  assert.equal(model.simplices.size, 0);
});

test("no code path promotes without an explicit call — recurrence alone never does", () => {
  const model = new SimplicialModel();
  const history = new RelationHistory();
  const nodes = ["a.md", "b.md", "c.md"];
  const key = model.addHyperedge({ nodes });

  for (let i = 0; i < 10; i++) {
    history.append({ type: "recurred", kind: "hyperedge", nodes, actor: "user", timestamp: i + 1 });
    syncEncounterPersistence(model, history, 3);
  }
  model.crystallizeHyperedge(key, "concept.md");

  assert.equal(model.getHyperedge(key)!.persistence, "recurring");
  assert.equal(model.simplices.size, 0, "ten recurrences and a crystallization still assert no faces");
  assert.equal(model.getHyperedge(key)!.promotedTo, undefined);
});

// ---------------------------------------------------------------------------
// HG-16 — rendering and layout
// ---------------------------------------------------------------------------

function layoutNode(id: string, px: number, py: number): LayoutNode {
  return { id, px, py, vx: 0, vy: 0, isVirtual: false, isPinned: false, displayAlpha: 1 };
}

test("an encounter draws its members together without creating pairwise springs", () => {
  const engine = new LayoutEngine();
  engine.configure({ noiseAmount: 0, repulsionStrength: 0, gravityStrength: 0, dampingFactor: 1 });
  const nodes = [layoutNode("a.md", -200, 0), layoutNode("b.md", 200, 0), layoutNode("c.md", 0, 200)];
  const spread = (list: LayoutNode[]) =>
    Math.max(...list.map((node) => Math.hypot(node.px, node.py - 200 / 3))) -
    Math.min(...list.map((node) => Math.hypot(node.px, node.py - 200 / 3)));
  const before = spread(nodes);

  for (let i = 0; i < 60; i++) {
    engine.tick(nodes, [], { width: 800, height: 600 }, null, [{ nodes: ["a.md", "b.md", "c.md"] }]);
  }

  const distance = Math.hypot(nodes[0].px - nodes[1].px, nodes[0].py - nodes[1].py);
  assert.ok(distance < 400, "members converge toward a shared centroid");
  assert.ok(spread(nodes) <= before + 1, "and do so as a group, not as three springs");
});

test("hyperedge order is not capped by maxRenderedDim — it is not a dimension", () => {
  const model = new SimplicialModel();
  const nodes = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"];
  const key = model.addHyperedge({ nodes });

  assert.equal(model.getHyperedge(key)!.nodes.length, 6);
  // The simplicial layer would have refused to expand this; the hypergraph does not care.
  assert.equal(model.simplices.size, 0);
});

// ---------------------------------------------------------------------------
// HG-23 — the governing invariant, asserted after every public mutation
// ---------------------------------------------------------------------------

test("no hyperedge ever appears in model.simplices, whatever the mutation sequence", () => {
  const model = new SimplicialModel();
  const hyperedgeNodeKeys = new Set<string>();
  const assertNoLeak = (step: string) => {
    hyperedgeNodeKeys.forEach((nodeKey) => {
      const simplex = model.simplices.get(nodeKey);
      // A simplex over the same nodes is legal — but only when promotion put it there.
      if (!simplex) return;
      assert.equal(simplex.userDefined, true, `${step}: an encounter leaked into the simplicial layer`);
    });
    model.hyperedges.forEach((hyperedge) => {
      assert.equal(
        (hyperedge as { autoGenerated?: boolean }).autoGenerated,
        undefined,
        `${step}: an encounter grew a face flag`,
      );
    });
  };

  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  hyperedgeNodeKeys.add(normalizeKey(["a.md", "b.md", "c.md"]));
  assert.equal(model.simplices.size, 0, "addHyperedge generated a face");
  assertNoLeak("addHyperedge");

  model.updateHyperedge(key, { label: "renamed" });
  assert.equal(model.simplices.size, 0);
  assertNoLeak("updateHyperedge");

  model.setNode("d.md");
  assert.equal(model.simplices.size, 0);
  assertNoLeak("setNode");

  model.replaceInferredSimplices([{ nodes: ["a.md", "d.md"], inferred: true }]);
  assertNoLeak("replaceInferredSimplices");

  model.updateNodeId("d.md", "e.md");
  assertNoLeak("updateNodeId");

  model.crystallizeHyperedge(key, "concept.md");
  assert.equal(model.simplices.has(normalizeKey(["a.md", "b.md", "c.md"])), false);
  assertNoLeak("crystallizeHyperedge");

  model.removeHyperedge(key);
  assertNoLeak("removeHyperedge");
});

// ---------------------------------------------------------------------------
// HG-11 — closure deficit and simpliciality
// ---------------------------------------------------------------------------

test("closure deficit counts every implied relation, including the full set", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });

  const empty = closureDeficit(model, key);
  assert.ok(empty);
  // 2^3 − 3 − 1 = 4: the three pairs plus the triple itself.
  assert.equal(empty!.impliedFaceCount, 4);
  assert.equal(empty!.missingCount, 4);
  assert.equal(empty!.deficit, 1);

  // A 2-node simplex generates no faces of its own, so this adds exactly one.
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  const partial = closureDeficit(model, key);
  assert.equal(partial!.missingCount, 3);
  assert.equal(partial!.deficit, 0.75);
});

test("promoting an encounter drives its closure deficit to zero", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  model.promoteToSimplex(key);
  assert.equal(closureDeficit(model, key)!.deficit, 0);
});

test("a large encounter reports an unbounded deficit instead of enumerating 2^n faces", () => {
  const model = new SimplicialModel();
  const nodes = Array.from({ length: 12 }, (_, index) => `n${index}.md`);
  const started = Date.now();
  const key = model.addHyperedge({ nodes });
  const result = closureDeficit(model, key);

  assert.ok(result);
  assert.equal(result!.unbounded, true);
  assert.equal(result!.deficit, null, "an unmeasured deficit must not be reported as a number");
  assert.equal(result!.missingFaces.length, 0);
  assert.ok(Date.now() - started < 1000, "enumerating a 12-node encounter should never be attempted");
});

test("simpliciality is one minus the mean measurable deficit, and splits by component", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addHyperedge({ nodes: ["x.md", "y.md"] });

  // {a,b,c}: 3 of 4 missing = 0.75. {x,y}: 2^2 − 2 − 1 = 1 implied, missing = 1.0.
  const measure = simpliciality(model);
  assert.equal(measure.measuredEncounters, 2);
  assert.equal(measure.unboundedEncounters, 0);
  assert.ok(Math.abs(measure.value! - (1 - (0.75 + 1) / 2)) < 1e-9);

  assert.equal(measure.components.length, 2, "two disjoint encounters are two components");
  const abc = measure.components.find((component) => component.nodes.includes("a.md"));
  assert.ok(Math.abs(abc!.simpliciality! - 0.25) < 1e-9);
});

test("hypergraph components join notes that share an encounter, ignoring the simplicial layer", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["a.md", "b.md"] });
  model.addHyperedge({ nodes: ["b.md", "c.md"] });
  model.addSimplex({ nodes: ["z1.md", "z2.md"], userDefined: true });

  const components = hypergraphComponents(model);
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].nodes, ["a.md", "b.md", "c.md"]);
});

// ---------------------------------------------------------------------------
// HG-12 — face independence
// ---------------------------------------------------------------------------

test("a triad with no pairwise evidence is maximally face-independent", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  const result = faceIndependence(model, key, () => 0);

  assert.ok(result);
  assert.equal(result!.independence, 1);
  assert.equal(result!.evaluatedSubsets, 3, "the three pairs are the only proper subgroups");
});

test("a triad whose pairs are all well evidenced is not face-independent", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  const result = faceIndependence(model, key, () => 0.9);

  assert.ok(Math.abs(result!.independence! - 0.1) < 1e-9);
  assert.equal(result!.maxSubsetScore, 0.9);
  assert.ok(result!.strongestSubset);
});

test("face independence names the subgroup that stands on its own", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  const result = faceIndependence(model, key, (nodes) =>
    nodes.length === 2 && nodes.includes("a.md") && nodes.includes("b.md") ? 0.8 : 0.05,
  );

  assert.deepEqual(result!.strongestSubset, ["a.md", "b.md"]);
  assert.ok(Math.abs(result!.independence! - 0.2) < 1e-9);
});

test("a two-note encounter has no subgroup to be independent of", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md"] });
  const result = faceIndependence(model, key, () => 1);
  assert.equal(result!.independence, null);
  assert.equal(result!.evaluatedSubsets, 0);
});

test("face independence refuses to enumerate an oversized encounter", () => {
  const model = new SimplicialModel();
  const nodes = Array.from({ length: 14 }, (_, index) => `n${index}.md`);
  const key = model.addHyperedge({ nodes });
  let calls = 0;
  const result = faceIndependence(model, key, () => {
    calls++;
    return 1;
  });
  assert.equal(result!.unbounded, true);
  assert.equal(calls, 0);
});

// ---------------------------------------------------------------------------
// HG-13 — recurrence weighted by recency
// ---------------------------------------------------------------------------

test("encounter vitality decays each occurrence by the shared half-life", () => {
  const now = Date.UTC(2026, 0, 1);
  const day = 24 * 60 * 60 * 1000;
  assert.equal(encounterVitality([], 90, now), 0);
  assert.equal(encounterVitality([now, now, now], 90, now), 3);

  const oneHalfLifeAgo = now - 90 * day;
  assert.ok(Math.abs(encounterVitality([oneHalfLifeAgo, oneHalfLifeAgo], 90, now) - 1) < 1e-9);
});

test("three recent encounters and three ancient ones are the same count and not the same fact", () => {
  const now = Date.UTC(2026, 0, 1);
  const day = 24 * 60 * 60 * 1000;
  const recent = [now - day, now - 2 * day, now - 3 * day];
  const ancient = recent.map((timestamp) => timestamp - 900 * day);
  assert.ok(encounterVitality(recent, 90, now) > 2.9);
  assert.ok(encounterVitality(ancient, 90, now) < 0.01);
});

// ---------------------------------------------------------------------------
// HG-14 — overlap pressure
// ---------------------------------------------------------------------------

test("a note in five disjoint encounters is under more pressure than one in five nested ones", () => {
  const disjoint = new SimplicialModel();
  for (let index = 0; index < 5; index++) {
    disjoint.addHyperedge({ nodes: ["hub.md", `far${index}a.md`, `far${index}b.md`] });
  }

  const nested = new SimplicialModel();
  for (let index = 0; index < 5; index++) {
    nested.addHyperedge({ nodes: ["hub.md", "shared1.md", "shared2.md", `tail${index}.md`] });
  }

  const disjointPressure = overlapPressure(disjoint, "hub.md");
  const nestedPressure = overlapPressure(nested, "hub.md");

  assert.equal(disjointPressure.incidentEncounters, 5);
  assert.equal(nestedPressure.incidentEncounters, 5);
  assert.ok(
    disjointPressure.pressure > nestedPressure.pressure,
    `disjoint ${disjointPressure.pressure} should exceed nested ${nestedPressure.pressure}`,
  );
});

test("a note in a single encounter is under no overlap pressure", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  assert.equal(overlapPressure(model, "a.md").pressure, 0);
});

// ---------------------------------------------------------------------------
// HG-15 — the readings, not the figures
// ---------------------------------------------------------------------------

test("every diagnostic comes back with a sentence a reader can act on", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"], persistence: "momentary" });
  const diagnostics = encounterDiagnostics(model, key, { score: () => 0, occurrences: [Date.now()] });

  assert.ok(diagnostics);
  const readings = explainEncounter(diagnostics!, 3);
  assert.match(readings.closure!, /order 3/);
  assert.ok(readings.independence);
  assert.match(readings.persistence, /Recurring at 3/);
  assert.equal(readings.overlap, null, "a single encounter is not an overload");
});

test("a fully filled-in encounter says so rather than reporting a zero", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  model.promoteToSimplex(key);
  const diagnostics = encounterDiagnostics(model, key, { occurrences: [] });
  const readings = explainEncounter(diagnostics!, 3);
  assert.match(readings.closure!, /already exists/);
});

test("the vault-level reading is absent until there is something to read", () => {
  assert.equal(explainSimpliciality(null, 0), null);
  assert.equal(explainSimpliciality(0.95, 0), null);
  assert.match(explainSimpliciality(0.95, 4)!, /barely saying anything/);
  assert.match(explainSimpliciality(0.1, 4)!, /may not decompose/);
});

// ---------------------------------------------------------------------------
// HG-17 — focus and the in-phase pulse
// ---------------------------------------------------------------------------

test("the pulse is one shared phase, so members breathe together rather than each on its own clock", () => {
  const now = 1234567;
  const phase = pulsePhase(now);
  assert.equal(pulsePhase(now), phase, "the phase depends on time alone");
  assert.ok(phase >= 0 && phase <= 1);

  // A full period returns to the same point in the breath.
  assert.ok(Math.abs(pulsePhase(now + PULSE_PERIOD_MS) - phase) < 1e-9);
  // Half a period is the opposite point.
  assert.ok(Math.abs(pulsePhase(0) - 0) < 1e-9);
  assert.ok(Math.abs(pulsePhase(PULSE_PERIOD_MS / 2) - 1) < 1e-9);
});

test("a still pulse leaves the node exactly as it was — reduced motion is the same shape held still", () => {
  assert.equal(pulsedNodeRadius(5, 0), 5);
  assert.ok(pulsedNodeRadius(5, 1) > 5);
});

test("the layout engine keeps ticking while an animation hold is set", () => {
  const engine = new LayoutEngine();
  const nodes: LayoutNode[] = [
    { id: "a.md", px: 0, py: 0, vx: 0, vy: 0, isVirtual: false, isPinned: true, displayAlpha: 1 },
  ];

  // A pinned lone node has no kinetic energy, so the engine sleeps immediately.
  engine.tick(nodes, [], { width: 800, height: 600 }, null, []);
  assert.equal(engine.isAnimationHeld, false);

  engine.setAnimationHold(true);
  engine.tick(nodes, [], { width: 800, height: 600 }, null, []);
  assert.equal(engine.isAnimationHeld, true, "a settled layout must not stop a pulse that has its own clock");
});

// ---------------------------------------------------------------------------
// HG-18 — emergence and closure-deficit visuals
// ---------------------------------------------------------------------------

test("a high closure deficit reads as more unresolved than a low one", () => {
  const base = { opacity: 0.55, focused: true, emergent: false, pulse: 0 };
  const unresolved = encounterStyle({ ...base, deficit: 1 });
  const resolved = encounterStyle({ ...base, deficit: 0 });

  assert.ok(unresolved.dash[1] > resolved.dash[1], "an unresolved encounter has a more open boundary");
  assert.ok(unresolved.fillAlpha < resolved.fillAlpha, "an encounter on a filled-in neighbourhood may look settled");
});

test("an unmeasured deficit borrows neither the settled nor the hollow look", () => {
  const base = { opacity: 0.55, focused: true, emergent: false, pulse: 0 };
  const unmeasured = encounterStyle({ ...base, deficit: null });
  const resolved = encounterStyle({ ...base, deficit: 0 });
  const unresolved = encounterStyle({ ...base, deficit: 1 });

  assert.ok(unmeasured.fillAlpha > unresolved.fillAlpha && unmeasured.fillAlpha < resolved.fillAlpha);
  assert.ok(unmeasured.dash[1] > resolved.dash[1] && unmeasured.dash[1] < unresolved.dash[1]);
});

test("only an encounter eligible to crystallize shows the precipitation contour", () => {
  const base = { opacity: 0.55, focused: true, deficit: 0.5, pulse: 0 };
  assert.equal(encounterStyle({ ...base, emergent: false }).showEmergenceContour, false);
  assert.equal(encounterStyle({ ...base, emergent: true }).showEmergenceContour, true);
});

test("an unfocused encounter recedes without disappearing", () => {
  const base = { opacity: 0.55, deficit: 0.5, emergent: false, pulse: 0 };
  const focused = encounterStyle({ ...base, focused: true });
  const unfocused = encounterStyle({ ...base, focused: false });

  assert.ok(unfocused.strokeAlpha < focused.strokeAlpha);
  assert.ok(unfocused.strokeAlpha > 0);
});

test("every style value stays in range across the whole input space", () => {
  for (const opacity of [0, 0.55, 1, 2, -1]) {
    for (const deficit of [null, 0, 0.5, 1]) {
      for (const pulse of [0, 0.5, 1, 3]) {
        const style = encounterStyle({ opacity, focused: true, deficit, emergent: false, pulse });
        assert.ok(style.strokeAlpha >= 0 && style.strokeAlpha <= 1, `strokeAlpha ${style.strokeAlpha}`);
        assert.ok(style.fillAlpha >= 0 && style.fillAlpha <= 1, `fillAlpha ${style.fillAlpha}`);
        assert.ok(style.lineWidth > 0 && style.dash[0] > 0 && style.dash[1] > 0);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// HG-19 — activation: attention, never content
// ---------------------------------------------------------------------------

test("activation decays by its half-life and never accumulates past full", () => {
  const now = Date.UTC(2026, 0, 1);
  const state = new ActivationState({ halfLifeMinutes: 30, sourceWeights: DEFAULT_SOURCE_WEIGHTS });

  state.register("a.md", "opened", now);
  assert.equal(state.valueAt("a.md", now), 1);
  assert.ok(Math.abs(state.valueAt("a.md", now + 30 * 60000) - 0.5) < 1e-9);

  state.register("a.md", "opened", now);
  state.register("a.md", "opened", now);
  assert.equal(state.valueAt("a.md", now), 1, "a note cannot be more open than open");
});

test("opening a note raises its encounter co-members and leaves unrelated notes quiet", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  model.setNode("stranger.md");

  const kernel = createKernel(model, "hypergraph");
  const seeded: ActivationField = new Map([["a.md", 1]]);
  const spread = propagate(kernel, seeded, 4);

  assert.ok(spread.get("b.md")! > 0.1, "a co-member should be raised");
  assert.ok(spread.get("c.md")! > 0.1);
  assert.equal(spread.get("stranger.md") ?? 0, 0, "an unrelated note must stay quiet");
});

test("the three kernels read different structure from the same vault", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  model.addHyperedge({ nodes: ["a.md", "x.md", "y.md"] });

  assert.deepEqual(kernelGroups(model, "pairwise"), [["a.md", "b.md"]]);
  assert.deepEqual(kernelGroups(model, "hypergraph"), [["a.md", "x.md", "y.md"]]);
  // The simplicial kernel takes the faces too: that is what downward closure means
  // for propagation, and dropping them would quietly make it a fourth kernel.
  model.addSimplex({ nodes: ["p.md", "q.md", "r.md"], userDefined: true });
  assert.equal(kernelGroups(model, "simplicial").length, model.simplices.size);
});

test("propagation never mutates the field it was given", () => {
  const model = new SimplicialModel();
  model.addHyperedge({ nodes: ["a.md", "b.md"] });
  const kernel = createKernel(model, "hypergraph");
  const seeded: ActivationField = new Map([["a.md", 1]]);
  propagate(kernel, seeded, 3);
  assert.equal(seeded.get("a.md"), 1);
  assert.equal(seeded.size, 1);
});

// ---------------------------------------------------------------------------
// HG-20 — synchronization time
// ---------------------------------------------------------------------------

test("synchronization time is deterministic under a seeded initial state", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });

  const first = synchronizationTime(model, key, "hypergraph", { seed: 42 });
  const second = synchronizationTime(model, key, "hypergraph", { seed: 42 });
  assert.deepEqual(first!.orderTrace, second!.orderTrace);
  assert.equal(first!.iterations, second!.iterations);
  assert.equal(first!.converged, true);
});

test("the sliced synchronization diagnostic is equivalent and yields bounded work", async () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  const options = { seed: 42, maxIterations: 80 };
  const synchronous = synchronizationTime(model, key, "hypergraph", options)!;
  let yields = 0;
  const sliced = await synchronizationTimeSliced(model, key, "hypergraph", {
    ...options,
    sliceIterations: 2,
    yieldControl: async () => {
      yields++;
    },
  });

  assert.deepEqual(sliced, synchronous);
  assert.ok(yields > 0, "a non-trivial simulation must return control between slices");
});

test("the Dynamics Lab kernels give distinguishable traces on higher-order structure", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], userDefined: true });

  const traces = KERNEL_NAMES.map((kernel) => synchronizationTime(model, key, kernel, { seed: 91 })!.orderTrace);
  assert.notDeepEqual(traces[0], traces[1], "pairwise and simplicial structure must remain experimentally distinct");
  assert.notDeepEqual(traces[1], traces[2], "simplicial and irreducible propagation must remain distinct");
});

test("a kernel that cannot reach the members reports that it never settled", () => {
  const model = new SimplicialModel();
  const key = model.addHyperedge({ nodes: ["a.md", "b.md", "c.md"] });

  // No simplices at all: the pairwise kernel has nothing to propagate along, so the
  // members keep whatever the seed gave them and never agree.
  const result = synchronizationTime(model, key, "pairwise", { maxIterations: 50 });
  assert.equal(result!.converged, false);
  assert.equal(result!.iterations, null, "the iteration cap is not an answer");
});

test("synchronization stays bounded on a large vault", () => {
  const model = new SimplicialModel();
  for (let index = 0; index < 500; index++) model.setNode(`n${index}.md`);
  const key = model.addHyperedge({ nodes: ["n0.md", "n1.md", "n2.md", "n3.md"] });

  const started = Date.now();
  const result = synchronizationTime(model, key, "hypergraph", { maxIterations: 400 });
  assert.ok(result);
  assert.ok(Date.now() - started < 5000, "a bounded simulation must stay bounded");
});

test("the order parameter is one when members agree and falls as they split", () => {
  assert.equal(orderParameter([0.5, 0.5, 0.5]), 1);
  assert.ok(orderParameter([0, 1]) < 0.05);
  assert.ok(orderParameter([0.4, 0.6]) > orderParameter([0.1, 0.9]));
});

test("competing rhythms need shared members and a real separation", () => {
  const base = { kernel: "hypergraph" as const, converged: true, orderTrace: [], finalVariance: 0 };
  const results = [
    { ...base, relationKey: "h:a", members: ["shared.md", "a.md"], iterations: 4 },
    { ...base, relationKey: "h:b", members: ["shared.md", "b.md"], iterations: 40 },
    { ...base, relationKey: "h:c", members: ["far.md"], iterations: 400 },
  ];

  const competing = competingRhythms(results, 5);
  assert.equal(competing.length, 1, "disjoint encounters compete over nothing");
  assert.deepEqual(competing[0].sharedNodes, ["shared.md"]);
  assert.equal(competing[0].separation, 36);

  assert.equal(competingRhythms(results, 100).length, 0, "a small separation is not a competing rhythm");
});

test("an encounter that never settled cannot be in a competing rhythm", () => {
  const base = { kernel: "hypergraph" as const, orderTrace: [], finalVariance: 0 };
  const results = [
    { ...base, relationKey: "h:a", members: ["shared.md"], iterations: 4, converged: true },
    { ...base, relationKey: "h:b", members: ["shared.md"], iterations: null, converged: false },
  ];
  assert.equal(competingRhythms(results, 1).length, 0);
});

test("activation never reaches a note — no persistence path can see it", async () => {
  // The structural claim, asserted structurally: nothing that writes to the vault
  // imports the activation layer, and the activation layer has no serializer for
  // anything to call. A vault that recorded who was paying attention to what would
  // be a different and much worse artifact than a vault of notes.
  const { readFile } = await import("node:fs/promises");
  const writers = ["data/persistence.ts", "data/frontmatter.ts", "data/history-store.ts", "core/history.ts"];

  for (const path of writers) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
    // `getDefaultSettings` is excluded on purpose: settings live in plugin data, not
    // in a note, and the half-life of attention is a setting like any other. What
    // must never happen is a *note writer* learning the word.
    const writerSource = source.split("export function getDefaultSettings")[0];
    assert.equal(/activation/i.test(writerSource), false, `${path} must not know activation exists`);
  }

  const state = new ActivationState();
  state.register("a.md", "opened");
  const surface = [
    ...Object.getOwnPropertyNames(ActivationState.prototype),
    ...Object.keys(state as unknown as Record<string, unknown>),
  ];
  assert.equal(
    surface.some((name) => /serial|persist|save|write|toJSON/i.test(name)),
    false,
    "activation exposes no way to be written down",
  );
});

// ---------------------------------------------------------------------------
// HG-27 — exact linear algebra over ℚ
// ---------------------------------------------------------------------------

test("rank and nullspace are exact where floating point would guess", () => {
  const matrix = fromNumbers([
    [1, 2, 3],
    [2, 4, 6],
    [1, 1, 1],
  ]);
  assert.equal(rank(matrix), 2);
  const kernel = nullspace(matrix);
  assert.equal(kernel.length, 1);

  // A matrix whose dependency only shows up under exact arithmetic.
  const tricky = fromNumbers([
    [1, 3],
    [3, 9],
  ]);
  assert.equal(rank(tricky), 1);
});

test("an inconsistent system is reported as inconsistent, not approximated", () => {
  const matrix = fromNumbers([[1], [1]]);
  assert.equal(solve(matrix, [frac(1), frac(2)]).consistent, false);
  assert.equal(solve(matrix, [frac(3), frac(3)]).consistent, true);
});

test("the sheaf Laplacian has the same kernel as the coboundary", () => {
  const delta = fromNumbers([
    [1, -1, 0],
    [0, 1, -1],
  ]);
  const laplacian = sheafLaplacian(delta);
  assert.equal(nullspace(laplacian).length, nullspace(delta).length);
});

// ---------------------------------------------------------------------------
// HG-25 … HG-28 — the sheaf layer
// ---------------------------------------------------------------------------

function sheafFixture(assignments: Record<string, Record<string, string>>): {
  model: SimplicialModel;
  data: SheafData;
} {
  const model = new SimplicialModel();
  const contexts: SheafContext[] = [];
  const sections = new Map<string, LocalSection>();

  Object.entries(assignments).forEach(([contextId, roles]) => {
    const nodes = Object.keys(roles);
    const key = model.addHyperedge({ nodes });
    contexts.push({ id: contextId, name: contextId, source: "manual", definition: "", relations: [key] });
    sections.set(contextId, new Map(Object.entries(roles) as Array<[string, SheafRole]>));
  });

  return { model, data: { contexts, sections } };
}

test("a note can carry a different role in each context it appears in", () => {
  const { data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "a.md": "project", "c.md": "action" },
    c3: { "a.md": "creative", "d.md": "reference" },
  });

  assert.equal(restrict(data.sections.get("c1")!, "a.md"), "research");
  assert.equal(restrict(data.sections.get("c2")!, "a.md"), "project");
  assert.equal(restrict(data.sections.get("c3")!, "a.md"), "creative");
});

test("when every context agrees, the sheaf layer reports nothing — the degenerate case is current behaviour", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "research" },
    c2: { "b.md": "research", "c.md": "research" },
    c3: { "c.md": "research", "a.md": "research" },
  });

  const report = analyzeSheaf(model, data);
  assert.equal(report.gluing.h1, 0, "an agreeing vault has no obstruction");
  assert.equal(report.gluing.glues, true);
  assert.equal(report.obstructions.length, 0);
  assert.equal(report.fraction.value, 1);
  assert.ok(report.gluing.h0 > 0, "an agreeing vault admits a global reading");
});

test("the canonical fixture: three contexts, pairwise compatible, globally impossible", () => {
  // Each pair of contexts overlaps in exactly one note, so one baseline shift always
  // reconciles any two of them. The cycle is what cannot be reconciled.
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "b.md": "research", "c.md": "idea" },
    c3: { "c.md": "research", "a.md": "idea" },
  });

  const report = analyzeSheaf(model, data);
  assert.equal(report.gluing.pairwiseDisagreements.length, 0, "every pair is compatible on its overlap");
  assert.equal(report.gluing.h1, 1, "exactly one obstruction class");
  assert.equal(report.gluing.glues, false);
  assert.equal(report.gluing.contextualityDetected, true);
  assert.equal(report.obstructions.length, 1);
  assert.ok(report.fraction.value < 1, "an obstructed cover cannot be fully explained");
  assert.equal(report.fraction.exact, true);
});

test("the obstruction names the cycle of contexts it lives on", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "b.md": "research", "c.md": "idea" },
    c3: { "c.md": "research", "a.md": "idea" },
  });

  const [obstruction] = analyzeSheaf(model, data).obstructions;
  assert.deepEqual(obstruction.contexts, ["c1", "c2", "c3"]);
  assert.deepEqual(obstruction.nodes, ["a.md", "b.md", "c.md"]);
  assert.ok(obstruction.magnitude > 0);
});

test("two contexts overlapping in one note always glue — a single shift reconciles them", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "b.md": "action", "c.md": "project" },
  });

  const report = analyzeSheaf(model, data);
  assert.equal(report.gluing.h1, 0, "no cycle, no obstruction");
  assert.equal(report.fraction.value, 1);
});

test("plain local disagreement is reported as such and not mistaken for contextuality", () => {
  // Two contexts share two notes and read them incompatibly: easy to find, and not
  // the interesting case. It must not be labelled contextual.
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "a.md": "research", "b.md": "action" },
  });

  const report = analyzeSheaf(model, data);
  assert.equal(report.gluing.pairwiseDisagreements.length, 1);
  assert.equal(report.gluing.contextualityDetected, false, "locally inconsistent is not locally consistent");
  assert.deepEqual(report.gluing.pairwiseDisagreements[0].disagreeingNodes, ["b.md"]);
});

test("a uniform relabelling across the overlap is a relabelling, not a conflict", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "research" },
    c2: { "a.md": "project", "b.md": "project" },
  });
  assert.equal(analyzeSheaf(model, data).gluing.pairwiseDisagreements.length, 0);
});

test("the contextual fraction says how much of the cover still reads together", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "b.md": "research", "c.md": "idea" },
    c3: { "c.md": "research", "a.md": "idea" },
  });

  const fraction = contextualFraction(model, data);
  // Dropping any one of the three breaks the cycle, so two thirds still glue.
  assert.ok(Math.abs(fraction.value - 2 / 3) < 1e-9);
  assert.equal(fraction.consistentContexts.length, 2);
});

test("role refinement suggestions improve gluing without mutating the live sheaf", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "a.md": "research", "b.md": "action" },
  });
  const before = analyzeSheaf(model, data);
  const snapshot = [...data.sections].map(([id, section]) => [id, [...section]]);
  const suggestions = suggestRoleRefinements(model, data);

  assert.ok(suggestions.length > 0);
  assert.ok(
    suggestions.every(
      (suggestion) =>
        suggestion.after.h1 < suggestion.before.h1 ||
        suggestion.after.contextualFraction > suggestion.before.contextualFraction ||
        suggestion.after.localDisagreements < suggestion.before.localDisagreements ||
        (suggestion.before.contextualityDetected && !suggestion.after.contextualityDetected),
    ),
  );
  assert.deepEqual(
    [...data.sections].map(([id, section]) => [id, [...section]]),
    snapshot,
    "counterfactual evaluation must not edit the user's readings",
  );
  assert.deepEqual(analyzeSheaf(model, data), before);
});

test("an already coherent cover receives no role-change pressure", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "research" },
    c2: { "b.md": "research", "c.md": "research" },
  });
  assert.deepEqual(suggestRoleRefinements(model, data), []);
});

test("contexts and their overlaps are enumerable so a user can see the intersection", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "b.md": "research", "c.md": "idea" },
  });

  const overlaps = contextOverlaps(model, data.contexts);
  assert.equal(overlaps.length, 1);
  assert.deepEqual(overlaps[0].nodes, ["b.md"]);
  assert.deepEqual(contextSupport(model, data.contexts[0]), ["a.md", "b.md"]);
});

test("backfilling from a global role assignment produces the agreeing case", () => {
  const { model, data } = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "b.md": "action", "c.md": "project" },
    c3: { "c.md": "creative", "a.md": "reference" },
  });

  const globalRoles = new Map<string, SheafRole>([
    ["a.md", "research"],
    ["b.md", "research"],
    ["c.md", "research"],
  ]);
  const backfilled: SheafData = {
    contexts: data.contexts,
    sections: new Map(data.contexts.map((context) => [context.id, backfillSection(model, context, globalRoles)])),
  };

  assert.equal(analyzeSheaf(model, backfilled).gluing.h1, 0);
  assert.equal(analyzeSheaf(model, backfilled).fraction.value, 1);
});

test("an empty cover is not an obstructed one", () => {
  const model = new SimplicialModel();
  const report = analyzeSheaf(model, { contexts: [], sections: new Map() });
  assert.equal(report.gluing.h1, 0);
  assert.equal(report.fraction.value, 1);
  assert.equal(report.obstructions.length, 0);
});

test("a sheaf obstruction and a beta-one hole remain different objects", () => {
  const obstructed = sheafFixture({
    c1: { "a.md": "research", "b.md": "idea" },
    c2: { "b.md": "research", "c.md": "idea" },
    c3: { "c.md": "research", "a.md": "idea" },
  });
  assert.equal(obstructed.model.getCachedBetti().b1, 0, "encounter contexts create no simplicial hole");
  assert.equal(analyzeSheaf(obstructed.model, obstructed.data).gluing.h1, 1);

  const hole = new SimplicialModel();
  hole.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
  hole.addSimplex({ nodes: ["b.md", "c.md"], userDefined: true });
  hole.addSimplex({ nodes: ["a.md", "c.md"], userDefined: true });
  assert.ok(hole.getCachedBetti().b1 > 0, "the triangular boundary has a topological hole");
  assert.equal(
    analyzeSheaf(hole, { contexts: [], sections: new Map() }).gluing.h1,
    0,
    "no cover means no gluing obstruction",
  );
});

test("sheaf contexts and local roles have no note write-back path", async () => {
  const { readFile } = await import("node:fs/promises");
  const noteWriters = ["data/persistence.ts", "data/frontmatter.ts", "data/history-store.ts"];
  for (const path of noteWriters) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
    const writerSource = source.split("export function getDefaultSettings")[0];
    assert.equal(/sheaf|contextuality/i.test(writerSource), false, `${path} must not serialize contextual readings`);
  }
});

test("encounter discovery proposes bounded candidates without asserting provenance", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], weight: 0.9, userDefined: true });
  const suggestions = suggestEncounters(model, { threshold: 0.5, limit: 5 });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].suggested, true);
  assert.equal(suggestions[0].inferred, true);
  assert.equal(suggestions[0].occurredAt, undefined, "a proposal must not pretend an encounter happened");
  assert.equal(model.hyperedges.size, 0, "discovery is pure until the caller chooses to display candidates");
});

test("encounter discovery finds a cross-field junction and respects its cap", () => {
  const model = new SimplicialModel();
  model.addSimplex({ nodes: ["hub.md", "a.md", "b.md"], userDefined: true });
  model.addSimplex({ nodes: ["hub.md", "x.md", "y.md"], userDefined: true });
  const suggestions = suggestEncounters(model, { threshold: 0.4, limit: 1 });
  assert.equal(suggestions.length, 1);
  assert.ok(suggestions[0].nodes.includes("hub.md"));
});
