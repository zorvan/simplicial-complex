import type { SimplicialModel } from "./model.js";
import { computeStaticHomology } from "./topology/chain-complex.js";
import type { BettiResult } from "./types.js";

/** Compute actual simplicial homology over F2, truncated to the requested skeleton. */
export function computeBetti(model: SimplicialModel, maxDimension: 1 | 2 = 2): BettiResult {
  return computeStaticHomology(model, maxDimension);
}
