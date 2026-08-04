import type { RenderFilterMetric, SimplexKey } from "../types.js";
import type { SparseColumn } from "./backend.js";
import { low, xorSparse } from "./chain-complex.js";
import type { FilteredComplex } from "./filtered-complex.js";
import { buildRepresentatives } from "./representatives.js";
import {
  PersistenceCancelledError,
  PersistenceLimitExceededError,
  type PersistenceDiagnostics,
  type PersistenceInterval,
  type PersistenceOptions,
  type PersistenceResult,
} from "./persistence-types.js";

/** Columns processed between cancellation polls. Small enough to stay responsive, large enough not to dominate. */
const CANCELLATION_BATCH = 256;

export interface ReductionState {
  /** Reduced boundary columns, parallel to the filtration order. */
  reduced: SparseColumn[];
  /** Change-of-basis columns, or `null` when representatives were not requested. */
  basis: SparseColumn[] | null;
  /** Birth column -> death column. */
  pairs: Map<number, number>;
  diagnostics: PersistenceDiagnostics;
}

/**
 * Mathematical object: the persistence module of the filtered complex over F2,
 * presented by the filtered boundary matrix D in filtration order.
 * Result used: the matrix-reduction pairing theorem. Reducing D left to right so
 * that no two columns share a lowest nonzero row yields R=DV with V upper
 * unitriangular; low(R_j)=i pairs the class born with simplex i to its death at
 * simplex j, and a zero column j creates a class. The pairing is independent of
 * the reduction's choices even though R and V are not.
 * Preconditions: every prefix of the order is a subcomplex (PH-01 guarantees this).
 * Consequence: births and deaths are read off the pairing rather than detected by
 * inspecting the complex at sampled thresholds.
 * Witness: the V columns of zero R columns are cycles; see representatives.ts.
 * Non-claim: this is not Smith normal form. The filtration order is essential and
 * must not be permuted; a normal form would discard exactly the information sought.
 * Reference: Edelsbrunner, Letscher and Zomorodian, Topological Persistence and
 * Simplification; Zomorodian and Carlsson, Computing Persistent Homology.
 */
