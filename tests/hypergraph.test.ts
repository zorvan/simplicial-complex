import { test } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeKey, normalizeNodes, parseRelationKey, relationKey } from "../core/normalize.js";
import { SimplicialModel } from "../core/model.js";
import { RelationHistory, deserializeEvent, serializeEvent, syncEncounterPersistence } from "../core/history.js";
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
