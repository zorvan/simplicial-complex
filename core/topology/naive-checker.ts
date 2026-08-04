import { SimplicialModel } from "../model.js";
import type { BettiResult } from "../types.js";
import type { TopologyInput } from "./backend.js";
import { buildChainComplex, topologyInputToModelData } from "./chain-complex.js";

/** Test-only dense oracle. Do not import this module from production entry points. */
export class NaiveTopologyChecker {
  async computeStatic(input: TopologyInput): Promise<BettiResult> {
    const decoded = topologyInputToModelData(input);
    const model = new SimplicialModel();
    decoded.nodes.forEach((id) => model.setNode(id));
    decoded.simplices.filter((nodes) => nodes.length > 1).forEach((nodes) => model.addSimplex({ nodes }));
    const complex = buildChainComplex(model, input.maxHomologyDimension + 1);
    const ranks = Array.from({ length: input.maxHomologyDimension + 2 }, () => 0);
    for (const boundary of complex.boundaries) {
      const matrix = Array.from({ length: boundary.rows.simplices.length }, () =>
        Array.from({ length: boundary.columns.simplices.length }, () => 0),
      );
      boundary.data.forEach((column, columnIndex) => column.forEach((row) => (matrix[row][columnIndex] = 1)));
      ranks[boundary.dimension] = denseBinaryRank(matrix);
    }
    const dimensions = Array.from(
      { length: input.maxHomologyDimension + 2 },
      (_, dimension) => complex.bases[dimension]?.simplices.length ?? 0,
    );
    const betti = Array.from(
      { length: input.maxHomologyDimension + 1 },
      (_, dimension) => dimensions[dimension] - ranks[dimension] - ranks[dimension + 1],
    );
    return {
      b0: betti[0] ?? 0,
      b1: betti[1] ?? 0,
      b2: betti[2] ?? 0,
      coefficientField: "F2",
      betti,
      chainDimensions: dimensions.slice(0, input.maxHomologyDimension + 2),
      boundaryRanks: ranks,
      maxDimension: input.maxHomologyDimension,
      modelRevision: input.modelRevision,
    };
  }
}

function denseBinaryRank(source: number[][]): number {
  const matrix = source.map((row) => [...row]);
  const columns = matrix[0]?.length ?? 0;
  let pivotRow = 0;
  for (let column = 0; column < columns && pivotRow < matrix.length; column++) {
    const found = matrix.findIndex((row, index) => index >= pivotRow && row[column] === 1);
    if (found < 0) continue;
    [matrix[pivotRow], matrix[found]] = [matrix[found], matrix[pivotRow]];
    for (let row = 0; row < matrix.length; row++) {
      if (row === pivotRow || matrix[row][column] === 0) continue;
      for (let c = column; c < columns; c++) matrix[row][c] ^= matrix[pivotRow][c];
    }
    pivotRow++;
  }
  return pivotRow;
}
