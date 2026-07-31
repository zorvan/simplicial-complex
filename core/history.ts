import { normalizeKey, relationKey } from "./normalize.js";
import type { NodeID, RelationKey, RelationKind } from "./types.js";

/**
 * The lifecycle of a relation. Every transformation in Phase 3 destroys or
 * overwrites something; without this log the plugin would quietly assert that the
 * current state was always the state.
 */
export type RelationEventType =
  | "encountered"
  | "recurred"
  | "created"
  | "promoted"
  | "relaxed"
  | "crystallized"
  | "dissolved";

export type RelationActor = "user" | "inference" | "parser";

export interface RelationEvent {
  readonly timestamp: number;
  readonly type: RelationEventType;
  readonly kind: RelationKind;
  readonly relationKey: RelationKey;
  /** Node-set key, stable across the two kinds, so a promote/relax pair is queryable as one thread. */
  readonly nodeKey: string;
  readonly nodes: readonly NodeID[];
  readonly actor: RelationActor;
  readonly prior?: Readonly<Record<string, unknown>>;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface RelationEventInput {
  type: RelationEventType;
  kind: RelationKind;
  nodes: NodeID[];
  actor: RelationActor;
  timestamp?: number;
  prior?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}

/**
 * Append-only. Nothing mutates or deletes a recorded event — corrections are new
 * events, not edits. That is what keeps a journey from being retrospectively
 * rewritten, and it is enforced by test.
 */
export class RelationHistory {
  private readonly events: RelationEvent[] = [];
  private listeners = new Set<(_event: RelationEvent) => void>();

  onAppend(listener: (_event: RelationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  append(input: RelationEventInput): RelationEvent {
    const nodes = [...input.nodes];
    const event: RelationEvent = Object.freeze({
      timestamp: input.timestamp ?? Date.now(),
      type: input.type,
      kind: input.kind,
      relationKey: relationKey(input.kind, nodes),
      nodeKey: normalizeKey(nodes),
      nodes: Object.freeze(nodes),
      actor: input.actor,
      ...(input.prior ? { prior: Object.freeze({ ...input.prior }) } : {}),
      ...(input.detail ? { detail: Object.freeze({ ...input.detail }) } : {}),
    });
    this.events.push(event);
    this.listeners.forEach((listener) => listener(event));
    return event;
  }

  /** A defensive copy — callers cannot reorder or truncate the log. */
  all(): RelationEvent[] {
    return [...this.events];
  }

  get size(): number {
    return this.events.length;
  }

  forRelation(key: RelationKey): RelationEvent[] {
    return this.events.filter((event) => event.relationKey === key);
  }

  /** Everything that ever happened to this node set, across both kinds. */
  forNodes(nodes: NodeID[]): RelationEvent[] {
    const nodeKey = normalizeKey(nodes);
    return this.events.filter((event) => event.nodeKey === nodeKey);
  }

  /**
   * HG-13, reduced to a derived getter now that the log exists: recurrence is a
   * query over encounter events, not a separate counter that could drift.
   */
  occurrencesOf(nodes: NodeID[]): number[] {
    return this.forNodes(nodes)
      .filter((event) => event.type === "encountered" || event.type === "recurred")
      .map((event) => event.timestamp)
      .sort((a, b) => a - b);
  }

  /**
   * Repetition is evidence, not proof, of simplicial coherence — this only flips a
   * label and enables the crystallize action. It never promotes anything.
   */
  isRecurring(nodes: NodeID[], threshold: number): boolean {
    return this.occurrencesOf(nodes).length >= Math.max(2, threshold);
  }

  /** Deleting a relation must not delete its history, so this only ever adds. */
  load(events: RelationEvent[]): void {
    events.forEach((event) => this.events.push(Object.freeze({ ...event, nodes: Object.freeze([...event.nodes]) })));
    this.events.sort((a, b) => a.timestamp - b.timestamp);
  }
}

/**
 * Refresh every encounter's `persistence` and `occurrences` from the log.
 *
 * This is all that remains of HG-13: with the event log in place, recurrence is a
 * query rather than a counter that could drift out of step with what happened.
 * Flipping to `recurring` only enables the crystallize action — it never promotes.
 */
export function syncEncounterPersistence(
  model: {
    hyperedges: Map<RelationKey, { nodes: NodeID[]; persistence?: string; occurrences?: number[] }>;
    updateHyperedge(_key: RelationKey, _updates: Record<string, unknown>): unknown;
  },
  history: RelationHistory,
  threshold: number,
): number {
  let changed = 0;
  [...model.hyperedges].forEach(([key, hyperedge]) => {
    const occurrences = history.occurrencesOf(hyperedge.nodes);
    const persistence = history.isRecurring(hyperedge.nodes, threshold) ? "recurring" : "momentary";
    const sameCount = (hyperedge.occurrences?.length ?? 0) === occurrences.length;
    if (sameCount && hyperedge.persistence === persistence) return;
    model.updateHyperedge(key, { occurrences, persistence });
    changed++;
  });
  return changed;
}

const SERIALIZABLE_TYPES = new Set<string>([
  "encountered",
  "recurred",
  "created",
  "promoted",
  "relaxed",
  "crystallized",
  "dissolved",
]);

export function serializeEvent(event: RelationEvent): string {
  return JSON.stringify({
    t: event.timestamp,
    e: event.type,
    k: event.kind,
    n: event.nodes,
    a: event.actor,
    ...(event.prior ? { p: event.prior } : {}),
    ...(event.detail ? { d: event.detail } : {}),
  });
}

export function deserializeEvent(line: string): RelationEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = String(raw.e ?? "");
  const kind = raw.k === "hyperedge" ? "hyperedge" : "simplex";
  const nodes = Array.isArray(raw.n) ? (raw.n as unknown[]).map(String) : [];
  const timestamp = typeof raw.t === "number" ? raw.t : NaN;
  if (!SERIALIZABLE_TYPES.has(type) || nodes.length === 0 || Number.isNaN(timestamp)) return null;

  return Object.freeze({
    timestamp,
    type: type as RelationEventType,
    kind: kind as RelationKind,
    relationKey: relationKey(kind as RelationKind, nodes),
    nodeKey: normalizeKey(nodes),
    nodes: Object.freeze(nodes),
    actor: raw.a === "user" || raw.a === "inference" || raw.a === "parser" ? raw.a : "user",
    ...(raw.p && typeof raw.p === "object" ? { prior: Object.freeze(raw.p as Record<string, unknown>) } : {}),
    ...(raw.d && typeof raw.d === "object" ? { detail: Object.freeze(raw.d as Record<string, unknown>) } : {}),
  });
}
