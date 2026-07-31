import type { SimplicialModel } from "./model.js";
import type { NodeID, RelationKey } from "./types.js";

/**
 * Attention, not content.
 *
 * Activation records that a note is currently in play — opened, edited, focused,
 * matched by a query — and how that attention spreads to the notes it is in
 * relation with. It is ephemeral by construction: nothing here is ever written back
 * to a note, and the test suite asserts it.
 *
 * The three kernels exist to be *compared*. Pairwise propagation says attention
 * flows along links; simplicial propagation says it flows through coherent groups
 * and their faces; hypergraph propagation says it flows through irreducible
 * encounters. These predict different things, and which one matches how a vault
 * actually behaves is a question the plugin can now ask rather than assume.
 */

const MS_PER_MINUTE = 60 * 1000;

export type ActivationField = Map<NodeID, number>;

export type ActivationSource = "opened" | "edited" | "focused" | "query" | "recency";

export const DEFAULT_SOURCE_WEIGHTS: Record<ActivationSource, number> = {
  opened: 1,
  edited: 1,
  focused: 0.7,
  query: 0.5,
  recency: 0.25,
};

export interface ActivationConfig {
  halfLifeMinutes: number;
  sourceWeights: Record<ActivationSource, number>;
}

export const DEFAULT_ACTIVATION_CONFIG: ActivationConfig = {
  halfLifeMinutes: 30,
  sourceWeights: DEFAULT_SOURCE_WEIGHTS,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Per-node attention with a half-life. Lives in memory, and at most in plugin data —
 * never in a note. A vault that recorded who was paying attention to what would be
 * a different and much worse artifact than a vault of notes.
 */
export class ActivationState {
  private readonly stamps = new Map<NodeID, { value: number; at: number }>();

  constructor(private config: ActivationConfig = DEFAULT_ACTIVATION_CONFIG) {}

  configure(config: Partial<ActivationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Attention does not accumulate past full: a note cannot be more open than open. */
  register(nodeId: NodeID, source: ActivationSource, now = Date.now()): void {
    const weight = this.config.sourceWeights[source] ?? 0;
    if (weight <= 0) return;
    const current = this.valueAt(nodeId, now);
    this.stamps.set(nodeId, { value: clamp01(Math.max(current, weight)), at: now });
  }

  clear(): void {
    this.stamps.clear();
  }

  valueAt(nodeId: NodeID, now = Date.now()): number {
    const stamp = this.stamps.get(nodeId);
    if (!stamp) return 0;
    const ageMinutes = Math.max(0, (now - stamp.at) / MS_PER_MINUTE);
    if (this.config.halfLifeMinutes <= 0) return 0;
    return stamp.value * Math.pow(0.5, ageMinutes / this.config.halfLifeMinutes);
  }

  /** The decayed field. Nodes that have never been touched are simply absent. */
  field(now = Date.now()): ActivationField {
    const field: ActivationField = new Map();
    this.stamps.forEach((_, nodeId) => {
      const value = this.valueAt(nodeId, now);
      if (value > 0.001) field.set(nodeId, value);
    });
    return field;
  }

  get size(): number {
    return this.stamps.size;
  }
}

// ---------------------------------------------------------------------------
// Propagation kernels
// ---------------------------------------------------------------------------

export type KernelName = "pairwise" | "simplicial" | "hypergraph";

export const KERNEL_NAMES: KernelName[] = ["pairwise", "simplicial", "hypergraph"];

export interface PropagationKernel {
  name: KernelName;
  /** The groups attention flows through. Order is irrelevant; membership is not. */
  groups: NodeID[][];
  /** One diffusion step. Pure — the input field is never mutated. */
  step(_field: ActivationField, _rate: number): ActivationField;
}

/**
 * The groups each kernel reads.
 *
 * Pairwise takes only 1-simplices, which is the graph view of the vault.
 * Simplicial takes every simplex including the auto-generated faces — that is what
 * downward closure *means* for propagation, and excluding faces would quietly turn
 * it into a third kernel. Hypergraph takes encounters, which are not decomposed.
 */
export function kernelGroups(model: SimplicialModel, name: KernelName): NodeID[][] {
  if (name === "hypergraph") {
    return [...model.hyperedges.values()].map((hyperedge) => hyperedge.nodes);
  }
  const simplices = [...model.simplices.values()];
  if (name === "pairwise") {
    return simplices.filter((simplex) => simplex.nodes.length === 2).map((simplex) => simplex.nodes);
  }
  return simplices.filter((simplex) => simplex.nodes.length >= 2).map((simplex) => simplex.nodes);
}

export function createKernel(model: SimplicialModel, name: KernelName): PropagationKernel {
  const groups = kernelGroups(model, name);
  const membership = new Map<NodeID, number[]>();
  groups.forEach((group, index) => {
    group.forEach((nodeId) => {
      const list = membership.get(nodeId) ?? [];
      list.push(index);
      membership.set(nodeId, list);
    });
  });

  return {
    name,
    groups,
    step(field, rate) {
      const groupMeans = groups.map((group) => {
        if (group.length === 0) return 0;
        return group.reduce((sum, nodeId) => sum + (field.get(nodeId) ?? 0), 0) / group.length;
      });

      const next: ActivationField = new Map(field);
      membership.forEach((groupIndices, nodeId) => {
        const current = field.get(nodeId) ?? 0;
        const target = groupIndices.reduce((sum, index) => sum + groupMeans[index], 0) / groupIndices.length;
        next.set(nodeId, clamp01(current + rate * (target - current)));
      });
      // A node in no group of this kernel keeps whatever it had. Unrelated notes
      // stay quiet rather than being dragged toward a vault-wide average.
      return next;
    },
  };
}

/**
 * Spread attention outward from a seed field. Used for render emphasis, where a
 * handful of steps is enough — this is not the simulation in `synchronizationTime`.
 */
export function propagate(
  kernel: PropagationKernel,
  field: ActivationField,
  steps: number,
  rate = 0.4,
): ActivationField {
  let current = field;
  for (let step = 0; step < steps; step++) {
    current = kernel.step(current, rate);
  }
  return current;
}

// ---------------------------------------------------------------------------
// HG-20 — synchronization time
// ---------------------------------------------------------------------------

/** Deterministic seeded PRNG, so a reported synchronization time is reproducible. */
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

export function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

/**
 * Coherence in `[0,1]`: 1 when every member holds the same activation, 0 when they
 * are maximally split. Bounded because activation is, which makes traces from
 * different kernels directly comparable.
 */
export function orderParameter(values: number[]): number {
  return clamp01(1 - 2 * Math.sqrt(variance(values)));
}

export interface SynchronizationOptions {
  seed?: number;
  rate?: number;
  /** Member variance below this counts as synchronized. */
  threshold?: number;
  maxIterations?: number;
}

export interface SynchronizationResult {
  kernel: KernelName;
  relationKey: RelationKey;
  members: NodeID[];
  /** Iterations to converge, or `null` if the budget ran out first. */
  iterations: number | null;
  converged: boolean;
  /** Per-iteration coherence of the encounter's members, index 0 = the seed state. */
  orderTrace: number[];
  finalVariance: number;
}

export const DEFAULT_SYNC_OPTIONS: Required<SynchronizationOptions> = {
  seed: 20260401,
  rate: 0.35,
  threshold: 1e-4,
  maxIterations: 400,
};

/**
 * HG-20. How long it takes an encounter's members to come into agreement under a
 * given kernel, from a seeded split state.
 *
 * This is a simulation, not a render-loop computation: the caller decides when to
 * pay for it, and `maxIterations` bounds what it can cost. A kernel that never
 * converges reports that honestly rather than returning its iteration cap as if it
 * were an answer.
 */
export function synchronizationTime(
  model: SimplicialModel,
  hyperedgeKey: RelationKey,
  kernelName: KernelName,
  options: SynchronizationOptions = {},
): SynchronizationResult | null {
  const hyperedge = model.getHyperedge(hyperedgeKey);
  if (!hyperedge) return null;
  const settings = { ...DEFAULT_SYNC_OPTIONS, ...options };
  const kernel = createKernel(model, kernelName);
  const random = mulberry32(settings.seed);

  // Every node in the vault is seeded, not just the members: the question is how
  // fast the members agree given everything else pulling on them.
  let field: ActivationField = new Map();
  [...model.nodes.keys()].sort().forEach((nodeId) => field.set(nodeId, random()));

  const memberValues = (source: ActivationField) => hyperedge.nodes.map((nodeId) => source.get(nodeId) ?? 0);
  const orderTrace = [orderParameter(memberValues(field))];
  let iterations: number | null = null;

  for (let step = 1; step <= settings.maxIterations; step++) {
    field = kernel.step(field, settings.rate);
    const values = memberValues(field);
    orderTrace.push(orderParameter(values));
    if (variance(values) <= settings.threshold) {
      iterations = step;
      break;
    }
  }

  return {
    kernel: kernelName,
    relationKey: hyperedgeKey,
    members: hyperedge.nodes,
    iterations,
    converged: iterations !== null,
    orderTrace,
    finalVariance: variance(memberValues(field)),
  };
}

export interface CompetingRhythm {
  a: RelationKey;
  b: RelationKey;
  sharedNodes: NodeID[];
  /** Absolute difference in synchronization time, in iterations. */
  separation: number;
}

/**
 * Encounters that overlap but settle at very different rates.
 *
 * A note held by two encounters that synchronize on different timescales is being
 * asked to belong to two rhythms at once. That is a felt experience of a vault —
 * one project moves while another sits — and it is invisible to any static measure.
 */
export function competingRhythms(results: SynchronizationResult[], minSeparation = 5): CompetingRhythm[] {
  const competing: CompetingRhythm[] = [];
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i];
      const b = results[j];
      if (a.iterations === null || b.iterations === null) continue;
      const shared = a.members.filter((nodeId) => b.members.includes(nodeId));
      if (shared.length === 0) continue;
      const separation = Math.abs(a.iterations - b.iterations);
      if (separation < minSeparation) continue;
      competing.push({ a: a.relationKey, b: b.relationKey, sharedNodes: shared, separation });
    }
  }
  return competing.sort((x, y) => y.separation - x.separation);
}
