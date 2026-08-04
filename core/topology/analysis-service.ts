import { logger } from "../logger.js";
import type { SimplicialModel } from "../model.js";
import type { RenderFilterMetric } from "../types.js";
import { DEFAULT_BOOTSTRAP_CONFIG, type BootstrapConfig } from "./bootstrap.js";
import { createTopologyInput } from "./chain-complex.js";
import { TIE_POLICY_VERSION } from "./filtered-complex.js";
import type { PersistenceResult } from "./persistence-types.js";
import { TopologyWorkerClient, type TopologyExecution } from "./worker-client.js";
import {
  DEFAULT_TOPOLOGY_LIMITS,
  type TopologyFailure,
  type TopologyLimits,
  type TopologyPhase,
} from "./worker-protocol.js";

/** Bump when the cached shape changes; a stale entry must never be served across versions. */
export const ANALYSIS_CACHE_VERSION = 1;
const MAX_CACHED_RESULTS = 4;

export interface TopologyAnalysisConfig {
  metric: RenderFilterMetric;
  maxHomologyDimension: number;
  computeRepresentatives: boolean;
  bootstrap: BootstrapConfig;
  limits: TopologyLimits;
}

export const DEFAULT_ANALYSIS_CONFIG: TopologyAnalysisConfig = {
  metric: "weight",
  maxHomologyDimension: 2,
  computeRepresentatives: true,
  bootstrap: DEFAULT_BOOTSTRAP_CONFIG,
  limits: DEFAULT_TOPOLOGY_LIMITS,
};

export interface TopologyAnalysisState {
  status: "idle" | "running" | "ready" | "failed";
  phase: TopologyPhase | null;
  fraction: number;
  result: PersistenceResult | null;
  failure: TopologyFailure | null;
  execution: TopologyExecution;
  /** True when the displayed result predates the current model revision or config. */
  stale: boolean;
  durationMs: number | null;
}

const IDLE_STATE: TopologyAnalysisState = {
  status: "idle",
  phase: null,
  fraction: 0,
  result: null,
  failure: null,
  execution: "worker",
  stale: false,
  durationMs: null,
};

/**
 * Owns the worker boundary, the cache, and cancellation for persistent topology.
 *
 * Two rules this class exists to enforce. A result may only be applied if its request is
 * still the current one — a threshold change or a model edit invalidates everything in
 * flight. And nothing here writes to the vault: topology is derived, cached in memory,
 * and never serialized into notes.
 */
export class TopologyAnalysisService {
  private client = new TopologyWorkerClient();
  private cache = new Map<string, PersistenceResult>();
  private listeners = new Set<(state: TopologyAnalysisState) => void>();
  private state: TopologyAnalysisState = IDLE_STATE;
  private currentRequestId: string | null = null;
  private requestCounter = 0;
  private startedAt = 0;

  constructor(private readonly model: SimplicialModel) {}

  getState(): TopologyAnalysisState {
    return this.state;
  }

  subscribe(listener: (state: TopologyAnalysisState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /**
   * Cache key. Every input that can change a pairing belongs here — including the tie
   * policy, because two runs that differ only in tie-breaking produce different pairings
   * and must not share an entry.
   */
  cacheKey(config: TopologyAnalysisConfig): string {
    const bootstrap = config.bootstrap.enabled
      ? `${config.bootstrap.mode}:${config.bootstrap.sampleCount}:${config.bootstrap.retainFraction}:${config.bootstrap.perturbationScale}:${config.bootstrap.seed}`
      : "off";
    return [
      `v${ANALYSIS_CACHE_VERSION}`,
      `rev${this.model.revision}`,
      config.metric,
      `dim${config.maxHomologyDimension}`,
      "F2",
      TIE_POLICY_VERSION,
      config.computeRepresentatives ? "witnesses" : "no-witnesses",
      bootstrap,
    ].join("|");
  }

  request(config: TopologyAnalysisConfig = DEFAULT_ANALYSIS_CONFIG): void {
    const key = this.cacheKey(config);
    const cached = this.cache.get(key);
    if (cached) {
      this.currentRequestId = null;
      this.emit({ ...IDLE_STATE, status: "ready", result: cached, execution: this.client.lastExecution });
      return;
    }

    // Supersede anything in flight cooperatively; the reduction yields between batches.
    if (this.currentRequestId) this.client.cancel(this.currentRequestId);

    const requestId = `topology-${++this.requestCounter}`;
    this.currentRequestId = requestId;
    this.startedAt = Date.now();
    this.emit({ ...IDLE_STATE, status: "running", phase: "building", result: this.state.result, stale: true });

    const input = createTopologyInput(this.model, requestId, {
      maxHomologyDimension: config.maxHomologyDimension,
      metric: config.metric,
      computeRepresentatives: config.computeRepresentatives,
    });
    input.bootstrap = config.bootstrap;

    this.client.send(
      { kind: "persistence", requestId, input, limits: config.limits },
      {
        onMessage: (message) => {
          // The single stale-result guard. Anything from a superseded request is dropped
          // here, before it can reach the cache or the view.
          if (message.requestId !== this.currentRequestId) return;

          if (message.kind === "progress") {
            this.emit({ ...this.state, status: "running", phase: message.phase, fraction: message.fraction });
            return;
          }
          if (message.kind === "persistence-result") {
            this.currentRequestId = null;
            this.store(key, message.result);
            this.emit({
              ...IDLE_STATE,
              status: "ready",
              result: message.result,
              execution: this.client.lastExecution,
              durationMs: Date.now() - this.startedAt,
            });
            return;
          }
          if (message.kind === "failure") {
            this.currentRequestId = null;
            if (message.failure.reason !== "cancelled") {
              logger.warn("topology", "Persistence request failed", {
                reason: message.failure.reason,
                phase: message.failure.phase,
                simplexCount: message.failure.simplexCount,
              });
            }
            this.emit({
              ...IDLE_STATE,
              status: "failed",
              failure: message.failure,
              execution: this.client.lastExecution,
              durationMs: Date.now() - this.startedAt,
            });
          }
        },
      },
    );
  }

  /** Cooperative cancellation: the normal path. The worker survives and stays warm. */
  cancel(): void {
    if (!this.currentRequestId) return;
    this.client.cancel(this.currentRequestId);
    this.currentRequestId = null;
    this.emit({ ...IDLE_STATE, status: "idle", result: this.state.result, stale: true });
  }

  /**
   * Hard cancel: terminate and recreate. Recovers a hung or out-of-memory worker at the
   * cost of a startup plus a cold first request, so it is the exception, not the default.
   */
  restartWorker(): void {
    this.client.restart();
    this.currentRequestId = null;
    this.emit({ ...IDLE_STATE, status: "idle", result: this.state.result, stale: true });
  }

  invalidate(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.client.dispose();
    this.listeners.clear();
    this.cache.clear();
    this.currentRequestId = null;
  }

  private store(key: string, result: PersistenceResult): void {
    this.cache.set(key, result);
    while (this.cache.size > MAX_CACHED_RESULTS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private emit(state: TopologyAnalysisState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
