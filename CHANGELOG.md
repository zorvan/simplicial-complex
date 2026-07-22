# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- `.gitignore` file for proper repository hygiene
- `LICENSE` file (MIT)
- `SPEC.md` engineering specification
- `CONTRIBUTING.md` contributor guidelines
- `CHANGELOG.md` (this file)
- ESLint configuration with TypeScript rules
- Prettier configuration
- GitHub Actions CI/CD workflow (lint, type-check, build, test)
- Linting and formatting scripts to `package.json`

### Fixed

- Missing LICENSE file referenced in README
- Missing SPEC.md file referenced in README and CONTRIBUTING

---

## [0.4.0] - Hardening: scalability, correctness, and maintainability

### Added

- Reverse `NodeID → simplex` index in `SimplicialModel` for O(1) node lookups
  (replaces linear scans in hover/focus/neighbor paths)
- Collapsible, filterable settings tab — every setting grouped into sections with a
  live filter box (no settings removed)
- Test suites for Betti numbers, filtration events, and the model reverse index,
  including regressions that lock the node-order and orphan-cleanup fixes
- `versions.json` (required Obsidian version → minAppVersion map)
- Runtime log-level control via `setLogLevel`

### Changed

- Logging is quiet by default in production builds (warnings/errors only); verbose
  in dev builds — removes per-scan/per-save console noise
- `removeSimplex` orphan cleanup scoped to affected simplices (was up to O(n³))
- Emergent inference engine deduplicated (`runEmergentInference` /
  `runEmergentInferenceWithHoles` now share helpers)
- Release workflow attaches `main.js`/`styles.css`/`manifest.json`/`versions.json`
  to the GitHub Release (were only uploaded as workflow artifacts, invisible to
  Obsidian's updater)

### Fixed

- **β₁ over-counting**: unfilled triangles were counted once per vertex, inflating
  β₁ (and the hole list) threefold; now deduplicated
- **Filtration events**: component-merge and node-appearance events never fired
  because component tracking was only seeded from dim-0 simplices (which the model
  never creates); components are now seeded lazily from edge endpoints, so the
  filtration slider shows merge markers as intended
- Betti and filtration analysis no longer mutate stored simplex node order via
  in-place `.sort()`
- `saveTimer` now cleared on plugin unload
- `getCachedBetti()` reuses the analysis cache instead of recomputing

### Removed

- Deprecated `tsc` dummy dependency from `package.json`

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
