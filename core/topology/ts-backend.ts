import { SimplicialModel } from "../model.js";
import type { BettiResult } from "../types.js";
import type { TopologyBackend, TopologyCapabilities, TopologyInput } from "./backend.js";
import { computeStaticHomology, topologyInputToModelData } from "./chain-complex.js";

export class TsTopologyBackend implements TopologyBackend {
  private cancelled = new Set<string>();
  capabilities(): TopologyCapabilities {
    return { coefficientFields: ["F2"], maxHomologyDimension: 2, persistence: false };
  }
  async computeStatic(input: TopologyInput): Promise<BettiResult> {
    if (this.cancelled.delete(input.requestId)) throw new Error(`Topology request cancelled: ${input.requestId}`);
    const decoded = topologyInputToModelData(input);
    const model = new SimplicialModel();
    decoded.nodes.forEach((id) => model.setNode(id));
    decoded.simplices.filter((nodes) => nodes.length > 1).forEach((nodes) => model.addSimplex({ nodes }));
    return { ...computeStaticHomology(model, input.maxHomologyDimension), modelRevision: input.modelRevision };
  }
  computePersistence(_input: TopologyInput): Promise<never> {
    return Promise.reject(new Error("Persistent homology is not available until v0.5.0"));
  }
  cancel(requestId: string): void {
    this.cancelled.add(requestId);
  }
}