export function reduceBoundaryMatrix(complex: FilteredComplex, options: PersistenceOptions = {}): ReductionState {
  const steps = reduceBoundaryMatrixSteps(complex, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * The same reduction, driven asynchronously.
 *
 * This is what the worker uses, and the reason it exists is not style. A worker has one
 * thread: while the synchronous loop runs, the message queue is never drained, so a
 * `cancel` message cannot be delivered and `shouldCancel` polls a flag that physically
 * cannot have arrived. Cooperative cancellation only works if the reduction actually
 * returns to the event loop.
 *
 * Yielding is gated on elapsed time rather than on every batch: a reduction that finishes
 * in a few milliseconds never yields at all, so the common case pays nothing, while a long
 * one becomes interruptible within `yieldIntervalMs`.
 */
export async function reduceBoundaryMatrixAsync(
  complex: FilteredComplex,
  options: PersistenceOptions = {},
  yieldControl: () => Promise<void> = defaultYield,
  yieldIntervalMs = 8,
): Promise<ReductionState> {
  const steps = reduceBoundaryMatrixSteps(complex, options);
  const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());
  let lastYield = now();
  let step = steps.next();
  while (!step.done) {
    if (now() - lastYield >= yieldIntervalMs) {
      await yieldControl();
      lastYield = now();
    }
    step = steps.next();
  }
  return step.value;
}

function defaultYield(): Promise<void> {
  // A bare `setTimeout`, deliberately. This module is the worker's reduction engine and a
  // worker has no `window` to reach the timer through, so the rule's fix would throw on
  // the very path it is applied to. The popout-window lifetime concern the rule guards
  // against does not reach code that never touches a document.
  // eslint-disable-next-line obsidianmd/prefer-window-timers
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Suspends at column-batch boundaries so a driver can decide whether to yield the thread. */
function* reduceBoundaryMatrixSteps(
  complex: FilteredComplex,
  options: PersistenceOptions = {},
): Generator<number, ReductionState> {
  const count = complex.simplices.length;
  const reduced: SparseColumn[] = complex.boundaries.map((column) => Uint32Array.from(column));
  const basis: SparseColumn[] | null = options.computeRepresentatives
    ? complex.boundaries.map((_, index) => Uint32Array.of(index))
    : null;
  const pivotOwner = new Map<number, number>();
  const pairs = new Map<number, number>();

  let columnOperations = 0;
  let liveEntries = reduced.reduce((total, column) => total + column.length, 0) + (basis ? count : 0);
  let peakColumnEntries = liveEntries;

  for (let j = 0; j < count; j++) {
    if (j % CANCELLATION_BATCH === 0) {
      if (options.shouldCancel?.()) throw new PersistenceCancelledError(j);
      options.onProgress?.(count === 0 ? 1 : j / count);
      // Hand control back to the driver, which may return the thread to the event loop
      // so a pending cancel can actually be delivered.
      yield j;
    }

    let column = reduced[j];
    let basisColumn = basis?.[j];
    for (;;) {
      const pivot = low(column);
      if (pivot === null) break;
      const owner = pivotOwner.get(pivot);
      if (owner === undefined) {
        pivotOwner.set(pivot, j);
        pairs.set(pivot, j);
        break;
      }
      liveEntries -= column.length + (basisColumn?.length ?? 0);
      column = xorSparse(column, reduced[owner]);
      if (basis && basisColumn) basisColumn = xorSparse(basisColumn, basis[owner]);
      liveEntries += column.length + (basisColumn?.length ?? 0);
      peakColumnEntries = Math.max(peakColumnEntries, liveEntries);
      columnOperations++;
      if (options.maxColumnEntries !== undefined && peakColumnEntries > options.maxColumnEntries) {
        throw new PersistenceLimitExceededError(peakColumnEntries, options.maxColumnEntries, j);
      }
    }
    reduced[j] = column;
    if (basis && basisColumn) basis[j] = basisColumn;
  }

  options.onProgress?.(1);
  return {
    reduced,
    basis,
    pairs,
    diagnostics: {
      simplexCount: count,
      columnOperations,
      peakColumnEntries,
      zeroLengthIntervalCount: 0,
      essentialIntervalCount: 0,
      representativesRequested: Boolean(options.computeRepresentatives),
      rejectedRepresentativeCount: 0,
    },
  };
}

export interface PersistenceContext {
  metric: RenderFilterMetric;
  modelRevision: number;
  /**
   * Required rather than defaulted. Witness tracking roughly doubles peak memory, so
   * the choice belongs to the caller — and a silent default here reads as "no witnesses
   * were retained" at the UI, which is indistinguishable from a reduction that found none.
   */
  computeRepresentatives: boolean;
}

export function computePersistence(
  complex: FilteredComplex,
  context: PersistenceContext,
  options: PersistenceOptions = {},
): PersistenceResult {
  return assemble(
    complex,
    context,
    reduceBoundaryMatrix(complex, { ...options, computeRepresentatives: context.computeRepresentatives }),
  );
}

/**
 * The worker's entry point into the reduction. Identical results to `computePersistence`;
 * it differs only in returning the thread to the event loop periodically, which is what
 * makes a `cancel` message deliverable mid-reduction.
 */
export async function computePersistenceAsync(
  complex: FilteredComplex,
  context: PersistenceContext,
  options: PersistenceOptions = {},
): Promise<PersistenceResult> {
  const state = await reduceBoundaryMatrixAsync(complex, {
    ...options,
    computeRepresentatives: context.computeRepresentatives,
  });
  return assemble(complex, context, state);
}

function assemble(complex: FilteredComplex, context: PersistenceContext, state: ReductionState): PersistenceResult {
  const intervals: PersistenceInterval[] = [];

  for (let j = 0; j < complex.simplices.length; j++) {
    // A nonzero reduced column kills an older class; it does not create one.
    if (state.reduced[j].length > 0) continue;
    const birth = complex.simplices[j];
    // Cofaces one dimension above the analyzed skeleton are present only to kill
    // classes below them; they do not contribute classes of their own.
    if (birth.dimension > complex.maxDimension) continue;
    const deathColumn = state.pairs.get(j);
    const death = deathColumn === undefined ? null : complex.simplices[deathColumn];
    intervals.push({
      id: intervalId(birth.dimension, birth.key),
      dimension: birth.dimension,
      birth: birth.value,
      death: death ? death.value : null,
      birthSimplex: birth.key,
      ...(death ? { deathSimplex: death.key } : {}),
      lifetime: death ? death.value - birth.value : null,
    });
  }

  intervals.sort(
    (a, b) =>
      a.dimension - b.dimension ||
      a.birth - b.birth ||
      (b.lifetime ?? Infinity) - (a.lifetime ?? Infinity) ||
      a.birthSimplex.localeCompare(b.birthSimplex),
  );

  const representatives = buildRepresentatives(complex, state, intervals);
  const diagnostics: PersistenceDiagnostics = {
    ...state.diagnostics,
    zeroLengthIntervalCount: intervals.filter((interval) => interval.lifetime === 0).length,
    essentialIntervalCount: intervals.filter((interval) => interval.death === null).length,
    rejectedRepresentativeCount: representatives.rejected,
  };

  return {
    intervals,
    representatives: representatives.representatives,
    repairs: complex.repairs,
    metric: context.metric,
    direction: "increasing",
    coefficientField: "F2",
    maxDimension: complex.maxDimension,
    tiePolicy: complex.tiePolicy,
    modelRevision: context.modelRevision,
    diagnostics,
  };
}

export function intervalId(dimension: number, birthSimplex: SimplexKey): string {
  return `H${dimension}:${birthSimplex}`;
}
