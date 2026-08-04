import type { SparseColumn } from "./backend.js";
import { xorSparse } from "./chain-complex.js";
import type { FilteredComplex } from "./filtered-complex.js";
import type { CycleRepresentative, PersistenceInterval } from "./persistence-types.js";
import type { ReductionState } from "./persistence.js";

export interface RepresentativeReport {
  representatives: CycleRepresentative[];
  /** Chains that failed ∂z=0 and were withheld rather than displayed. Must be 0. */
  rejected: number;
}

/**
 * Mathematical object: a birth-cycle representative z of the class recorded by an
 * interval, expressed in the simplex basis of the filtered complex.
 * Result used: in R=DV, a zero column R_j means DV_j=0, so the chain V_j is a
 * cycle; V is unitriangular, so V_j contains simplex j itself and z is born
 * exactly when j enters the filtration.
 * Preconditions: the reduction ran with representative tracking enabled.
 * Consequence: every displayed bar can name concrete notes and relations that
 * carry the class, not merely a lifetime.
 * Witness: `simplices` are stable keys and `boundaryIsZero` is verified here by
 * recomputing ∂z over F2 rather than asserted.
 * Non-claim: z is not canonical and not minimal. Another valid reduction yields a
 * different representative of the same class, and no shortest-cycle claim is made;
 * see the deferred optimization note in PH-03.6.
 * Reference: Zomorodian and Carlsson, Computing Persistent Homology, §4.
 */
export function buildRepresentatives(
  complex: FilteredComplex,
  state: ReductionState,
  intervals: PersistenceInterval[],
): RepresentativeReport {
  if (!state.basis) return { representatives: [], rejected: 0 };
  const basis = state.basis;

  const representatives: CycleRepresentative[] = [];
  let rejected = 0;

  for (const interval of intervals) {
    // Dimension 0 classes are connected components; a single vertex is a correct but
    // uninformative witness, and the panel already names components.
    if (interval.dimension !== 1 && interval.dimension !== 2) continue;
    const birthColumn = complex.order.get(interval.birthSimplex);
    if (birthColumn === undefined) continue;
    const chain = basis[birthColumn];
    if (!chain || chain.length === 0) continue;

    if (!boundaryIsZero(complex, chain)) {
      rejected++;
      continue;
    }
    // A finite interval must be killed by its paired simplex: the death column
    // reduces to a column whose lowest entry is exactly the birth column.
    if (interval.deathSimplex !== undefined) {
      const deathColumn = complex.order.get(interval.deathSimplex);
      const reduced = deathColumn === undefined ? undefined : state.reduced[deathColumn];
      if (!reduced || reduced.length === 0 || reduced[reduced.length - 1] !== birthColumn) {
        rejected++;
        continue;
      }
    }

    representatives.push({
      intervalId: interval.id,
      dimension: interval.dimension,
      simplices: [...chain].map((order) => complex.simplices[order].key).sort(),
      boundaryIsZero: true,
      canonical: false,
    });
  }

  return { representatives, rejected };
}

/** ∂z over F2: the symmetric difference of the boundary columns of z's simplices. */
export function boundaryIsZero(complex: FilteredComplex, chain: SparseColumn): boolean {
  let accumulated: SparseColumn = new Uint32Array(0);
  for (const order of chain) {
    accumulated = xorSparse(accumulated, complex.boundaries[order]);
  }
  return accumulated.length === 0;
}
