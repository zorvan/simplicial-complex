import { combinations } from "./faces.js";
import { crossLayerMap, MAX_CROSS_LAYER_ORDER } from "./incidence.js";
import type { SimplicialModel } from "./model.js";
import { normalizeKey, relationKey } from "./normalize.js";
import type { NodeID, RelationKey } from "./types.js";

/**
 * Diagnostics read the hypergraph *against* the simplicial complex. None of them
 * write to either layer, and none of them promote: every measure here is evidence
 * offered to the user, never an assertion made on their behalf.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// HG-11 — closure deficit and simpliciality
// ---------------------------------------------------------------------------

export interface ClosureDeficit {
  key: RelationKey;
  nodes: NodeID[];
  /** Implied relations of size ≥ 2 that the simplicial layer does not carry. */
  missingFaces: NodeID[][];
  missingCount: number;
  /** 2^n − n − 1: every subset of size ≥ 2, including the full set. */
  impliedFaceCount: number;
  /**
   * 0 = every relation this encounter implies already exists; 1 = none of them do.
   * `null` when the encounter is too large to enumerate — an unbounded deficit is
   * genuinely unknown, and reporting it as 1 would be a measurement we did not take.
   */
  deficit: number | null;
  unbounded: boolean;
}

export function closureDeficit(model: SimplicialModel, key: RelationKey): ClosureDeficit | null {
  const entry = crossLayerMap(model).hyperedges.get(key);
  if (!entry) return null;
  if (entry.unbounded) {
    return {
      key,
      nodes: entry.nodes,
      missingFaces: [],
      missingCount: 0,
      impliedFaceCount: entry.impliedFaceCount,
      deficit: null,
      unbounded: true,
    };
  }
  const missingCount = entry.missingFaces.length;
  return {
    key,
    nodes: entry.nodes,
    missingFaces: entry.missingFaces,
    missingCount,
    impliedFaceCount: entry.impliedFaceCount,
    deficit: entry.impliedFaceCount > 0 ? clamp01(missingCount / entry.impliedFaceCount) : 0,
    unbounded: false,
  };
}

export interface SimplicialityComponent {
  nodes: NodeID[];
  encounters: RelationKey[];
  /** Mean over the component's measurable encounters; `null` if none could be measured. */
  simpliciality: number | null;
}

export interface Simpliciality {
  /** 1 = the encounter collection is already downward-closed; 0 = none of it is. */
  value: number | null;
  measuredEncounters: number;
  unboundedEncounters: number;
  components: SimplicialityComponent[];
}

/**
 * How close the encounter collection sits to downward closure — vault-wide and per
 * connected component of the hypergraph.
 *
 * This is a description, not a target. A vault of 1.0 has said nothing irreducible;
 * a vault of 0.0 has recorded encounters and drawn no conclusions from any of them.
 */
export function simpliciality(model: SimplicialModel): Simpliciality {
  const deficits = new Map<RelationKey, number | null>();
  let unboundedEncounters = 0;
  model.hyperedges.forEach((_, key) => {
    const result = closureDeficit(model, key);
    if (!result || result.unbounded) {
      unboundedEncounters++;
      deficits.set(key, null);
      return;
    }
    deficits.set(key, result.deficit);
  });

  const measured = [...deficits.values()].filter((value): value is number => value !== null);
  const components = hypergraphComponents(model).map((component) => {
    const values = component.encounters
      .map((key) => deficits.get(key))
      .filter((value): value is number => value !== null && value !== undefined);
    return {
      ...component,
      simpliciality: values.length > 0 ? 1 - values.reduce((sum, value) => sum + value, 0) / values.length : null,
    };
  });

  return {
    value: measured.length > 0 ? 1 - measured.reduce((sum, value) => sum + value, 0) / measured.length : null,
    measuredEncounters: measured.length,
    unboundedEncounters,
    components,
  };
}

