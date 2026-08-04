import type { SimplicialModel } from "./model.js";
import { normalizeKey } from "./normalize.js";
import type { PersistenceInterval } from "./topology/persistence-types.js";
import type { NodeID, RenderFilterMetric, Simplex, SimplexKey } from "./types.js";

export interface FiltrationValue {
  simplexKey: SimplexKey;
  dimension: number;
  score: number;
  /** Increasing sublevel value. The UI's decreasing score sweep uses 1-score. */
  value: number;
  metric: RenderFilterMetric;
  direction: "increasing";
}

export interface SimplexAppearanceEvent {
  threshold: number;
  type: "simplex-appearance";
  nodes: NodeID[];
  simplexKey: SimplexKey;
  description: string;
}

/**
 * A topological birth or death, read off the persistence pairing. These live in their own
 * lane: a simplex appearing and a homology class dying are different kinds of event, and
 * v0.4.0 conflated them.
 */
export interface PersistenceEvent {
  threshold: number;
  type: "class-birth" | "class-death";
  nodes: NodeID[];
  simplexKey: SimplexKey;
  description: string;
  intervalId: string;
  dimension: number;
  /** On a death, the class this simplex killed. */
  pairedSimplexKey?: SimplexKey;
}

export type FiltrationEvent = SimplexAppearanceEvent | PersistenceEvent;

export function isPersistenceEvent(event: FiltrationEvent): event is PersistenceEvent {
  return event.type === "class-birth" || event.type === "class-death";
}

/**
 * Mathematical object: a real-valued increasing filtration f on a finite simplicial complex.
 * Result used: sublevel sets are complexes iff f(face)≤f(coface).
 * Preconditions: all scores are finite and lie in [0,1].
 * Consequence: every prefix in the declared tie order is downward closed.
 * Witness: validated values with metric and direction provenance.
 * Non-claim: simplex appearances are not persistence births or deaths.
 * Reference: Edelsbrunner and Harer, Computational Topology, Ch. VII.
 */
export function buildFiltration(model: SimplicialModel, metric: RenderFilterMetric): FiltrationValue[] {
  const values = [...model.simplices.entries()].map(([simplexKey, simplex]) => {
    const score = getSimplexScore(simplex, metric);
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error(`Invalid ${metric} score for ${simplexKey}`);
    return {
      simplexKey,
      dimension: simplex.nodes.length - 1,
      score,
      value: 1 - score,
      metric,
      direction: "increasing" as const,
    };
  });
  const byKey = new Map(values.map((entry) => [entry.simplexKey, entry]));
  for (const entry of values) {
    const nodes = entry.simplexKey.split("|");
    if (nodes.length <= 2) continue;
    for (let omitted = 0; omitted < nodes.length; omitted++) {
      const faceKey = normalizeKey(nodes.filter((_, index) => index !== omitted));
      const face = byKey.get(faceKey);
      if (!face) throw new Error(`Filtration input is not downward closed: ${entry.simplexKey} lacks ${faceKey}`);
      if (face.value > entry.value)
        throw new Error(`Filtration face condition violated: ${faceKey} follows ${entry.simplexKey}`);
    }
  }
  return values.sort(
    (a, b) => a.value - b.value || a.dimension - b.dimension || a.simplexKey.localeCompare(b.simplexKey),
  );
}

/**
 * Birth and death markers derived from the persistence pairing.
 *
 * The filtration slider and the barcode cannot disagree about topology because this is
 * the same pairing the barcode draws: both read `PersistenceInterval`, and neither
 * inspects the complex at sampled thresholds to guess what changed.
 *
 * Thresholds are reported on the UI's decreasing score scale (`1 - value`), matching the
 * simplex-appearance lane the slider already uses.
 */
export function computePersistenceEvents(intervals: PersistenceInterval[]): PersistenceEvent[] {
  const events: PersistenceEvent[] = [];
  for (const interval of intervals) {
    events.push({
      threshold: 1 - interval.birth,
      type: "class-birth",
      nodes: interval.birthSimplex.split("|"),
      simplexKey: interval.birthSimplex,
      description: `H${interval.dimension} class born: ${interval.birthSimplex.split("|").join(" · ")}`,
      intervalId: interval.id,
      dimension: interval.dimension,
    });
    if (interval.death === null || interval.deathSimplex === undefined) continue;
    events.push({
      threshold: 1 - interval.death,
      type: "class-death",
      nodes: interval.deathSimplex.split("|"),
      simplexKey: interval.deathSimplex,
      description: `${interval.deathSimplex.split("|").join(" · ")} closes the H${interval.dimension} class born at ${interval.birthSimplex.split("|").join(" · ")}`,
      intervalId: interval.id,
      dimension: interval.dimension,
      pairedSimplexKey: interval.birthSimplex,
    });
  }
  return events.sort(
    (a, b) => b.threshold - a.threshold || a.dimension - b.dimension || a.simplexKey.localeCompare(b.simplexKey),
  );
}

/**
 * Simplex-appearance markers only — when a relation enters the filtration.
 *
 * These are deliberately *not* topological events. A simplex appearing may create
 * nothing, kill something, or do neither, and v0.4.0's habit of presenting these as
 * births and deaths is what MC-04 corrected. `computePersistenceEvents` is the
 * topological lane.
 */
export function computeFiltrationEvents(model: SimplicialModel, metric: RenderFilterMetric): FiltrationEvent[] {
  return buildFiltration(model, metric)
    .map((entry) => ({
      threshold: entry.score,
      type: "simplex-appearance" as const,
      nodes: model.simplices.get(entry.simplexKey)?.nodes ?? entry.simplexKey.split("|"),
      simplexKey: entry.simplexKey,
      description: `${entry.dimension}-simplex appears: ${entry.simplexKey.split("|").join(" · ")}`,
    }))
    .sort(
      (a, b) =>
        b.threshold - a.threshold || a.nodes.length - b.nodes.length || a.simplexKey.localeCompare(b.simplexKey),
    );
}

/** The single definition of "how strong is this relation", shared by the slider and the filtration. */
export function getSimplexScore(simplex: Simplex, metric: RenderFilterMetric): number {
  const fallback = simplex.autoGenerated ? 1 : 0;
  if (metric === "confidence") return simplex.confidence ?? simplex.weight ?? fallback;
  if (metric === "decayed-weight") return simplex.decayedWeight ?? simplex.weight ?? simplex.confidence ?? fallback;
  return simplex.weight ?? simplex.decayedWeight ?? simplex.confidence ?? fallback;
}

export function getEventThresholds(events: FiltrationEvent[]): number[] {
  const thresholds = new Set(events.map((event) => Math.round(event.threshold * 100) / 100));
  return [...thresholds].sort((a, b) => a - b);
}
