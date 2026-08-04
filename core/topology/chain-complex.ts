import type { SimplicialModel } from "../model.js";
import { normalizeKey, normalizeNodes } from "../normalize.js";
import type { BettiResult, NodeID } from "../types.js";
import type { BoundaryOperator, ChainBasis, ChainComplex, SparseColumn, TopologyInput } from "./backend.js";

/**
 * Mathematical object: C_k(K; F2) with simplex bases and boundary maps ∂_k:C_k→C_{k-1}.
 * Result used: simplicial boundary-of-boundary theorem ∂_{k-1}∂_k=0.
 * Preconditions: K is finite and downward closed; vertices are uniquely named.
 * Consequence: boundary ranks determine finite-dimensional homology by rank-nullity.
 * Witness: canonical bases and inspectable sparse boundary columns.
 * Non-claim: no representative basis is canonical beyond the declared simplex order.
 * Reference: Hatcher, Algebraic Topology, §2.1.
 */
export function buildChainComplex(model: SimplicialModel, throughDimension = Infinity): ChainComplex {
  const keysByDimension = new Map<number, string[]>();
  keysByDimension.set(
    0,
    normalizeNodes([...model.nodes.keys()]).map((id) => normalizeKey([id])),
  );
  for (const simplex of model.simplices.values()) {
    const dimension = simplex.nodes.length - 1;
    if (dimension > throughDimension) continue;
    const keys = keysByDimension.get(dimension) ?? [];
    keys.push(normalizeKey(simplex.nodes));
    keysByDimension.set(dimension, keys);
  }
  const top = Math.max(0, ...keysByDimension.keys());
  const bases: ChainBasis[] = [];
  for (let dimension = 0; dimension <= top; dimension++) {
    const simplices = [...new Set(keysByDimension.get(dimension) ?? [])].sort();
    bases.push({ dimension, simplices, index: new Map(simplices.map((key, index) => [key, index])) });
  }
  const boundaries: BoundaryOperator[] = [];
  for (let dimension = 1; dimension <= top; dimension++) {
    const rows = bases[dimension - 1];
    const columns = bases[dimension];
    const data = columns.simplices.map((key) => {
      const nodes = key.split("|");
      const indices = nodes.map((_, omitted) => rows.index.get(normalizeKey(nodes.filter((__, i) => i !== omitted))));
      if (indices.some((index) => index === undefined)) {
        throw new Error(`Topology input is not downward closed: ${key} lacks a codimension-one face`);
      }
      return Uint32Array.from((indices as number[]).sort((a, b) => a - b));
    });
    boundaries.push({ dimension, rows, columns, data });
  }
  return { bases, boundaries, maxDimension: top };
}

export function xorSparse(left: SparseColumn, right: SparseColumn): SparseColumn {
  const result: number[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (j >= right.length || (i < left.length && left[i] < right[j])) result.push(left[i++]);
    else if (i >= left.length || right[j] < left[i]) result.push(right[j++]);
    else {
      i++;
      j++;
    }
  }
  return Uint32Array.from(result);
}

export function low(column: SparseColumn): number | null {
  return column.length ? column[column.length - 1] : null;
}

export function sparseRank(columns: SparseColumn[]): number {
  const pivots = new Map<number, SparseColumn>();
  let rank = 0;
  for (const source of columns) {
    let column: SparseColumn = Uint32Array.from(source);
    for (;;) {
      const pivot = low(column);
      if (pivot === null) break;
      const prior = pivots.get(pivot);
      if (!prior) {
        pivots.set(pivot, column);
        rank++;
        break;
      }
      column = xorSparse(column, prior);
    }
  }
  return rank;
}

/** Rank-nullity: β_k=dim C_k-rank ∂_k-rank ∂_{k+1}. */
export function computeStaticHomology(model: SimplicialModel, maxDimension: number): BettiResult {
  const complex = buildChainComplex(model, maxDimension + 1);
  const boundaryRanks = Array.from({ length: maxDimension + 2 }, () => 0);
  for (const boundary of complex.boundaries) boundaryRanks[boundary.dimension] = sparseRank(boundary.data);
  const chainDimensions = Array.from({ length: maxDimension + 2 }, (_, k) => complex.bases[k]?.simplices.length ?? 0);
  const betti = Array.from(
    { length: maxDimension + 1 },
    (_, k) => chainDimensions[k] - boundaryRanks[k] - boundaryRanks[k + 1],
  );
  return {
    b0: betti[0] ?? 0,
    b1: betti[1] ?? 0,
    b2: betti[2] ?? 0,
    coefficientField: "F2",
    betti,
    // Include C_(d+1): those cofaces are part of the analyzed truncation because
    // their boundary rank is required to determine H_d.
    chainDimensions: chainDimensions.slice(0, maxDimension + 2),
    boundaryRanks: boundaryRanks.slice(0, maxDimension + 2),
    maxDimension,
    modelRevision: model.revision,
  };
}

export function topologyInputToModelData(input: TopologyInput): { nodes: NodeID[]; simplices: NodeID[][] } {
  if (input.simplexOffsets.length !== input.simplexDimensions.length + 1) throw new Error("Invalid simplex offsets");
  if (input.stableKeys.length !== input.simplexDimensions.length) throw new Error("Invalid stable-key table");
  if (input.filtrationValues.length !== input.simplexDimensions.length) throw new Error("Invalid filtration table");
  if ([...input.filtrationValues].some((value) => !Number.isFinite(value))) throw new Error("Invalid filtration value");
  const simplices: NodeID[][] = [];
  for (let i = 0; i < input.simplexDimensions.length; i++) {
    const start = input.simplexOffsets[i];
    const end = input.simplexOffsets[i + 1];
    if (end < start || end > input.simplexVertices.length) throw new Error("Invalid simplex vertex range");
    const nodes = [...input.simplexVertices.slice(start, end)].map((index) => input.vertexKeys[index]);
    if (nodes.some((node) => node === undefined) || nodes.length !== input.simplexDimensions[i] + 1) {
      throw new Error("Invalid simplex dimension or vertex index");
    }
    simplices.push(nodes);
  }
  return { nodes: input.vertexKeys, simplices };
}

/** Serialize the simplicial layer only; hyperedges never cross the topology boundary. */
export function createTopologyInput(
  model: SimplicialModel,
  requestId: string,
  maxHomologyDimension = 2,
): TopologyInput {
  const vertexKeys = normalizeNodes([...model.nodes.keys()]);
  const vertexIndex = new Map(vertexKeys.map((key, index) => [key, index]));
  const records = [...model.simplices.values()]
    .map((simplex) => ({ nodes: normalizeNodes(simplex.nodes), key: normalizeKey(simplex.nodes) }))
    .sort((a, b) => a.nodes.length - b.nodes.length || a.key.localeCompare(b.key));
  const offsets = [0];
  const vertices: number[] = [];
  for (const record of records) {
    for (const node of record.nodes) {
      const index = vertexIndex.get(node);
      if (index === undefined) throw new Error(`Simplex ${record.key} references unknown vertex ${node}`);
      vertices.push(index);
    }
    offsets.push(vertices.length);
  }
  return {
    requestId,
    vertexKeys,
    simplexOffsets: Uint32Array.from(offsets),
    simplexVertices: Uint32Array.from(vertices),
    simplexDimensions: Uint16Array.from(records.map((record) => record.nodes.length - 1)),
    filtrationValues: Float64Array.from(records.map(() => 0)),
    stableKeys: records.map((record) => record.key),
    maxHomologyDimension,
    modelRevision: model.revision,
  };
}
