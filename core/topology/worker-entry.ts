/**
 * Worker entry point. Bundled by `build.mjs` as a separate esbuild pass and inlined into
 * `main.js` as a string, because Obsidian's installer fetches only `main.js`,
 * `manifest.json` and `styles.css` — a sibling `workers/*.js` file would not exist in an
 * installed vault. Nothing reachable from here may import `obsidian`.
 *
 * The request handler is factored away from `self` so the main-thread fallback in
 * `worker-client.ts` runs this exact code rather than a second implementation of it.
 */
import { runBootstrap } from "./bootstrap.js";
import { buildFilteredComplex } from "./filtered-complex.js";
import { computePersistenceAsync } from "./persistence.js";
import { PersistenceCancelledError, PersistenceLimitExceededError } from "./persistence-types.js";
import { TsTopologyBackend } from "./ts-backend.js";
import {
  checkLimits,
  type TopologyFailure,
  type TopologyPhase,
  type TopologyWorkerRequest,
  type TopologyWorkerResponse,
} from "./worker-protocol.js";

export type TopologyResponder = (message: TopologyWorkerResponse) => void;

export function createTopologyRequestHandler(post: TopologyResponder): (request: TopologyWorkerRequest) => void {
  const cancelled = new Set<string>();

  return function handle(request: TopologyWorkerRequest): void {
    if (request.kind === "cancel") {
      cancelled.add(request.requestId);
      return;
    }

    const { requestId, input, limits } = request;
    const simplexCount = input.stableKeys.length + input.vertexKeys.length;
    const vertexCount = input.vertexKeys.length;
    let phase: TopologyPhase = "building";

    const limitFailure = checkLimits(input, limits);
    if (limitFailure) {
      post({ kind: "failure", requestId, failure: limitFailure });
      return;
    }

    const backend = new TsTopologyBackend();
    const shouldCancel = () => cancelled.has(requestId);

    void (async () => {
      try {
        if (request.kind === "static") {
          const result = await backend.computeStatic(input);
          if (shouldCancel()) throw new PersistenceCancelledError(0);
          post({ kind: "static-result", requestId, result });
          return;
        }

        post({ kind: "progress", requestId, phase, fraction: 0 });
        const complex = buildFilteredComplex(input);

        phase = "reducing";
        const result = await computePersistenceAsync(
          complex,
          {
            metric: input.metric,
            modelRevision: input.modelRevision,
            computeRepresentatives: input.computeRepresentatives,
          },
          {
            shouldCancel,
            maxColumnEntries: limits.maxColumnEntries,
            onProgress: (fraction) => post({ kind: "progress", requestId, phase: "reducing", fraction }),
          },
        );

        if (input.computeRepresentatives) {
          phase = "witnesses";
          post({ kind: "progress", requestId, phase, fraction: 1 });
        }

        if (input.bootstrap?.enabled) {
          phase = "uncertainty";
          post({ kind: "progress", requestId, phase, fraction: 0 });
          result.uncertainty = runBootstrap(input, complex, result, input.bootstrap, {
            shouldCancel,
            onProgress: (fraction) => post({ kind: "progress", requestId, phase: "uncertainty", fraction }),
          });
        }

        if (shouldCancel()) throw new PersistenceCancelledError(complex.simplices.length);
        post({ kind: "persistence-result", requestId, result });
      } catch (error) {
        post({ kind: "failure", requestId, failure: failureOf(error, phase, simplexCount, vertexCount) });
      } finally {
        cancelled.delete(requestId);
      }
    })();
  };
}

/** Engine exceptions become typed failures. A raw worker exception must never reach the UI. */
export function failureOf(
  error: unknown,
  phase: TopologyPhase,
  simplexCount: number,
  vertexCount: number,
): TopologyFailure {
  if (error instanceof PersistenceCancelledError) {
    return { reason: "cancelled", message: error.message, phase, simplexCount, vertexCount };
  }
  if (error instanceof PersistenceLimitExceededError) {
    return { reason: "limit-exceeded", message: error.message, phase, simplexCount, vertexCount };
  }
  return {
    reason: "engine-error",
    message: error instanceof Error ? error.message : String(error),
    phase,
    simplexCount,
    vertexCount,
  };
}

declare const self:
  | {
      onmessage: ((event: { data: TopologyWorkerRequest }) => void) | null;
      postMessage: (message: TopologyWorkerResponse) => void;
    }
  | undefined;

// Only binds when this module is the worker's entry; importing it from the main thread
// (as the fallback does) must not install a message handler.
if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof document === "undefined") {
  const handle = createTopologyRequestHandler((message) => self.postMessage(message));
  self.onmessage = (event) => handle(event.data);
}
