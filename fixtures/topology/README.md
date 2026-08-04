# Static topology benchmark fixture

`scripts/topology-benchmark.mjs` deterministically creates path-like complexes at 500, 2,000, and 10,000 nodes, adding a triangle every five nodes and a tetrahedron every fifty. It reports node, simplex, and boundary-nonzero counts so results are comparable by algebraic input size rather than note count alone.

Budgets are 100 ms, 300 ms, and 1,500 ms respectively for one synchronous static-homology computation. These conservative main-thread gates measure the v0.4.5 implementation; v0.5.0 will move reduction behind the worker boundary.
