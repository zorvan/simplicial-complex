import { SimplicialModel } from "../model.js";
import type { BettiResult } from "../types.js";
import type { TopologyBackend, TopologyCapabilities, TopologyInput } from "./backend.js";
import { computeStaticHomology, topologyInputToModelData } from "./chain-complex.js";
import { buildFilteredComplex } from "./filtered-complex.js";
import { computePersistence } from "./persistence.js";
import type { PersistenceOptions, PersistenceResult } from "./persistence-types.js";

/** The shipped engine: sparse F2 columns in TypeScript. Runs in the worker; also usable inline. */
export class TsTopologyBackend implements TopologyBackend {
  private cancelled = new Set<string>();

  capabilities(): TopologyCapabilities {
    return { coefficientFields: ["F2"], maxHomologyDimension: 2, persistence: true };
  }

  async computeStatic(input: TopologyInput): Promise<BettiResult> {
    if (this.cancelled.delete(input.requestId)) throw new Error(`Topology request cancelled: ${input.requestId}`);
    const decoded = topologyInputToModelData(input);
    const model = new SimplicialModel();
    decoded.nodes.forEach((id) => model.setNode(id));
    decoded.simplices.filter((nodes) => nodes.length > 1).forEach((nodes) => model.addSimplex({ nodes }));
    return { ...computeStaticHomology(model, input.maxHomologyDimension), modelRevision: input.modelRevision };
  }

  async computePersistence(input: TopologyInput, options: PersistenceOptions = {}): Promise<PersistenceResult> {
    if (this.cancelled.delete(input.requestId)) throw new Error(`Topology request cancelled: ${input.requestId}`);
    const complex = buildFilteredComplex(input);
    return computePersistence(
      complex,
      {
        metric: input.metric,
        modelRevision: input.modelRevision,
        computeRepresentatives: input.computeRepresentatives,
      },
      {
        ...options,
        // Cooperative cancellation: the reduction polls this between column batches so a
        // stale request stops without destroying the worker. PH-04.7 keeps termination
        // as the exception because it costs a worker restart plus a cold first request.
        shouldCancel: () => this.cancelled.has(input.requestId) || Boolean(options.shouldCancel?.()),
      },
    );
  }

  cancel(requestId: string): void {
    this.cancelled.add(requestId);
  }

  /** Release a cancellation flag once the caller has observed it. */
  clearCancellation(requestId: string): void {
    this.cancelled.delete(requestId);
  }
}
