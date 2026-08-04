# Persistence truth fixtures

Machine-readable complexes with their expected results, loaded by `tests/topology-fixtures.test.ts`.

Each file declares:

- `nodes` — the vertex set;
- `simplices` — maximal simplices with the weight that produces their filtration value (`value = 1 - weight`); faces are auto-generated and enter at 0;
- `hyperedges` — encounters, which must leave every simplicial invariant unchanged;
- `betti` — expected static Betti numbers `[b0, b1, b2]`;
- `intervals` — expected persistence intervals as `[dimension, birth, death]`, with `null` for an essential class;
- `notes` — why the fixture exists.

Representatives are validated structurally (∂z = 0, and the birth simplex is present in the
chain) rather than compared literally: several bases are valid, and pinning one would make the
suite fail on a correct change to the reduction order.