/** Connected components of the hypergraph alone — nodes joined by co-membership. */
export function hypergraphComponents(model: SimplicialModel): Array<{ nodes: NodeID[]; encounters: RelationKey[] }> {
  const parent = new Map<NodeID, NodeID>();
  const find = (id: NodeID): NodeID => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };

  model.hyperedges.forEach((hyperedge) => {
    hyperedge.nodes.forEach((id) => {
      if (!parent.has(id)) parent.set(id, id);
    });
  });
  model.hyperedges.forEach((hyperedge) => {
    const [first, ...rest] = hyperedge.nodes;
    if (first === undefined) return;
    rest.forEach((id) => {
      const a = find(first);
      const b = find(id);
      if (a !== b) parent.set(b, a);
    });
  });

  const byRoot = new Map<NodeID, { nodes: NodeID[]; encounters: RelationKey[] }>();
  parent.forEach((_, id) => {
    const root = find(id);
    const bucket = byRoot.get(root) ?? { nodes: [], encounters: [] };
    bucket.nodes.push(id);
    byRoot.set(root, bucket);
  });
  model.hyperedges.forEach((hyperedge, key) => {
    const first = hyperedge.nodes[0];
    if (first === undefined) return;
    byRoot.get(find(first))?.encounters.push(key);
  });

  return [...byRoot.values()].map((component) => ({
    nodes: component.nodes.sort(),
    encounters: component.encounters.sort(),
  }));
}

// ---------------------------------------------------------------------------
// HG-12 — face independence
// ---------------------------------------------------------------------------

/**
 * How much evidence a set of notes carries for belonging together, in `[0,1]`,
 * measured by the same vault signals the simplicial inference reads. It must be
 * defined for any arity ≥ 2 and must agree with the pairwise measure at arity 2 —
 * otherwise a subgroup and the whole would be scored on different scales and the
 * comparison below would be meaningless.
 */
export type SubsetScorer = (_nodes: NodeID[]) => number;

export interface FaceIndependence {
  key: RelationKey;
  /**
   * 1 = no proper subgroup stands on its own evidence; 0 = some subgroup is fully
   * evidenced without the rest. `null` when the encounter is too large to enumerate.
   */
  independence: number | null;
  /** Evidence for the whole group, on the same scale. Read *with* `independence`. */
  fullSetScore: number;
  maxSubsetScore: number;
  meanSubsetScore: number;
  /** The proper subgroup that best stands on its own, if any does. */
  strongestSubset: NodeID[] | null;
  evaluatedSubsets: number;
  unbounded: boolean;
}

/**
 * HG-12. Do the proper subgroups produce meaningful results on their own?
 *
 * `independence` measures only the subgroup side: how little the strongest proper
 * subgroup is evidenced. The strongest, not the average, because one well-evidenced
 * pair is enough to explain a triad away.
 *
 * Read alongside `fullSetScore`, this separates the two cases the panel must not
 * conflate. High independence with a high full-set score is genuine irreducibility —
 * the group is evidenced, its parts are not. High independence with a low full-set
 * score is an encounter resting entirely on the user's assertion, which is a
 * perfectly good reason to record one and a bad reason to promote it.
 */
export function faceIndependence(
  model: SimplicialModel,
  key: RelationKey,
  score: SubsetScorer,
): FaceIndependence | null {
  const hyperedge = model.getHyperedge(key);
  if (!hyperedge) return null;
  const nodes = hyperedge.nodes;

  if (nodes.length > MAX_CROSS_LAYER_ORDER) {
    return {
      key,
      independence: null,
      fullSetScore: 0,
      maxSubsetScore: 0,
      meanSubsetScore: 0,
      strongestSubset: null,
      evaluatedSubsets: 0,
      unbounded: true,
    };
  }

  const fullSetScore = clamp01(score(nodes));
  let maxSubsetScore = 0;
  let total = 0;
  let evaluated = 0;
  let strongestSubset: NodeID[] | null = null;

  for (let size = 2; size < nodes.length; size++) {
    for (const subset of combinations(nodes, size)) {
      const value = clamp01(score(subset));
      total += value;
      evaluated++;
      if (value > maxSubsetScore) {
        maxSubsetScore = value;
        strongestSubset = subset;
      }
    }
  }

  return {
    key,
    // A 2-member encounter has no proper subgroup of size ≥ 2, so there is nothing
    // for it to be independent of.
    independence: evaluated > 0 ? clamp01(1 - maxSubsetScore) : null,
    fullSetScore,
    maxSubsetScore,
    meanSubsetScore: evaluated > 0 ? total / evaluated : 0,
    strongestSubset,
    evaluatedSubsets: evaluated,
    unbounded: false,
  };
}

// ---------------------------------------------------------------------------
// HG-13 — recurrence, weighted by recency
// ---------------------------------------------------------------------------

/**
 * A recency-weighted encounter count, using the same half-life the inference layer
 * decays simplex weight by (`decayHalfLifeDays`) rather than a second scheme.
 *
 * Three encounters last week and three encounters three years ago are the same
 * number and not the same fact; `persistence` records the first, this records the
 * second. Neither promotes anything.
 */
