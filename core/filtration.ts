import type { SimplicialModel } from "./model.js";
import type { NodeID, Simplex, RenderFilterMetric } from "./types.js";

export interface FiltrationEvent {
  threshold: number;
  type: "component-merge" | "triangle-close" | "void-open" | "void-fill" | "edge-appear";
  nodes: NodeID[];
  description: string;
}

/**
 * Compute topological events that occur during filtration.
 * Events are detected by sorting simplices by weight and tracking
 * when the complex changes topology.
 */
export function computeFiltrationEvents(model: SimplicialModel, metric: RenderFilterMetric): FiltrationEvent[] {
  const events: FiltrationEvent[] = [];

  const simplices = [...model.simplices.entries()]
    .map(([key, simplex]) => ({
      key,
      simplex,
      weight: getSimplexWeight(simplex, metric),
    }))
    .sort((a, b) => b.weight - a.weight);

  const appearedNodes = new Set<NodeID>();
  const nodeComponent = new Map<NodeID, Set<NodeID>>(); // node -> its connected component
  const appearedTriangles = new Set<string>();

  // Register a node as a singleton component the first time it is seen (on a 0- or
  // 1-simplex). The model never emits 0-simplices, so without this lazy seeding
  // component tracking stayed empty and no merge events ever fired.
  const ensureNode = (node: NodeID, weight: number): void => {
    if (appearedNodes.has(node)) return;
    appearedNodes.add(node);
    nodeComponent.set(node, new Set([node]));
    events.push({
      threshold: weight,
      type: "edge-appear",
      nodes: [node],
      description: `Node ${node} appears`,
    });
  };

  for (const { simplex, weight } of simplices) {
    const dim = simplex.nodes.length - 1;

    if (dim === 0) {
      ensureNode(simplex.nodes[0], weight);
    } else if (dim === 1) {
      // Edge appears - seed its endpoints, then check for a component merge.
      const [a, b] = simplex.nodes;
      ensureNode(a, weight);
      ensureNode(b, weight);
      const compA = nodeComponent.get(a)!;
      const compB = nodeComponent.get(b)!;

      if (compA !== compB) {
        // Merge components
        const merged = new Set([...compA, ...compB]);
        for (const node of merged) {
          nodeComponent.set(node, merged);
        }
        events.push({
          threshold: weight,
          type: "component-merge",
          nodes: [a, b],
          description: `Components merge via ${a} ↔ ${b}`,
        });
      }
    } else if (dim === 2) {
      // Triangle appears - check if it closes a hole
      const triangleKey = [...simplex.nodes].sort().join("|");

      // Check if this triangle fills a previously open 1-dimensional hole
      const edges = getTriangleEdges(simplex.nodes);
      const allEdgesExisted = edges.every((edge) => {
        const edgeKey = [...edge].sort().join("|");
        return simplices.some(
          (s) => s.simplex.nodes.length === 2 && [...s.simplex.nodes].sort().join("|") === edgeKey && s.weight > weight,
        );
      });

      if (allEdgesExisted && !appearedTriangles.has(triangleKey)) {
        appearedTriangles.add(triangleKey);
        events.push({
          threshold: weight,
          type: "triangle-close",
          nodes: simplex.nodes,
          description: `Triangle closes: ${simplex.nodes.join(" · ")}`,
        });
      }
    }
  }

  return events.sort((a, b) => b.threshold - a.threshold);
}

function getSimplexWeight(simplex: Simplex, metric: RenderFilterMetric): number {
  if (metric === "confidence") return simplex.confidence ?? simplex.weight ?? 0;
  if (metric === "decayed-weight") return simplex.decayedWeight ?? simplex.weight ?? simplex.confidence ?? 0;
  return simplex.weight ?? simplex.decayedWeight ?? simplex.confidence ?? 0;
}

function getTriangleEdges(nodes: NodeID[]): [NodeID, NodeID][] {
  const edges: [NodeID, NodeID][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push([nodes[i], nodes[j]]);
    }
  }
  return edges;
}

/**
 * Get unique threshold values where events occur, for slider markers.
 */
export function getEventThresholds(events: FiltrationEvent[]): number[] {
  const thresholds = new Set(events.map((e) => Math.round(e.threshold * 100) / 100));
  return [...thresholds].sort((a, b) => a - b);
}
