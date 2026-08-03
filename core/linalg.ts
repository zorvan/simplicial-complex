/**
 * Exact linear algebra over ℚ.
 *
 * The rest of the codebase deliberately avoids matrix work — `computeBetti` uses
 * direct enumeration rather than boundary-matrix rank — so there was nothing to
 * reuse here. The sheaf layer genuinely needs rank and kernel: "these readings are
 * pairwise compatible and admit no global reconciliation" is a rank statement and
 * cannot be approximated by counting disagreements.
 *
 * Rational rather than floating point because the answers are structural. A rank
 * that is off by one because a pivot landed near a tolerance is not a smaller error
 * than a wrong Betti number — it is an obstruction that exists or does not.
 */

export interface Fraction {
  /** Always carries the sign; `denominator` is always positive. */
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function frac(n: number, d = 1): Fraction {
  if (d === 0) throw new Error("linalg: zero denominator");
  const sign = d < 0 ? -1 : 1;
  const divisor = gcd(n, d);
  return { n: (sign * n) / divisor, d: (sign * d) / divisor };
}

export const ZERO: Fraction = { n: 0, d: 1 };
export const ONE: Fraction = { n: 1, d: 1 };

export function isZero(value: Fraction): boolean {
  return value.n === 0;
}

export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function subtract(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function multiply(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.n, a.d * b.d);
}

export function divide(a: Fraction, b: Fraction): Fraction {
  if (isZero(b)) throw new Error("linalg: division by zero");
  return frac(a.n * b.d, a.d * b.n);
}

export function toNumber(value: Fraction): number {
  return value.n / value.d;
}

export type Matrix = Fraction[][];

export function zeros(rows: number, columns: number): Matrix {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ZERO));
}

export function fromNumbers(rows: number[][]): Matrix {
  return rows.map((row) => row.map((value) => frac(value)));
}

export function transpose(matrix: Matrix): Matrix {
  const rows = matrix.length;
  const columns = rows > 0 ? matrix[0].length : 0;
  return Array.from({ length: columns }, (_, column) => Array.from({ length: rows }, (_, row) => matrix[row][column]));
}

export function matMul(a: Matrix, b: Matrix): Matrix {
  const rows = a.length;
  const inner = b.length;
  const columns = inner > 0 ? b[0].length : 0;
  const result = zeros(rows, columns);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let sum = ZERO;
      for (let k = 0; k < inner; k++) {
        if (isZero(a[row][k]) || isZero(b[k][column])) continue;
        sum = add(sum, multiply(a[row][k], b[k][column]));
      }
      result[row][column] = sum;
    }
  }
  return result;
}

/**
 * Row-reduce in place and report which columns carry pivots.
 *
 * Returned separately from `rank` because the pivot columns are what turn a
 * dimension into a set of representatives — the difference between "there is one
 * obstruction" and "here is the cycle it lives on".
 */
export function rowReduce(matrix: Matrix): { reduced: Matrix; pivotColumns: number[] } {
  const reduced = matrix.map((row) => [...row]);
  const rows = reduced.length;
  const columns = rows > 0 ? reduced[0].length : 0;
  const pivotColumns: number[] = [];
  let pivotRow = 0;

  for (let column = 0; column < columns && pivotRow < rows; column++) {
    let candidate = -1;
    for (let row = pivotRow; row < rows; row++) {
      if (!isZero(reduced[row][column])) {
        candidate = row;
        break;
      }
    }
    if (candidate === -1) continue;

    [reduced[pivotRow], reduced[candidate]] = [reduced[candidate], reduced[pivotRow]];
    const pivot = reduced[pivotRow][column];
    for (let c = column; c < columns; c++) {
      reduced[pivotRow][c] = divide(reduced[pivotRow][c], pivot);
    }
    for (let row = 0; row < rows; row++) {
      if (row === pivotRow || isZero(reduced[row][column])) continue;
      const factor = reduced[row][column];
      for (let c = column; c < columns; c++) {
        reduced[row][c] = subtract(reduced[row][c], multiply(factor, reduced[pivotRow][c]));
      }
    }
    pivotColumns.push(column);
    pivotRow++;
  }

  return { reduced, pivotColumns };
}

export function rank(matrix: Matrix): number {
  if (matrix.length === 0) return 0;
  return rowReduce(matrix).pivotColumns.length;
}

/** A basis for `{ x : Ax = 0 }`, one vector per free column. */
export function nullspace(matrix: Matrix): Matrix {
  if (matrix.length === 0) return [];
  const columns = matrix[0].length;
  const { reduced, pivotColumns } = rowReduce(matrix);
  const pivotSet = new Set(pivotColumns);
  const basis: Matrix = [];

  for (let free = 0; free < columns; free++) {
    if (pivotSet.has(free)) continue;
    const vector = Array.from({ length: columns }, () => ZERO);
    vector[free] = ONE;
    pivotColumns.forEach((pivotColumn, pivotIndex) => {
      vector[pivotColumn] = subtract(ZERO, reduced[pivotIndex][free]);
    });
    basis.push(vector);
  }
  return basis;
}

/**
 * Solve `Ax = b`, or report that the system is inconsistent.
 *
 * Inconsistency is the interesting answer here, not a failure: it is the statement
 * that a collection of local readings admits no global one.
 */
export function solve(matrix: Matrix, rhs: Fraction[]): { solution: Fraction[] | null; consistent: boolean } {
  if (matrix.length === 0) return { solution: [], consistent: rhs.every(isZero) };
  const columns = matrix[0].length;
  const augmented = matrix.map((row, index) => [...row, rhs[index] ?? ZERO]);
  const { reduced, pivotColumns } = rowReduce(augmented);

  // A pivot in the augmented column is the row `0 = 1`: no solution exists.
  if (pivotColumns.includes(columns)) return { solution: null, consistent: false };

  const solution = Array.from({ length: columns }, () => ZERO);
  pivotColumns.forEach((pivotColumn, pivotIndex) => {
    solution[pivotColumn] = reduced[pivotIndex][columns];
  });
  return { solution, consistent: true };
}

/**
 * The sheaf Laplacian `L = δᵀδ`.
 *
 * `ker L = ker δ = H⁰`, which is the identity that makes the Laplacian worth having:
 * global sections can be read off a symmetric positive-semidefinite operator rather
 * than from the coboundary directly.
 */
export function sheafLaplacian(coboundary: Matrix): Matrix {
  return matMul(transpose(coboundary), coboundary);
}
