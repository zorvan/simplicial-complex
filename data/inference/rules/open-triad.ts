import type { CandidateSimplex, RawGraph, InferenceConfig } from "../types";
import type { Hole } from "../../../core/types";
import { getNeighborsAbove, getEdgeStrength } from "../graph";

/**
 * Detect open triads from pre-computed Betti holes (β₁).
 * This avoids the O(n × d²) enumeration in detectOpenTriads by using
 * the already-computed unfilled triangles from Betti analysis.
 */
export function detectOpenTriadsFromHoles(
  holes: Hole[],
  graph: RawGraph,
  config: InferenceConfig,
): CandidateSimplex[] {
  const candidates: CandidateSimplex[] = [];

  for (const hole of holes) {
    if (hole.dimension !== 1) continue; // Only use β₁ holes (unfilled triangles)
    if (hole.boundaryNodes.length !== 3) continue;

    const [a, b, c] = hole.boundaryNodes;

    const abS = getEdgeStrength(a, b, graph);
    const bcS = getEdgeStrength(b, c, graph);
    const acS = getEdgeStrength(a, c, graph);

    // Skip if any edge is missing (not a true hole)
    if (abS === 0 || bcS === 0 || acS === 0) continue;

    // Skip if there's already a strong direct connection
    const triadScore = abS + bcS + acS;
    const weight = Math.min(0.9, Math.max(0.3, triadScore / 3));

    // Find the bridge node (highest-degree of the three)
    const aDeg = getNeighborsAbove(a, 0, graph).length;
    const bDeg = getNeighborsAbove(b, 0, graph).length;
    const cDeg = getNeighborsAbove(c, 0, graph).length;
    const bridgeNode = [a, b, c].sort((x, y) => {
      const xDeg = x === a ? aDeg : x === b ? bDeg : cDeg;
      const yDeg = y === a ? aDeg : y === b ? bDeg : cDeg;
      return yDeg - xDeg;
    })[0];

    candidates.push({
      nodes: [a, b, c],
      source: 'inferred-bridge',
      bridgeNode,
      triadScore,
      label: null,
      weight,
    });
  }

  return candidates;
}

export function detectOpenTriads(graph: RawGraph, config: InferenceConfig): CandidateSimplex[] {
  const candidates: CandidateSimplex[] = [];
  const nodes = [...graph.nodes.keys()];
  const LINK_THRESHOLD = config.linkStrengthThreshold;
  const CLOSURE_THRESHOLD = config.closureThreshold;

  for (const b of nodes) {
    const bNeighbors = getNeighborsAbove(b, LINK_THRESHOLD, graph);
    for (let i = 0; i < bNeighbors.length; i++) {
      for (let j = i + 1; j < bNeighbors.length; j++) {
        const a = bNeighbors[i];
        const c = bNeighbors[j];

        const acStrength = getEdgeStrength(a, c, graph);
        if (acStrength >= CLOSURE_THRESHOLD) continue;

        const abStrength = getEdgeStrength(a, b, graph);
        const bcStrength = getEdgeStrength(b, c, graph);

        const triadScore = abStrength + bcStrength - acStrength * 2;
        const weight = Math.min(0.9, Math.max(0.3, triadScore / 2));

        candidates.push({
          nodes: [a, b, c],
          source: 'inferred-bridge',
          bridgeNode: b,
          triadScore,
          label: null,
          weight,
        });
      }
    }
  }

  return candidates;
}
