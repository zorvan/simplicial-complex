import { logger } from "../logger.js";
import { createTopologyRequestHandler } from "./worker-entry.js";
import type { TopologyComputeRequest, TopologyWorkerRequest, TopologyWorkerResponse } from "./worker-protocol.js";

/**
 * Replaced at build time by `build.mjs` with the bundled worker source. It stays a
 * `declare` so `typeof` remains safe in Node tests, where nothing defines it and the
 * client falls back to the main thread.
 */
declare const __TOPOLOGY_WORKER_SOURCE__: string;

export type TopologyExecution = "worker" | "main-thread";

export interface TopologyRunHandlers {
  onMessage: (message: TopologyWorkerResponse) => void;
}

/**
 * Owns one long-lived worker and its Blob URL.
 *
 * Obsidian installs only `main.js`, so the worker cannot be a separate file; it is
 * bundled into a string and started from a `Blob`. When no `Worker` exists, or the blob
 * cannot be constructed (a stricter CSP, an unusual mobile webview), the client runs the
 * same engine on the main thread and says so through `execution` rather than failing or
 * pretending the work happened off-thread.
 */
export class TopologyWorkerClient {
  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private inlineHandler: ((request: TopologyWorkerRequest) => void) | null = null;
  private handlers = new Map<string, TopologyRunHandlers>();
  private execution: TopologyExecution = "worker";
  private restartCount = 0;

  /** Where the last dispatched request actually ran. Surfaced in the view's provenance line. */
  get lastExecution(): TopologyExecution {
    return this.execution;
  }

  get restarts(): number {
    return this.restartCount;
  }

  send(request: TopologyComputeRequest, handlers: TopologyRunHandlers): void {
    this.handlers.set(request.requestId, handlers);
    const worker = this.ensureWorker();
    if (worker) {
      this.execution = "worker";
      // The service builds a fresh snapshot per request, so handing the buffers over is
      // safe. A retry after a restart rebuilds the input rather than reusing these.
      worker.postMessage(request, [
        request.input.simplexOffsets.buffer,
        request.input.simplexVertices.buffer,
        request.input.simplexDimensions.buffer,
        request.input.filtrationValues.buffer,
      ]);
      return;
    }
    this.execution = "main-thread";
    // Deferred, not called straight through. A worker's reply is always asynchronous, and
    // running the reduction inside `send` would make the fallback observably different:
    // the view could never paint its "computing" state, and there would be no window in
    // which a cancel could arrive before the work began.
    const handle = this.ensureInlineHandler();
    // A bare `setTimeout`, deliberately. This is the fallback taken precisely when the
    // environment is unusual, and the Node tests drive it with no `window` defined, so
    // the rule's `window.setTimeout` fix would throw here.
    // eslint-disable-next-line obsidianmd/prefer-window-timers
    setTimeout(() => handle(request), 0);
  }

  cancel(requestId: string): void {
    const message: TopologyWorkerRequest = { kind: "cancel", requestId };
    if (this.worker) this.worker.postMessage(message);
    else this.inlineHandler?.(message);
  }

  /**
   * Hard cancel. Costs a worker startup plus a cold first request on the next call, which
   * is why cooperative cancellation is the normal path and this is the exception.
   */
  restart(): void {
    this.disposeWorker();
    this.handlers.clear();
    this.restartCount++;
  }

  dispose(): void {
    this.disposeWorker();
    this.handlers.clear();
    this.inlineHandler = null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return null;
    if (typeof __TOPOLOGY_WORKER_SOURCE__ !== "string" || __TOPOLOGY_WORKER_SOURCE__.length === 0) return null;

    try {
      const blob = new Blob([__TOPOLOGY_WORKER_SOURCE__], { type: "text/javascript" });
      this.blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(this.blobUrl);
      worker.onmessage = (event: MessageEvent<TopologyWorkerResponse>) => this.receive(event.data);
      worker.onerror = (event) => this.failAll(event instanceof ErrorEvent ? event.message : "Topology worker error");
      this.worker = worker;
      return worker;
    } catch (error) {
      logger.warn("topology", "Falling back to main-thread topology: worker start failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.disposeWorker();
      return null;
    }
  }

  private ensureInlineHandler(): (request: TopologyWorkerRequest) => void {
    this.inlineHandler ??= createTopologyRequestHandler((message) => this.receive(message));
    return this.inlineHandler;
  }

  private receive(message: TopologyWorkerResponse): void {
    const handlers = this.handlers.get(message.requestId);
    if (!handlers) return;
    if (message.kind !== "progress") this.handlers.delete(message.requestId);
    handlers.onMessage(message);
  }

  private failAll(message: string): void {
    for (const [requestId, handlers] of [...this.handlers]) {
      this.handlers.delete(requestId);
      handlers.onMessage({
        kind: "failure",
        requestId,
        failure: {
          reason: "engine-error",
          message,
          phase: "reducing",
          simplexCount: 0,
          vertexCount: 0,
        },
      });
    }
    // The worker is not trustworthy after an unhandled error; the next request starts a
    // fresh one rather than reusing it.
    this.disposeWorker();
    this.restartCount++;
  }

  private disposeWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
  }
}
