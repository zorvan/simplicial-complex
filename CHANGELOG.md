# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0]

The hypergraph layer. The plugin previously modelled one kind of togetherness — the simplex, whose defining property is downward closure — and generated faces for every relation. That is correct for simplices and wrong for encounters: a triad that only means something as a triad is a hyperedge, and asserting its pairs claims something the user never said.

### Added

- **`◇` hyperedge syntax** (with `hyperedge:`/`encounter:` aliases) and a `hyperedges:` frontmatter array. Arity is unbounded, unlike `△`/`△△`.
- **Hypergraph layer in the model** — a store structurally separated from the simplicial complex. Hyperedges never reach `generateFaces()`, never enter `model.simplices`, and never affect Betti numbers.
- **Namespaced relation keys** (`s:` / `h:`) so a simplex and a hyperedge over the same node set can coexist — which is exactly what promotion produces.
- **`core/incidence.ts`** — incidence matrix, node degrees, edge sizes, pairwise co-occurrence, and a cached cross-layer map of which implied faces each encounter has.
- **Four transformations**: create encounter, promote to simplex (with a dialog listing the exact faces to be asserted), relax to encounter, and crystallize concept. All user-initiated; nothing promotes automatically.
- **Append-only relation history** (`_simplicial-history.md`) recording how each relation came to be. Corrections are new events, never edits; dissolving a relation does not dissolve its history. Recurrence is derived from this log rather than stored as a counter.
- **Encounter rendering** — open dashed enclosures with low fill, distinct from the solid membranes of simplicial fields. Layout draws encounter members toward a shared centroid without creating pairwise springs.
- Commands: create encounter from open note, insert `◇` marker. Context-menu and panel actions for every transformation.
- Settings: show encounters, encounter opacity, recurrence threshold, crystallize folder, relation history toggle and path.

### Changed

- **Frontmatter and inline markers now merge.** `parseSimplices()` previously returned early when `simplices:` frontmatter was present, silently dropping inline `△` markers in the same note. Notes that carry both will now contribute both.
- Managed frontmatter arrays are only written when there is something to store, so recording an encounter no longer stamps an empty `simplices: []` onto an unrelated note.
- Parsing and frontmatter handling split into vault-independent modules (`data/parser-core.ts`, `data/frontmatter.ts`); `data/parser.ts` and `data/persistence.ts` are now thin Obsidian adapters.
- `generateFaces()` is defined in terms of a new `plannedFaces()`, so the promotion preview cannot drift from what actually happens.

### Fixed

- **Release assets now carry build attestations.** The release workflow attested files it then passed to `actions/upload-artifact`, producing a workflow artifact rather than a release asset — the downloadable files had no provenance. Assets are now attested, attached with `gh release upload`, and verified afterwards.
- **Alias resolution no longer enumerates the vault per lookup.** `resolveNodeId()` walked every markdown file once per unresolved token; it now builds an alias index once per vault change.
- `window.cancelAnimationFrame` instead of the bare global.

## [Unreleased]

### Added

- **Dynamics Lab (HG-19…HG-21)** — ephemeral note activation, pairwise/simplicial/hypergraph propagation kernels, deterministic synchronization-time diagnostics, order-parameter traces, and competing-rhythm detection.
- Dynamics simulations run in bounded UI slices and cancel when their view closes; opening, editing, and manually focusing notes feed transient canvas emphasis without writing attention state into notes.
- **Contextuality lab (HG-25…HG-29)** — explicit overlapping contexts, per-context note roles, exact H⁰/H¹ gluing diagnostics, concrete obstruction cycles, and contextual fraction.
- Gluing obstructions render as open crimson failed seams over existing fields, deliberately distinct from closed orange β₁ holes. Context definitions and local roles persist only in plugin settings, never in notes.
- `.gitignore` file for proper repository hygiene
- `LICENSE` file (MIT)
- `SPEC.md` engineering specification
- `CONTRIBUTING.md` contributor guidelines
- `CHANGELOG.md` (this file)
- ESLint configuration with TypeScript rules
- Prettier configuration
- GitHub Actions CI/CD workflow (lint, type-check, build, test)
- Linting and formatting scripts to `package.json`

### Changed

- Removed `tsc` dummy dependency from `package.json`
- Updated TODO documentation to clarify research-only items

### Fixed

- Missing LICENSE file referenced in README
- Missing SPEC.md file referenced in README and CONTRIBUTING

---

## [0.2.0] - V2: From Detection to Discovery

### Added

- **Content-based clustering** (`data/clustering.ts`): TF-IDF vectorization with k-means clustering
- **Semantic domain source**: New `domainSource` setting with options `folder`, `content-cluster`, `hybrid`
- **Betti number computation** (`core/betti.ts`): Compute β₀, β₁, β₂ topological invariants
- **Hole detection**: Enumerate unfilled triangles (β₁) and hollow tetrahedra (β₂)
- **Betti display settings**: `enableBettiComputation`, `bettiDisplayOnCanvas`, `maxBettiDim`
- **Interaction reinforcement settings**: `enableInteractionReinforcement`, `reinforcementStrength`
- **Filtration slider setting**: `showFiltrationSlider`
- **Explanation panel setting**: `enableExplanationPanel`

### Changed

- Domain diversity scoring now uses content-derived clusters instead of folder structure
- `AnalysisSummary` extended with `betti` and `holeCount` fields
- `InferenceConfig` extended with `domainSource` and `contentClusterCount`

---

## [0.1.0] - Initial Development Version

### Core Features

- Organic blob renderer with metaball capsule-union approach
- Force-directed layout with Barnes-Hut O(n log n) optimization
- Sleep mode for zero idle CPU usage
- Dual view modes: organic blobs and formal geometric rendering
- Hover focus system with ambient context revelation
- Dimension filter (edges, clusters, cores)
- Node pinning with persistence across sessions
- Rename tracking without losing layout positions
- Real-time vault change detection and updates

### Simplices

- Inline shorthand syntax (△, △△)
- YAML frontmatter with metadata (label, weight)
- Automatic face generation (capped at dimension 4)
- Two persistence modes: source-note and central-file

### Inference

- Edge inference from links, tags, title/content overlap, folders
- Suggestion system for triangle closures and soft clusters
- Temporal decay for older simplices
- Simplex centrality measures

### Analysis

- Betti number display (β₀, β₁, β₂)
- Simplex centrality per node and global hub identification
- Filtration controls with weight/confidence/decayed-weight metrics

### Interaction

- Context menu for node/simplex actions
- Lasso-select creation
- Promote simplex to note
- Dissolve simplex
- Metadata side panel with editing capabilities
- Lifecycle state progression for inferred simplices

### Performance

- Progressive loading for large vaults
- Viewport culling for render efficiency
- Text measurement caching
- Debounced settings saves

---

[Unreleased]: https://github.com/zorvan/simplicial-complex/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zorvan/simplicial-complex/releases/tag/v0.1.0
