import type { BettiResult, RenderFilterMetric, SimplexKey } from "../types.js";
import type { BootstrapConfig } from "./bootstrap.js";
import type { PersistenceResult } from "./persistence-types.js";

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
  /** Which score produced `filtrationValues`. Carried so results can state their provenance. */
  metric: RenderFilterMetric;
  /** Opt-in: V-column tracking roughly doubles the reduction's peak memory. */
  computeRepresentatives: boolean;
  /** Absent or disabled means no resampling runs at all. */
  bootstrap?: BootstrapConfig;
}

export interface TopologyCapabilities {
  coefficientFields: readonly ["F2"];
  maxHomologyDimension: number;
  persistence: boolean;
}

export interface TopologyBackend {
  capabilities(): TopologyCapabilities;
  computeStatic(input: TopologyInput): Promise<BettiResult>;
  computePersistence(input: TopologyInput): Promise<PersistenceResult>;
  cancel(requestId: string): void;
}
