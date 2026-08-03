import type { SubsetScorer } from "../../core/diagnostics.js";
import { buildRawGraph, getEdgeStrength } from "./graph.js";
import type { InferenceConfig, InferenceContext, RawGraph } from "./types.js";

/**
 * The signal side of HG-12.
 *
 * Face independence compares a subgroup against the whole, so both must be scored
 * by one function on one scale. `computeEdgeStrength` — the function the simplicial
 * inference already builds its candidates from — is defined on pairs; this
 * generalizes it to any arity as the mean strength over the group's internal pairs,
 * so arity 2 is exactly the existing measure and nothing is scored twice ways.
 *
 * `scoreCandidate` is deliberately *not* used here. Its diversity gates zero out any
 * same-role, same-domain candidate, which would make every homogeneous encounter
 * read as maximally irreducible for a reason that has nothing to do with evidence.
 */
export function createSubsetScorer(contexts: InferenceContext[], config: InferenceConfig): SubsetScorer {
  const graph = buildRawGraph(contexts, config);
  return (nodes) => scoreGroup(nodes, graph);
}

export function scoreGroup(nodes: string[], graph: RawGraph): number {
  if (nodes.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      total += getEdgeStrength(nodes[i], nodes[j], graph);
      pairs++;
    }
  }
  return pairs > 0 ? total / pairs : 0;
}
