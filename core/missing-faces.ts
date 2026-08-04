import type { SimplicialModel } from "./model.js";
import { normalizeKey, normalizeNodes } from "./normalize.js";
import type { MissingFaceBoundary, NodeID } from "./types.js";

/**
 * Mathematical object: boundaries of absent 2- and 3-simplices in a finite simplicial complex.
 * Result used: the boundary of a (k+1)-simplex is a k-cycle.
 * Preconditions: the model is downward closed and node identities are canonicalizable.
 * Consequence: each returned item is a local completion motif.
 * Witness: the existing boundary nodes and the absent simplex they delimit.
 * Non-claim: a missing-face boundary need not be an independent homology class.
 * Reference: Hatcher, Algebraic Topology, §2.1.
 */
export function findMissingFaces(model: SimplicialModel, maxDimension: 1 | 2 = 2): MissingFaceBoundary[] {
  const bySize = new Map<number, Set<string>>();
  for (const simplex of model.simplices.values()) {
    const size = simplex.nodes.length;
    const keys = bySize.get(size) ?? new Set<string>();
    keys.add(normalizeKey(simplex.nodes));
    bySize.set(size, keys);
  }

  const result: MissingFaceBoundary[] = [];
  if (maxDimension >= 1) result.push(...missingTriangles(model, bySize));
  if (maxDimension >= 2) result.push(...missingTetrahedra(bySize));
  return result;
}

function missingTriangles(model: SimplicialModel, bySize: Map<number, Set<string>>): MissingFaceBoundary[] {
  const adjacency = new Map<NodeID, Set<NodeID>>([...model.nodes.keys()].map((id) => [id, new Set()]));
  for (const simplex of model.simplices.values()) {
    if (simplex.nodes.length !== 2) continue;
    const [a, b] = simplex.nodes;
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  }
  const triangles = bySize.get(3) ?? new Set<string>();
  const emitted = new Set<string>();
  const motifs: MissingFaceBoundary[] = [];
  for (const [a, adjacent] of adjacency) {
    const neighbors = normalizeNodes([...adjacent]);
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const b = neighbors[i];
        const c = neighbors[j];
        if (!adjacency.get(b)?.has(c)) continue;
        const nodes = normalizeNodes([a, b, c]);
        const key = normalizeKey(nodes);
        if (triangles.has(key) || emitted.has(key)) continue;
        emitted.add(key);
        motifs.push({ dimension: 1, boundaryNodes: nodes, missingSimplex: [...nodes] });
      }
    }
  }
  return motifs.sort((a, b) => normalizeKey(a.missingSimplex).localeCompare(normalizeKey(b.missingSimplex)));
}

function missingTetrahedra(bySize: Map<number, Set<string>>): MissingFaceBoundary[] {
  const triangles = bySize.get(3) ?? new Set<string>();
  const tetrahedra = bySize.get(4) ?? new Set<string>();
  const candidates = new Map<string, NodeID[]>();
  const triangleNodes = [...triangles].map((key) => key.split("|"));
  for (let i = 0; i < triangleNodes.length; i++) {
    for (let j = i + 1; j < triangleNodes.length; j++) {
      const union = normalizeNodes([...new Set([...triangleNodes[i], ...triangleNodes[j]])]);
      if (union.length === 4) candidates.set(normalizeKey(union), union);
    }
  }
  const motifs: MissingFaceBoundary[] = [];
  for (const [key, nodes] of candidates) {
    if (tetrahedra.has(key)) continue;
    const allFaces = nodes.every((_, omitted) => triangles.has(normalizeKey(nodes.filter((__, i) => i !== omitted))));
    if (allFaces) motifs.push({ dimension: 2, boundaryNodes: [...nodes], missingSimplex: [...nodes] });
  }
  return motifs.sort((a, b) => normalizeKey(a.missingSimplex).localeCompare(normalizeKey(b.missingSimplex)));
}
