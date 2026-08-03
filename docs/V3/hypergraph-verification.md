# Hypergraph v3 verification record

## Repeatable commands

- `npm test` covers model invariants, inferred-hyperedge Betti isolation, pre-`inferenceEmits` migration, sheaf analysis, scratch acceptance/discard, and persistence boundaries.
- `npm run benchmark:hypergraph` constructs 500 deterministic nodes with coincident relation kinds, reports 31-run medians, and fails if mixed preparation exceeds the simplicial baseline by 10%, warm cache loses to cold cache, or analysis budgets are exceeded.
- `npm run verify` runs lint/format, type checking, production build, tests, and release preflight.

Benchmark run on 2026-08-03: Linux x64 (kernel 6.18.39), Node 26.4.0, Obsidian 1.12.7 (API package 1.12.3), Electron 39.8.10 / Chromium 142. Median results in milliseconds: simplicial render preparation 0.293; mixed 0.174 (59.2% of baseline); cold/warm cache 0.214/0.205; 80-participant glyph 0.013; incidence 0.027; synchronization 1.604; sheaf analysis 0.831. Budgets: mixed ≤110% baseline, glyph ≤5 ms, incidence ≤20 ms, synchronization/sheaf ≤250 ms.

## Visual and reload matrix

Fixture: [`fixtures/hypergraph-v3`](../../fixtures/hypergraph-v3/README.md), fixed at 1440×900 and DPR 1. The light/dark SVG references encode the required pixel-level distinctions: filled simplex versus dashed encounter, orange empty hole versus crimson broken obstruction seam. The fixture includes coincident kinds, an unfilled cycle, closure deficit, recurrence/crystallization metadata, and a cyclic obstruction cover.

The reload contract covers the main canvas, metadata panel, Contextuality Lab, and opt-in Dynamics Lab. View factories and commands are registered on each plugin load; settings use current defaults merged under saved data, and sheaf data is sanitized on read. The verification pass checks:

- encounter hover reading and keyboard-selected focus pulse;
- `showHyperedges` kill switch and `enableHyperedgePulse` kill switch;
- OS `prefers-reduced-motion` overriding pulse settings;
- participant-glyph hit testing and labels for large encounters;
- all create, record, promote, relax, crystallize, lab, and replay commands after reload;
- light/dark forced themes and automatic theme after reload.

Reference captures are intentionally committed as SVG so viewport, DPR, colors, dash patterns, and geometry remain deterministic in CI rather than depending on host font rasterization.
