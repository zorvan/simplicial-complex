import { combinations } from "./faces.js";
import type { SimplicialModel } from "./model.js";
import { normalizeKey, relationKey } from "./normalize.js";
import type { NodeID, RelationKey, SimplexKey } from "./types.js";

/**
 * Above this many members, enumerating a hyperedge's implied faces (2^n − n − 2 of
 * them) stops being worth the cycles. Larger encounters are reported as unbounded
 * rather than expanded — see HG-11's "unbounded deficit".
 */
export const MAX_CROSS_LAYER_ORDER = 10;

export interface IncidenceMatrix {
  /** Row order. */
  nodes: NodeID[];
  /** Column order, namespaced hyperedge keys. */
  edges: RelationKey[];
  /** Row-major, `matrix[nodeIndex * edges.length + edgeIndex]` is 1 iff the node participates. */
  matrix: Uint8Array;
}

export interface HyperedgeCrossLayer {
  key: RelationKey;
  nodes: NodeID[];
  /** Implied faces that do exist in the simplicial layer. */
  presentFaces: SimplexKey[];
  /** Implied faces absent from the simplicial layer. */
  missingFaces: NodeID[][];
  /** Total implied proper faces of size ≥ 2, i.e. 2^n − n − 1 counting the full set's absence. */
  impliedFaceCount: number;
  /** True when the encounter is too large to enumerate; face lists are then empty. */
  unbounded: boolean;
}

export interface CrossLayerMap {
  /** Per hyperedge: which of its implied faces the simplicial layer already carries. */
  hyperedges: Map<RelationKey, HyperedgeCrossLayer>;
  /** Per simplex (bare key): which hyperedges cover its node set. */
  simplexCoveredBy: Map<SimplexKey, RelationKey[]>;
}

export function buildIncidenceMatrix(model: SimplicialModel): IncidenceMatrix {
  const nodes = [...model.nodes.keys()].sort();
  const edges = [...model.hyperedges.keys()].sort();
  const matrix = new Uint8Array(nodes.length * edges.length);
  const nodeIndex = new Map(nodes.map((id, index) => [id, index]));

  edges.forEach((key, edgeIndex) => {
    const hyperedge = model.hyperedges.get(key);
    if (!hyperedge) return;
    hyperedge.nodes.forEach((id) => {
      const row = nodeIndex.get(id);
      if (row === undefined) return;
      matrix[row * edges.length + edgeIndex] = 1;
    });
  });

  return { nodes, edges, matrix };
}

/** How many hyperedges each node participates in. */
export function nodeDegrees(incidence: IncidenceMatrix): Map<NodeID, number> {
  const degrees = new Map<NodeID, number>();
  const columns = incidence.edges.length;
  incidence.nodes.forEach((id, row) => {
    let degree = 0;
    for (let column = 0; column < columns; column++) {
      degree += incidence.matrix[row * columns + column];
    }
    degrees.set(id, degree);
  });
  return degrees;
}

/** How many members each hyperedge has. */
export function edgeSizes(incidence: IncidenceMatrix): Map<RelationKey, number> {
  const sizes = new Map<RelationKey, number>();
  const columns = incidence.edges.length;
  incidence.edges.forEach((key, column) => {
    let size = 0;
    for (let row = 0; row < incidence.nodes.length; row++) {
      size += incidence.matrix[row * columns + column];
    }
    sizes.set(key, size);
  });
  return sizes;
}

/**
 * How often each node pair co-occurs in a hyperedge. This is *not* an assertion
 * that the pair is meaningful — it is the raw count the closure diagnostics read.
 */
export function pairwiseCooccurrence(model: SimplicialModel): Map<string, number> {
  const counts = new Map<string, number>();
  model.hyperedges.forEach((hyperedge) => {
    for (let i = 0; i < hyperedge.nodes.length; i++) {
      for (let j = i + 1; j < hyperedge.nodes.length; j++) {
        const key = normalizeKey([hyperedge.nodes[i], hyperedge.nodes[j]]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  });
  return counts;
}

/**
 * The shared substrate for every cross-layer diagnostic: which faces a hyperedge
 * implies but the simplicial layer does not carry, and which hyperedges cover a
 * given simplex. Cached on the model and invalidated by any relation mutation.
 */
export function crossLayerMap(model: SimplicialModel): CrossLayerMap {
  const cached = model.readCrossLayerCache<CrossLayerMap>();
  if (cached) return cached;

  const hyperedges = new Map<RelationKey, HyperedgeCrossLayer>();
  const simplexCoveredBy = new Map<SimplexKey, RelationKey[]>();

  model.hyperedges.forEach((hyperedge, key) => {
    const nodes = hyperedge.nodes;
    const size = nodes.length;
    // Proper subsets of size 2..n-1, plus the full node set itself.
    const impliedFaceCount = size <= MAX_CROSS_LAYER_ORDER ? 2 ** size - size - 1 : Number.POSITIVE_INFINITY;

    if (size > MAX_CROSS_LAYER_ORDER) {
      hyperedges.set(key, {
        key,
        nodes,
        presentFaces: [],
        missingFaces: [],
        impliedFaceCount,
        unbounded: true,
      });
      return;
    }

    const presentFaces: SimplexKey[] = [];
    const missingFaces: NodeID[][] = [];
    for (let subsetSize = 2; subsetSize <= size; subsetSize++) {
      for (const subset of combinations(nodes, subsetSize)) {
        const subsetKey = normalizeKey(subset);
        if (model.simplices.has(subsetKey)) {
          presentFaces.push(subsetKey);
          const covering = simplexCoveredBy.get(subsetKey) ?? [];
          covering.push(key);
          simplexCoveredBy.set(subsetKey, covering);
        } else {
          missingFaces.push(subset);
        }
      }
    }

    hyperedges.set(key, { key, nodes, presentFaces, missingFaces, impliedFaceCount, unbounded: false });
  });

  return model.writeCrossLayerCache({ hyperedges, simplexCoveredBy });
}

/** Hyperedges whose node set is exactly this simplex, if any. */
export function encounterForSimplex(model: SimplicialModel, simplexNodes: NodeID[]): RelationKey | null {
  const key = relationKey("hyperedge", simplexNodes);
  return model.hyperedges.has(key) ? key : null;
}
