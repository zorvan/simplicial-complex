import type { BettiResult, SimplexKey } from "../types.js";

export type SparseColumn = Uint32Array;

export interface ChainBasis {
  dimension: number;
  simplices: SimplexKey[];
  index: Map<SimplexKey, number>;
}

export interface BoundaryOperator {
  dimension: number;
  rows: ChainBasis;
  columns: ChainBasis;
  data: SparseColumn[];
}

export interface ChainComplex {
  bases: ChainBasis[];
  boundaries: BoundaryOperator[];
  maxDimension: number;
}

/** Flat, transferable snapshot. Offsets delimit vertex-index slices for each simplex. */
export interface TopologyInput {
  requestId: string;
  vertexKeys: string[];
  simplexOffsets: Uint32Array;
  simplexVertices: Uint32Array;
  simplexDimensions: Uint16Array;
  filtrationValues: Float64Array;
  stableKeys: string[];
  maxHomologyDimension: number;
  modelRevision: number;
}

export interface TopologyCapabilities {
  coefficientFields: readonly ["F2"];
  maxHomologyDimension: number;
  persistence: boolean;
}

export interface TopologyBackend {
  capabilities(): TopologyCapabilities;
  computeStatic(input: TopologyInput): Promise<BettiResult>;
  computePersistence(input: TopologyInput): Promise<never>;
  cancel(requestId: string): void;
}
