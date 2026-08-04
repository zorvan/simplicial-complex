import type { TopologyInput } from "./backend.js";
import { buildFilteredComplex, type FilteredComplex } from "./filtered-complex.js";
import { computePersistence } from "./persistence.js";
import { PersistenceCancelledError, type PersistenceInterval, type PersistenceResult } from "./persistence-types.js";

export type BootstrapMode = "subsample" | "weight-perturbation";

export interface BootstrapConfig {
  enabled: boolean;
  /**
   * Two different procedures answering two different questions. They must never share a
   * label in the UI: subsampling asks whether the feature survives seeing fewer notes,
   * perturbation asks whether it survives the scores being slightly wrong.
   */
  mode: BootstrapMode;
  sampleCount: number;
  /** Subsample mode: fraction of each stratum retained. */
  retainFraction: number;
  /** Perturbation mode: maximum absolute change applied to a filtration value. */
  perturbationScale: number;
  seed: number;
  /** Per-vertex stratum labels, parallel to `vertexKeys`. Absent means one stratum. */
  strata?: string[];
  /** Wall-clock ceiling. A truncated run reports how many samples actually completed. */
  budgetMs: number;
}

export const DEFAULT_BOOTSTRAP_CONFIG: BootstrapConfig = {
  // Off by default: this multiplies a full reduction plus a diagram matching by the
  // resample count. It is an opt-in analysis with a visible cost, not a background task.
  enabled: false,
  mode: "subsample",
  sampleCount: 20,
  retainFraction: 0.8,
  perturbationScale: 0.05,
  seed: 20250804,
  budgetMs: 4000,
};

export interface IntervalSupport {
  intervalId: string;
  /** Fraction of completed resamples in which this feature was matched to a real feature. */
  supportFrequency: number;
  matchedCount: number;
  birthQuantiles: Quantiles | null;
  deathQuantiles: Quantiles | null;
}

export interface Quantiles {
  p05: number;
  p50: number;
  p95: number;
}

export interface UncertaintyReport {
  mode: BootstrapMode;
  seed: number;
  requestedSamples: number;
  completedSamples: number;
  /** True when the wall-clock budget stopped the run before `requestedSamples`. */
  truncated: boolean;
  elapsedMs: number;
  /**
   * Fraction of resampled features that matched the diagonal rather than any feature of
   * the full diagram — resampling artifacts, not evidence about the full diagram.
   */
  unmatchedRate: number;
  /** Human-readable statement of exactly what was resampled. Shown next to every number. */
  samplingScheme: string;
  support: IntervalSupport[];
}

export interface BootstrapOptions {
  shouldCancel?: () => boolean;
  onProgress?: (fraction: number) => void;
  now?: () => number;
}

/**
 * Mathematical object: an empirical distribution of persistence diagrams obtained by
 * resampling the input, compared to the diagram of the full input.
 * Result used: the bottleneck stability theorem — diagrams of two filtered complexes
 * differ in bottleneck distance by at most the sup-norm distance of their filtering
 * functions — supplies the matching's meaning: a feature matched at small bottleneck
 * cost is the same feature seen again, not a coincidence.
 * Preconditions: every resample is itself a valid filtered complex (PH-01 rebuilds it).
 * Consequence: a feature reappearing across resamples is empirically stable under the
 * stated sampling scheme.
 * Witness: `samplingScheme`, `seed` and `completedSamples` reproduce the run exactly.
 * Non-claim: this is bootstrap support, not a confidence band. Stability bounds
 * perturbation of the diagram; it establishes no coverage probability, and none is
 * claimed here. The numbers describe this sampling scheme and nothing else.
 * Reference: Cohen-Steiner, Edelsbrunner and Harer, Stability of Persistence Diagrams.
 */
