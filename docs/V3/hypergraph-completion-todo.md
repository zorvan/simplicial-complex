# Hypergraph v3 completion TODO

This tracks the gap between feature code existing and every acceptance criterion in
`hypergraph-implementation-plan.md` being repeatably demonstrated.

## In progress

- [x] Add `inferenceEmits: "simplex" | "hyperedge"`; pairwise inferred links remain simplices.
- [x] Add previewable contextuality seeds from overlapping authored relations.
- [x] Add bounded local-role counterfactuals for each obstruction, ranked by improvement and explicitly accepted.
- [ ] Add optional folder/tag seed discovery ranked by useful overlap, with individual acceptance.

## Benchmarks

- [ ] Add a deterministic 500-node render fixture containing coincident simplices and hyperedges.
- [ ] Record a simplicial-only baseline and require mixed-layer median frame time within 10%.
- [ ] Benchmark cold/warm blob caches and large-encounter glyphs separately.
- [ ] Benchmark synchronization and sheaf analysis at 500 nodes with explicit budgets.
- [ ] Publish machine, browser, and Obsidian versions with results.

## Visual availability and accessibility

- [ ] Add a fixture vault covering coincident relation kinds, closure deficits, crystallization, holes, and obstruction seams.
- [ ] Capture light/dark screenshots at fixed viewport and device-pixel ratio.
- [ ] Add screenshot comparisons for simplex versus hyperedge and hole versus obstruction.
- [ ] Verify hover readings, focus pulse, kill switch, and `prefers-reduced-motion` in Obsidian.
- [ ] Verify large encounters remain selectable and understandable as participant glyphs.

## Contextuality and sheaf assistance

- [x] Suggest a minimal starting cover without persisting automatically.
- [ ] Preview intersections and explain why each proposed context is useful.
- [ ] Rank unreviewed local roles and open the most consequential one first.
- [ ] Add “compare readings” for a note across contexts with global-backfill provenance.
- [ ] Suggest context splits or merges; never apply automatically.
- [x] Add a guided obstruction workflow: test temporary role changes, compare H1/fraction, then explicitly accept.
- [ ] Add an interactive scratch mode for several simultaneous changes with explicit discard.
- [ ] Preserve an audit trail for accepted context and role refinements in plugin data.

## Verification and documentation

- [ ] Add UI integration tests for Contextuality Lab actions and persistence.
- [ ] Test that inferred hyperedges never generate faces or alter Betti values.
- [ ] Add a migration test for settings created before `inferenceEmits`.
- [ ] Complete an Obsidian reload test for every visual view and command.
- [ ] Update the implementation-plan status only after benchmark and visual checks pass.
