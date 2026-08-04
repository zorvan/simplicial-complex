import type { RenderFilterMetric, SimplexKey } from "../types.js";
import type { UncertaintyReport } from "./bootstrap.js";
import type { FiltrationRepair } from "./filtered-complex.js";

export interface PersistenceInterval {
  /** Stable within one result: dimension plus the simplex that created the class. */
  id: string;
  dimension: number;
  birth: number;
  /** `null` for an essential class: it never dies inside the analyzed complex. */
  death: number | null;
  birthSimplex: SimplexKey;
  deathSimplex?: SimplexKey;
  lifetime: number | null;
}

/**
 * One cycle that represents the class at its birth. Non-canonical by construction:
 * the reduction returns the basis its column operations happened to produce.
 */
export interface CycleRepresentative {
  intervalId: string;
  dimension: 1 | 2;
  simplices: SimplexKey[];
  boundaryIsZero: true;
  canonical: false;
}

export interface PersistenceDiagnostics {
  simplexCount: number;
  columnOperations: number;
  /** Peak live sparse entries across R and V. The memory number PH-04 budgets against. */
  peakColumnEntries: number;
  zeroLengthIntervalCount: number;
  essentialIntervalCount: number;
  representativesRequested: boolean;
  /** Representatives dropped because their chain failed the boundary check. Must be 0. */
  rejectedRepresentativeCount: number;
}

export interface PersistenceResult {
  /** Includes zero-length intervals; the UI hides them by default. */
  intervals: PersistenceInterval[];
  representatives: CycleRepresentative[];
  repairs: FiltrationRepair[];
  metric: RenderFilterMetric;
  direction: "increasing";
  coefficientField: "F2";
  maxDimension: number;
  tiePolicy: string;
  modelRevision: number;
  diagnostics: PersistenceDiagnostics;
  /** Present only when bootstrap was explicitly enabled; it is off by default. */
  uncertainty?: UncertaintyReport;
}

export interface PersistenceOptions {
  /** Off by default: V-column tracking roughly doubles peak memory. */
  computeRepresentatives?: boolean;
  /** Cooperative cancellation, polled between column batches. */
  shouldCancel?: () => boolean;
  onProgress?: (fraction: number) => void;
  /**
   * Peak live sparse entries before the reduction gives up. Fill-in during reduction is
   * the term that actually grows, and it grows mid-run rather than at input time, so the
   * ceiling has to be enforced here and not only against the input size.
   */
  maxColumnEntries?: number;
}

export class PersistenceCancelledError extends Error {
  constructor(readonly completedColumns: number) {
    super(`Persistence reduction cancelled after ${completedColumns} columns`);
    this.name = "PersistenceCancelledError";
  }
}

export class PersistenceLimitExceededError extends Error {
  constructor(
    readonly peakColumnEntries: number,
    readonly limit: number,
    readonly completedColumns: number,
  ) {
    super(
      `Reduction reached ${peakColumnEntries.toLocaleString()} live column entries, above the ${limit.toLocaleString()} ceiling, after ${completedColumns.toLocaleString()} columns`,
    );
    this.name = "PersistenceLimitExceededError";
  }
}

/** Intervals alive at a threshold. PH-06 derives Betti numbers from exactly this. */
export function intervalsAlive(intervals: PersistenceInterval[], threshold: number): PersistenceInterval[] {
  return intervals.filter(
    (interval) => interval.birth <= threshold && (interval.death === null || interval.death > threshold),
  );
}

/** Betti numbers at a threshold, derived from the barcode rather than recomputed. */
export function bettiAtThreshold(intervals: PersistenceInterval[], threshold: number, maxDimension: number): number[] {
  const betti = Array.from({ length: maxDimension + 1 }, () => 0);
  for (const interval of intervalsAlive(intervals, threshold)) {
    if (interval.dimension <= maxDimension) betti[interval.dimension]++;
  }
  return betti;
}