export function runBootstrap(
  input: TopologyInput,
  full: FilteredComplex,
  fullResult: PersistenceResult,
  config: BootstrapConfig,
  options: BootstrapOptions = {},
): UncertaintyReport {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const random = mulberry32(config.seed);
  const dimensions = [...new Set(fullResult.intervals.map((interval) => interval.dimension))];

  const matchedValues = new Map<string, { births: number[]; deaths: number[] }>();
  fullResult.intervals.forEach((interval) => matchedValues.set(interval.id, { births: [], deaths: [] }));

  let completedSamples = 0;
  let sampleFeatureCount = 0;
  let unmatchedFeatureCount = 0;
  let truncated = false;

  for (let sample = 0; sample < config.sampleCount; sample++) {
    if (options.shouldCancel?.()) throw new PersistenceCancelledError(completedSamples);
    if (now() - started > config.budgetMs) {
      truncated = true;
      break;
    }

    const resampled =
      config.mode === "subsample" ? subsampleInput(input, config, random) : perturbInput(input, config, random);
    if (resampled === null) continue;

    const complex = buildFilteredComplex(resampled);
    const result = computePersistence(complex, {
      metric: input.metric,
      modelRevision: input.modelRevision,
      computeRepresentatives: false,
    });

    for (const dimension of dimensions) {
      const fullPoints = fullResult.intervals.filter((interval) => interval.dimension === dimension);
      const samplePoints = result.intervals.filter((interval) => interval.dimension === dimension);
      const matching = bottleneckMatch(fullPoints.map(toPoint), samplePoints.map(toPoint));

      matching.forEach((sampleIndex, fullIndex) => {
        if (sampleIndex === null) return;
        const record = matchedValues.get(fullPoints[fullIndex].id);
        if (!record) return;
        const point = toPoint(samplePoints[sampleIndex]);
        record.births.push(point.birth);
        if (Number.isFinite(point.death)) record.deaths.push(point.death);
      });

      const matchedSamples = new Set(matching.filter((index): index is number => index !== null));
      sampleFeatureCount += samplePoints.length;
      unmatchedFeatureCount += samplePoints.length - matchedSamples.size;
    }

    completedSamples++;
    options.onProgress?.((sample + 1) / config.sampleCount);
  }

  const support: IntervalSupport[] = fullResult.intervals.map((interval) => {
    const record = matchedValues.get(interval.id) ?? { births: [], deaths: [] };
    return {
      intervalId: interval.id,
      supportFrequency: completedSamples === 0 ? 0 : record.births.length / completedSamples,
      matchedCount: record.births.length,
      birthQuantiles: quantilesOf(record.births),
      deathQuantiles: quantilesOf(record.deaths),
    };
  });

  return {
    mode: config.mode,
    seed: config.seed,
    requestedSamples: config.sampleCount,
    completedSamples,
    truncated,
    elapsedMs: now() - started,
    unmatchedRate: sampleFeatureCount === 0 ? 0 : unmatchedFeatureCount / sampleFeatureCount,
    samplingScheme: describeScheme(config),
    support,
  };
}

export function describeScheme(config: BootstrapConfig): string {
  if (config.mode === "subsample") {
    const strata = config.strata?.length ? "within each configured stratum" : "across all notes";
    return `Stratified subsampling: ${Math.round(config.retainFraction * 100)}% of notes retained ${strata}, ${config.sampleCount} seeded resamples (seed ${config.seed}).`;
  }
  return `Weight perturbation: filtration values moved by up to ±${config.perturbationScale.toFixed(2)}, ${config.sampleCount} seeded resamples (seed ${config.seed}). This is not subsampling and the two must not be compared.`;
}

interface DiagramPoint {
  birth: number;
  death: number;
}

function toPoint(interval: PersistenceInterval): DiagramPoint {
  return { birth: interval.birth, death: interval.death ?? Infinity };
}

/**
 * Bottleneck matching between two diagrams. Returns, for each point of `full`, the index
 * of the `sample` point it was matched to, or `null` when it went to the diagonal — that
 * is, when this resample offered no counterpart and the feature has no support here.
 *
 * Finite and essential classes are matched separately. An infinite bar and a finite one
 * are not the same feature at any finite cost, and an essential class cannot be discarded
 * onto the diagonal at all; mixing them lets one unmatchable essential class report every
 * finite bar in its dimension as unsupported.
 */
