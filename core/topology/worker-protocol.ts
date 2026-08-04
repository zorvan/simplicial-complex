import type { BettiResult } from "../types.js";
import type { TopologyInput } from "./backend.js";
import type { PersistenceResult } from "./persistence-types.js";

export type TopologyPhase = "building" | "reducing" | "witnesses" | "uncertainty";

/**
 * Computation ceilings.
 *
 * Mobile stays supported (plan §4.4), so these are the mobile numbers, not the desktop
 * ones: an iOS webview will be killed outright well before a desktop Electron renderer
 * notices. `maxColumnEntries` counts live sparse Uint32 entries across the reduced and
 * change-of-basis columns — roughly 4 bytes each, so 4M entries is ~16 MB of column
 * storage before object overhead, and witness tracking is what pushes it there.
 */
export interface TopologyLimits {
  maxSimplices: number;
  maxColumnEntries: number;
}

export const DEFAULT_TOPOLOGY_LIMITS: TopologyLimits = {
  maxSimplices: 50_000,
  maxColumnEntries: 4_000_000,
};

export interface TopologyFailure {
  reason: "cancelled" | "limit-exceeded" | "engine-error";
  message: string;
  phase: TopologyPhase;
  /** Input-size provenance, so a failure report says what was attempted. */
  simplexCount: number;
  vertexCount: number;
}

export interface TopologyComputeRequest {
  kind: "static" | "persistence";
  requestId: string;
  input: TopologyInput;
  limits: TopologyLimits;
}

export interface TopologyCancelRequest {
  kind: "cancel";
  requestId: string;
}

export type TopologyWorkerRequest = TopologyComputeRequest | TopologyCancelRequest;

export interface TopologyProgressMessage {
  kind: "progress";
  requestId: string;
  phase: TopologyPhase;
  fraction: number;
}

export interface TopologyStaticResultMessage {
  kind: "static-result";
  requestId: string;
  result: BettiResult;
}

export interface TopologyPersistenceResultMessage {
  kind: "persistence-result";
  requestId: string;
  result: PersistenceResult;
}

export interface TopologyFailureMessage {
  kind: "failure";
  requestId: string;
  failure: TopologyFailure;
}

export type TopologyWorkerResponse =
  | TopologyProgressMessage
  | TopologyStaticResultMessage
  | TopologyPersistenceResultMessage
  | TopologyFailureMessage;

export function checkLimits(input: TopologyInput, limits: TopologyLimits): TopologyFailure | null {
  const simplexCount = input.stableKeys.length + input.vertexKeys.length;
  if (simplexCount <= limits.maxSimplices) return null;
  return {
    reason: "limit-exceeded",
    message: `This vault produces ${simplexCount.toLocaleString()} simplices, above the ${limits.maxSimplices.toLocaleString()} ceiling. Raise the limit in settings, or narrow the filtration metric, to analyze it.`,
    phase: "building",
    simplexCount,
    vertexCount: input.vertexKeys.length,
  };
}
