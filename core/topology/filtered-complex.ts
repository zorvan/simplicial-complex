import { normalizeKey } from "../normalize.js";
import type { SimplexKey } from "../types.js";
import type { TopologyInput } from "./backend.js";

/** Tie-break and repair policy version. Part of the analysis cache key: changing it changes pairings. */
export const TIE_POLICY_VERSION = "filtration-order-v1";

export interface FilteredSimplex {
  key: SimplexKey;
  /** Vertex indices into `TopologyInput.vertexKeys`, ascending. */
  vertices: number[];
  dimension: number;
  /** Filtration value after face-condition repair. Increasing sublevel. */
  value: number;
  /** Value derived from the metric before repair. Equal to `value` when nothing was repaired. */
  rawValue: number;
  /** The metric score this value came from, kept so the UI can show evidence rather than 1-score. */
  score: number;
  order: number;
}

export interface FiltrationRepair {
  simplexKey: SimplexKey;
  /** The face that forced the delay. */
  faceKey: SimplexKey;
  rawValue: number;
  repairedValue: number;
}

export interface FilteredComplex {
  /** Every simplex in one total order satisfying the face condition. */
  simplices: FilteredSimplex[];
  order: Map<SimplexKey, number>;
  /**
   * Boundary columns parallel to `simplices`, over F2 and indexed by *filtration order*
   * rather than by a per-dimension basis. Column j lists the order indices of the
   * codimension-one faces of simplex j, ascending. Dimension-0 columns are empty.
   */
  boundaries: Uint32Array[];
  repairs: FiltrationRepair[];
  maxDimension: number;
  tiePolicy: string;
}

/**
 * Mathematical object: a finite simplicial complex K with a monotone filtration
 * f:K→R, presented as the single total order used by the reduction.
 * Result used: the sublevel sets of f are subcomplexes iff f(face)≤f(coface); a
 * total order refining f in which every face precedes its cofaces therefore has
 * every prefix downward closed.
 * Preconditions: K is finite and downward closed; raw values are finite.
 * Consequence: each ordered prefix is a simplicial complex, which is exactly what
 * the persistence reduction assumes when it treats column j as "insert simplex j".
 * Witness: `repairs` names every simplex whose raw value was delayed, and by which face.
 * Non-claim: the order within a tie is a policy (`TIE_POLICY_VERSION`), not a
 * mathematical fact. Pairings of equal-valued simplices depend on it.
 * Reference: Edelsbrunner and Harer, Computational Topology, Ch. VII.1.
 */
export function buildFilteredComplex(input: TopologyInput): FilteredComplex {
  const maxDimension = input.maxHomologyDimension;
  // Cofaces one dimension above the analyzed skeleton are retained: killing a class
  // in H_k requires the (k+1)-simplices whose boundaries bound it.
  const throughDimension = maxDimension + 1;

  const entries = new Map<
    SimplexKey,
    { key: SimplexKey; vertices: number[]; dimension: number; raw: number; score: number }
  >();

  // Every note exists from the start of the filtration. Relations appear as evidence
  // accumulates, so vertices enter at 0 and nothing can precede them.
  input.vertexKeys.forEach((vertexKey, index) => {
    const key = normalizeKey([vertexKey]);
    entries.set(key, { key, vertices: [index], dimension: 0, raw: 0, score: 1 });
  });

  for (let i = 0; i < input.simplexDimensions.length; i++) {
    const dimension = input.simplexDimensions[i];
    if (dimension > throughDimension) continue;
    const vertices = [...input.simplexVertices.slice(input.simplexOffsets[i], input.simplexOffsets[i + 1])].sort(
      (a, b) => a - b,
    );
    const raw = input.filtrationValues[i];
    if (!Number.isFinite(raw)) throw new Error(`Filtration value for ${input.stableKeys[i]} is not finite`);
    entries.set(input.stableKeys[i], { key: input.stableKeys[i], vertices, dimension, raw, score: 1 - raw });
  }

  const byDimension = [...entries.values()].sort((a, b) => a.dimension - b.dimension || a.key.localeCompare(b.key));
  const faceKeys = new Map<SimplexKey, SimplexKey[]>();
  for (const entry of byDimension) {
    if (entry.dimension === 0) {
      faceKeys.set(entry.key, []);
      continue;
    }
    const keys = entry.vertices.map((_, omitted) =>
      normalizeKey(entry.vertices.filter((__, index) => index !== omitted).map((index) => input.vertexKeys[index])),
    );
    for (const faceKey of keys) {
      if (!entries.has(faceKey)) {
        throw new Error(`Filtration input is not downward closed: ${entry.key} lacks ${faceKey}`);
      }
    }
    faceKeys.set(entry.key, keys);
  }

  // Repair by delaying the coface, never by advancing the face: a face's value is
  // evidence the user supplied, and lowering it would invent earlier evidence.
  const values = new Map<SimplexKey, number>();
  const repairs: FiltrationRepair[] = [];
  for (const entry of byDimension) {
    let value = entry.raw;
    let blame: SimplexKey | null = null;
    for (const faceKey of faceKeys.get(entry.key) ?? []) {
      const faceValue = values.get(faceKey) ?? 0;
      if (faceValue > value) {
        value = faceValue;
        blame = faceKey;
      }
    }
    values.set(entry.key, value);
    if (blame !== null) {
      repairs.push({ simplexKey: entry.key, faceKey: blame, rawValue: entry.raw, repairedValue: value });
    }
  }

  const ordered = [...entries.values()]
    .sort(
      (a, b) =>
        (values.get(a.key) as number) - (values.get(b.key) as number) ||
        a.dimension - b.dimension ||
        a.key.localeCompare(b.key),
    )
    .map<FilteredSimplex>((entry, order) => ({
      key: entry.key,
      vertices: entry.vertices,
      dimension: entry.dimension,
      value: values.get(entry.key) as number,
      rawValue: entry.raw,
      score: entry.score,
      order,
    }));

  const order = new Map(ordered.map((simplex) => [simplex.key, simplex.order]));
  const boundaries = ordered.map((simplex) => {
    const keys = faceKeys.get(simplex.key) ?? [];
    const indices = keys.map((faceKey) => {
      const index = order.get(faceKey);
      if (index === undefined) throw new Error(`Face ${faceKey} of ${simplex.key} is missing from the total order`);
      if (index >= simplex.order) {
        throw new Error(`Face precedence violated: ${faceKey} does not precede ${simplex.key}`);
      }
      return index;
    });
    return Uint32Array.from(indices.sort((a, b) => a - b));
  });

  return { simplices: ordered, order, boundaries, repairs, maxDimension, tiePolicy: TIE_POLICY_VERSION };
}