export function bottleneckMatch(full: DiagramPoint[], sample: DiagramPoint[]): (number | null)[] {
  const result: (number | null)[] = full.map(() => null);
  if (full.length === 0 || sample.length === 0) return result;

  const finiteFull = indicesWhere(full, (point) => Number.isFinite(point.death));
  const finiteSample = indicesWhere(sample, (point) => Number.isFinite(point.death));
  matchFinite(
    finiteFull.map((index) => full[index]),
    finiteSample.map((index) => sample[index]),
  ).forEach((sampleSlot, fullSlot) => {
    if (sampleSlot !== null) result[finiteFull[fullSlot]] = finiteSample[sampleSlot];
  });

  const essentialFull = indicesWhere(full, (point) => !Number.isFinite(point.death));
  const essentialSample = indicesWhere(sample, (point) => !Number.isFinite(point.death));
  matchEssential(
    essentialFull.map((index) => full[index]),
    essentialSample.map((index) => sample[index]),
  ).forEach((sampleSlot, fullSlot) => {
    if (sampleSlot !== null) result[essentialFull[fullSlot]] = essentialSample[sampleSlot];
  });

  return result;
}

/** Binary search over the O(nm) candidate costs for the smallest feasible δ. */
function matchFinite(full: DiagramPoint[], sample: DiagramPoint[]): (number | null)[] {
  if (full.length === 0) return [];
  if (sample.length === 0) return full.map(() => null);

  const candidates = new Set<number>([0]);
  full.forEach((a) => {
    candidates.add(diagonalCost(a));
    sample.forEach((b) => candidates.add(pointCost(a, b)));
  });
  sample.forEach((b) => candidates.add(diagonalCost(b)));
  const sorted = [...candidates].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

  let lo = 0;
  let hi = sorted.length - 1;
  let best: (number | null)[] | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const matching = feasible(full, sample, sorted[mid]);
    if (matching) {
      best = matching;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best ?? full.map(() => null);
}

/**
 * Essential classes never die, so there is no diagonal to discard them onto. Pair them in
 * birth order, which is the optimal bottleneck matching in one dimension when the counts
 * agree; when they differ the excess simply goes unmatched and is reported as such.
 */
function matchEssential(full: DiagramPoint[], sample: DiagramPoint[]): (number | null)[] {
  const fullOrder = full.map((point, index) => index).sort((a, b) => full[a].birth - full[b].birth);
  const sampleOrder = sample.map((point, index) => index).sort((a, b) => sample[a].birth - sample[b].birth);
  const result: (number | null)[] = full.map(() => null);
  for (let slot = 0; slot < Math.min(fullOrder.length, sampleOrder.length); slot++) {
    result[fullOrder[slot]] = sampleOrder[slot];
  }
  return result;
}

/** L∞ distance between two finite diagram points. */
function pointCost(a: DiagramPoint, b: DiagramPoint): number {
  return Math.max(Math.abs(a.birth - b.birth), Math.abs(a.death - b.death));
}

/** Cost of discarding a point onto the diagonal: half its lifetime. */
function diagonalCost(point: DiagramPoint): number {
  return (point.death - point.birth) / 2;
}

/**
 * Is there a matching in which every point is either paired within δ or discarded to the
 * diagonal within δ?
 *
 * The standard construction, and the reason a plain maximum matching will not do: give
 * every point its own diagonal partner on the opposite side, so "discard to the diagonal"
 * is an edge rather than an afterthought. Checking a maximum matching and then asking
 * whether the leftovers can afford the diagonal is wrong — it can leave a point that
 * cannot afford it unmatched while a different maximum matching would have paired it.
 * Diagonal-to-diagonal edges cost nothing and absorb the slack, so feasibility is exactly
 * a perfect matching on n+m nodes per side.
 */
function feasible(full: DiagramPoint[], sample: DiagramPoint[], delta: number): (number | null)[] | null {
  const n = full.length;
  const m = sample.length;
  // Left: [0,n) full points, [n,n+m) diagonal partners of sample points.
  // Right: [0,m) sample points, [m,m+n) diagonal partners of full points.
  const allowed: number[][] = [];
  for (let i = 0; i < n; i++) {
    const edges: number[] = [];
    for (let j = 0; j < m; j++) if (pointCost(full[i], sample[j]) <= delta) edges.push(j);
    if (diagonalCost(full[i]) <= delta) edges.push(m + i);
    allowed.push(edges);
  }
  for (let j = 0; j < m; j++) {
    const edges: number[] = [];
    if (diagonalCost(sample[j]) <= delta) edges.push(j);
    for (let i = 0; i < n; i++) edges.push(m + i);
    allowed.push(edges);
  }

  const leftToRight: (number | null)[] = Array.from({ length: n + m }, () => null);
  const rightToLeft: (number | null)[] = Array.from({ length: n + m }, () => null);
  for (let left = 0; left < n + m; left++) {
    if (!augment(left, allowed, leftToRight, rightToLeft, new Set<number>())) return null;
  }

  return Array.from({ length: n }, (_, i) => {
    const right = leftToRight[i];
    return right !== null && right < m ? right : null;
  });
}

function augment(
  left: number,
  allowed: number[][],
  leftToRight: (number | null)[],
  rightToLeft: (number | null)[],
  seen: Set<number>,
): boolean {
  for (const right of allowed[left]) {
    if (seen.has(right)) continue;
    seen.add(right);
    const owner = rightToLeft[right];
    if (owner === null || augment(owner, allowed, leftToRight, rightToLeft, seen)) {
      rightToLeft[right] = left;
      leftToRight[left] = right;
      return true;
    }
  }
  return false;
}

function indicesWhere(points: DiagramPoint[], predicate: (point: DiagramPoint) => boolean): number[] {
  const indices: number[] = [];
  points.forEach((point, index) => {
    if (predicate(point)) indices.push(index);
  });
  return indices;
}

/** Retain a seeded fraction of each stratum, then induce the subcomplex on those vertices. */
function subsampleInput(input: TopologyInput, config: BootstrapConfig, random: () => number): TopologyInput | null {
  const strata = new Map<string, number[]>();
  input.vertexKeys.forEach((_, index) => {
    const label = config.strata?.[index] ?? "all";
    const bucket = strata.get(label) ?? [];
    bucket.push(index);
    strata.set(label, bucket);
  });

  const retained = new Set<number>();
  for (const bucket of strata.values()) {
    const shuffled = seededShuffle(bucket, random);
    const keep = Math.max(1, Math.round(bucket.length * config.retainFraction));
    shuffled.slice(0, keep).forEach((index) => retained.add(index));
  }
  if (retained.size === 0) return null;
  return induce(input, retained);
}

function induce(input: TopologyInput, retained: Set<number>): TopologyInput {
  const remap = new Map<number, number>();
  const vertexKeys: string[] = [];
  input.vertexKeys.forEach((key, index) => {
    if (!retained.has(index)) return;
    remap.set(index, vertexKeys.length);
    vertexKeys.push(key);
  });

  const offsets = [0];
  const vertices: number[] = [];
  const dimensions: number[] = [];
  const values: number[] = [];
  const stableKeys: string[] = [];

  for (let i = 0; i < input.simplexDimensions.length; i++) {
    const slice = [...input.simplexVertices.slice(input.simplexOffsets[i], input.simplexOffsets[i + 1])];
    if (!slice.every((index) => retained.has(index))) continue;
    slice.forEach((index) => vertices.push(remap.get(index) as number));
    offsets.push(vertices.length);
    dimensions.push(input.simplexDimensions[i]);
    values.push(input.filtrationValues[i]);
    stableKeys.push(input.stableKeys[i]);
  }

  return {
    ...input,
    vertexKeys,
    simplexOffsets: Uint32Array.from(offsets),
    simplexVertices: Uint32Array.from(vertices),
    simplexDimensions: Uint16Array.from(dimensions),
    filtrationValues: Float64Array.from(values),
    stableKeys,
    computeRepresentatives: false,
  };
}

/** Move every filtration value within ±scale. The complex is unchanged; only the timing moves. */
function perturbInput(input: TopologyInput, config: BootstrapConfig, random: () => number): TopologyInput {
  const values = Float64Array.from(input.filtrationValues, (value) => {
    const shifted = value + (random() * 2 - 1) * config.perturbationScale;
    return Math.min(1, Math.max(0, shifted));
  });
  return { ...input, filtrationValues: values, computeRepresentatives: false };
}

function seededShuffle(values: number[], random: () => number): number[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function quantilesOf(values: number[]): Quantiles | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return { p05: at(0.05), p50: at(0.5), p95: at(0.95) };
}

/** Deterministic 32-bit PRNG. Seeded runs must reproduce exactly, so Math.random is unusable. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