export function encounterVitality(occurrences: number[], halfLifeDays: number, now = Date.now()): number {
  if (occurrences.length === 0 || halfLifeDays <= 0) return 0;
  return occurrences.reduce((sum, timestamp) => {
    const ageDays = Math.max(0, (now - timestamp) / MS_PER_DAY);
    return sum + Math.pow(0.5, ageDays / halfLifeDays);
  }, 0);
}

// ---------------------------------------------------------------------------
// HG-14 — overlap pressure
// ---------------------------------------------------------------------------

export interface OverlapPressure {
  nodeId: NodeID;
  incidentEncounters: number;
  /** Mean Jaccard similarity between every pair of encounters this node sits in. */
  meanJaccard: number;
  /** 0 = one context or perfectly nested contexts; → 1 = many mutually disjoint ones. */
  pressure: number;
}

/**
 * HG-14. A note pulled across many contexts that have nothing to do with each other.
 *
 * Count alone would flag a hub; low mutual overlap is what turns a hub into a note
 * asked to mean different things in each place it appears. This is a proxy — the
 * real invariant is the sheaf obstruction in Phase 7, which can tell "many contexts"
 * from "contexts that cannot be read together".
 */
export function overlapPressure(model: SimplicialModel, nodeId: NodeID): OverlapPressure {
  const incident = model.getHyperedgesForNode(nodeId);
  const count = incident.length;
  if (count < 2) {
    return { nodeId, incidentEncounters: count, meanJaccard: count === 1 ? 1 : 0, pressure: 0 };
  }

  let total = 0;
  let pairs = 0;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const a = new Set(incident[i].nodes);
      const b = new Set(incident[j].nodes);
      let shared = 0;
      b.forEach((id) => {
        if (a.has(id)) shared++;
      });
      const union = a.size + b.size - shared;
      total += union > 0 ? shared / union : 0;
      pairs++;
    }
  }
  const meanJaccard = pairs > 0 ? total / pairs : 0;
  return {
    nodeId,
    incidentEncounters: count,
    meanJaccard,
    pressure: clamp01((1 - meanJaccard) * (1 - 1 / count)),
  };
}

export function overlapPressures(model: SimplicialModel): Map<NodeID, OverlapPressure> {
  const pressures = new Map<NodeID, OverlapPressure>();
  model.hyperedges.forEach((hyperedge) => {
    hyperedge.nodes.forEach((id) => {
      if (!pressures.has(id)) pressures.set(id, overlapPressure(model, id));
    });
  });
  return pressures;
}

// ---------------------------------------------------------------------------
// The bundle the panel reads
// ---------------------------------------------------------------------------

export interface EncounterDiagnostics {
  key: RelationKey;
  nodes: NodeID[];
  closure: ClosureDeficit | null;
  independence: FaceIndependence | null;
  /** The most overloaded participant, which is the one worth naming in the panel. */
  peakOverlap: OverlapPressure | null;
  occurrences: number[];
  vitality: number;
  persistence: "momentary" | "recurring";
}

export interface EncounterDiagnosticsOptions {
  score?: SubsetScorer;
  occurrences?: number[];
  halfLifeDays?: number;
  now?: number;
}

export function encounterDiagnostics(
  model: SimplicialModel,
  key: RelationKey,
  options: EncounterDiagnosticsOptions = {},
): EncounterDiagnostics | null {
  const hyperedge = model.getHyperedge(key);
  if (!hyperedge) return null;
  const occurrences = options.occurrences ?? hyperedge.occurrences ?? [];
  const pressures = hyperedge.nodes.map((id) => overlapPressure(model, id));
  const peakOverlap = pressures.reduce<OverlapPressure | null>(
    (best, current) => (best === null || current.pressure > best.pressure ? current : best),
    null,
  );

  return {
    key,
    nodes: hyperedge.nodes,
    closure: closureDeficit(model, key),
    independence: options.score ? faceIndependence(model, key, options.score) : null,
    peakOverlap,
    occurrences,
    vitality: encounterVitality(occurrences, options.halfLifeDays ?? 90, options.now),
    persistence: hyperedge.persistence === "recurring" ? "recurring" : "momentary",
  };
}

/** Every simplex whose node set some encounter also covers, keyed bare as in `model.simplices`. */
export function simplicesCoveredByEncounters(model: SimplicialModel): Map<string, RelationKey[]> {
  return crossLayerMap(model).simplexCoveredBy;
}

/** True when this exact node set exists in both layers — the state promotion leaves behind. */
export function existsInBothLayers(model: SimplicialModel, nodes: NodeID[]): boolean {
  return model.simplices.has(normalizeKey(nodes)) && model.hyperedges.has(relationKey("hyperedge", nodes));
}
