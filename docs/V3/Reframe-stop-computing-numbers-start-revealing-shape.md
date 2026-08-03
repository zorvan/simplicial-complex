# Plan for next step

## The reframe: stop computing numbers, start revealing shape

Right now the plugin computes β₀/β₁/β₂ at a single scale and detects filtration "events" ad hoc (the thing I just fixed). That's the shadow of a much more powerful, and honestly more correct, object: persistent homology. Almost everything below composes into one through-line — "the shape of your knowledge" — and one killer capability that no note app has:

▎ Ranked, mathematically-justified writing prompts. "Here are the 5 notes forming your most significant unwritten synthesis, and here's why it's real and not noise."

That single sentence is the product. The rest is how you earn the right to say it and how you make it beautiful.

---

## Pillar 1 — Persistent homology (the rigorous upgrade of what you already half-built)

Your inference weights (link/tag/title/content/folder scores) are already a filtration function. Sweep a threshold from 1→0 and features are born and die. Persistent homology tracks every birth/death pair.

- Insight: a β₁ hole that survives across a huge range of thresholds is a robust conceptual gap; one that blinks in and out is noise. You finally get significance, not just count. Same for β₀: a long-lived component is a genuine knowledge silo, not an accident.
- The linchpin — representative cycles: over ℤ/2 every H₁ bar carries a representative loop of edges — literally the notes that circle the gap. Longevity = how much to trust it. This is what you highlight and hand to the user as a prompt.
- Visual: the iconic persistence barcode / diagram as an inspectable "X-ray" panel, brushed-linked to the graph — hover a bar, its representative cycle lights up as a glowing closed ribbon on the canvas.
- Builds on: replace enumeration in core/betti.ts with boundary-matrix reduction (Smith normal form over ℤ/2). Your computeFiltrationEvents becomes derived from persistence pairs — the honest version of what it was reaching for.
- Honesty: on small vaults TDA is noisy. Add bootstrap confidence bands (subsample notes, recompute diagrams, keep bars outside the noise cone). This is what separates a toy from a tool.

## Pillar 2 — The Hodge decomposition (turn the vault into a landscape + a flow)

The graph Laplacian generalizes to the 1-Hodge Laplacian L₁ on your simplicial complex. It splits every edge-flow into three orthogonal parts:
Ω = im ∂ (gradient / hierarchy) ⊕ ker L₁ (harmonic / the real holes) ⊕ im δ (curl / local circulation).

- Gradient → a global potential. HodgeRank assigns every note an altitude: foundations sit low, applications sit high, and ideas flow downhill. Suddenly your vault is terrain, and the terrain is mathematically defined, not decorative.
- Harmonic → the true holes, and it agrees with the persistent β₁ cycles — two independent derivations pointing at the same gap is a strong, trustworthy signal.
- Curl → where your linking is inconsistent/cyclic (you cite in circles).
- Visual: render the potential as a contour landscape (marching-squares over the layout), with animated particles flowing along the gradient field — beautiful and meaningful. It's the single most appealing view you could ship.

## Pillar 3 — Discrete Morse theory (name the terrain)

Once you have a scalar function on notes (the Hodge potential, or centrality/recency), discrete Morse theory extracts critical cells: minima (sources), maxima (hubs), saddles (bridges), and the Morse–Smale complex partitions the vault into watersheds.

- Insight: watersheds = your actual topics (derived, not folder-based); ridges = the boundaries between topics; passes/saddles = the keystone notes whose removal fragments your knowledge.
- Visual: the landscape gets named regions and labeled peaks/passes — a knowledge map you can literally navigate.

## Pillar 4 — Discrete Ricci curvature (find the fragile bridges)

Ollivier– or Forman–Ricci curvature per edge (Forman extends cleanly to your higher simplices). Cheap, local, no eigensolver.

- Insight: strongly negative-curvature edges are bridges between communities — your interdisciplinary keystones, valuable and fragile. Positive curvature = dense, redundant neighborhoods.
- Visual: bridges glow; run a couple of steps of Ricci flow and communities visibly separate. "These 3 links are the only things holding your two research areas together" is a great sentence to be able to say.

## Pillar 5 — The Mapper algorithm (the zoom-out summary)

Pick a lens (recency, Hodge potential, a semantic axis), cover its range, cluster within each slice, connect overlapping clusters. Out comes a small, clean graph that captures the shape — flares, loops, branches — that a hairball hides. Cheap and famously legible.

- Insight: "your vault, summarized along the axis you care about." A loop in the Mapper graph = a genuine thematic cycle; a flare = an emerging specialization.
- Visual: the Mapper graph is the visualization — nodes = clusters sized by note count, colored by lens value. Best insight-per-pixel of anything here.

## Pillar 6 — Diffusion geometry (a principled layout + multiscale roles)

Heat diffusion on the complex gives diffusion maps (an embedding where distance = conceptual relatedness at scale t) and a heat-kernel signature per note (its multiscale structural role).

- Visual: a diffusion-time slider that morphs the layout from many tiny communities (small t) to a few continents (large t) — you watch your vault coarsen. Replaces/augments the force layout with something meaning-bearing.

---

## The frontier shelf (radical, riskier, intellectually the crown)

- Vietoris–Rips on embeddings: compute persistence of meaning, not just links — embed notes (even TF-IDF), build a Rips filtration, get holes in semantic space. Bridges your current content heuristics to real TDA.
- Zigzag persistence / vineyards over time: the life-story of your ideas — when a cluster crystallized, when a gap was filled, when a bridge was built. Animated barcodes; persistence diagrams tracked over time literally trace "vines."
- Wasserstein distance between persistence diagrams: a single number for "how much did my knowledge's shape change this month," or to compare two vaults. Great for a "year in review."
- Cellular sheaves + sheaf Laplacian (Hansen/Ghrist): attach data to notes and consistency constraints to links; sheaf cohomology finds where locally-agreeing notes fail to glue into a globally coherent story — a deep, subtle notion of conceptual tension. Probably too abstract to surface directly, but it's the real cutting edge.

---

## The unifying visual language

One canvas, four coordinated layers, all from one pipeline:

1. Terrain — Hodge potential as contours (altitude = foundational→applied).
2. Flow — animated particles along the gradient/harmonic fields.
3. Highlights — persistent representative cycles as glowing ribbons (gaps), negative-curvature bridges as glowing edges (keystones), Morse peaks/passes labeled.
4. The X-ray panel — persistence barcode as the "legend of significance," brushed-linked to everything.

Plus a Mapper minimap for zoom-out and a diffusion-t slider for scale. The graph stops being a pretty hairball and becomes an instrument.

## Honest caveats

- Noise on small vaults is the real enemy — commit to bootstrap significance from day one or the prompts will be junk.
- Compute: persistence reduction and a few Laplacian eigenvectors are fine up to a few thousand notes in JS (sparse + power iteration / Lanczos); be deliberate about isDesktopOnly and web-worker offloading for big vaults.
- Legibility: every one of these can produce a beautiful-but-meaningless picture. The discipline is: every visual element must map to a sentence a user would act on.

## What I'd build first

Persistent homology with representative cycles + a significance-ranked "gaps to write" list, shown as a barcode brushed-linked to glowing cycles on the canvas. It's the highest insight-per-effort, it reuses your simplex enumeration, it turns the β₁ work you already have into the actual product promise, and it's the demo that makes people go "oh."

---

# Repository audit and implementation plan (2026-08-03)

This section turns the vision above into an implementation plan grounded in the current repository. The governing rule is:

> Do not attach a theorem's name to a heuristic. Every mathematical result exposed to the user must have a typed mathematical object, stated hypotheses, a reproducible computation, and a witness the user can inspect.

## What is already implemented

| Area | Status | Evidence in the repository | Mathematical assessment |
| --- | --- | --- | --- |
| Simplicial model and downward closure | Implemented | `core/model.ts`, `core/faces.ts`, `core/normalize.ts` | The simplex/hyperedge distinction is enforced: simplices generate faces; hyperedges do not. |
| Static “Betti” analysis | Naive and incorrectly generalised | `core/betti.ts`, `core/types.ts` | β₀ is computed correctly from the 1-skeleton. β₁ and β₂ are **not** Betti numbers in general: the code counts empty 3-cycles and tetrahedral shells only. It misses longer cycles, dependencies between cycles, and arbitrary 2-cycles. |
| Filtration UI and event markers | Partial heuristic | `core/filtration.ts`, `ui/view.ts` | Simplices are sorted by weight, but there is no persistence module, reduction pairing, barcode, or induced homology map. “Triangle close” is a local motif event, not a persistence death in general. |
| Hole rendering and explanations | Implemented for motifs only | `render/components/holes.ts`, `render/renderer.ts`, `data/explainer.ts` | Useful UI plumbing exists, but the rendered objects are missing-face motifs, not homology-class representatives. |
| Hypergraph encounters | Substantially implemented | `core/incidence.ts`, `core/activation.ts`, `core/history.ts`, `core/diagnostics.ts`, `data/inference/encounters.ts`, `ui/dynamics-view.ts` | Irreducible encounters, incidence, recurrence, cross-layer closure diagnostics, and pairwise/simplicial/hypergraph propagation are real, separate objects. The propagation kernel is an averaging dynamic, not yet a theorem-derived hypergraph Laplacian or oscillator model. |
| Contextuality/sheaf UI | Substantially implemented as a custom model | `core/sheaf.ts`, `core/sheaf-workflow.ts`, `core/linalg.ts`, `data/sheaf-store.ts`, `ui/sheaf-view.ts`, `render/components/obstructions.ts` | Context covers, local role assignments, overlaps, gluing tests, cycle holonomy, exact rational rank, obstruction witnesses, and a contextual fraction are present. However, this is **not yet an Abramsky–Brandenburger empirical model**, and its reported `h1` is a rank of open holonomies rather than a demonstrated sheaf-cohomology group. |
| Hodge decomposition / HodgeRank | Not implemented | No source module or test | The existing `sheafLaplacian` only forms \(\delta^T\delta\) for a supplied matrix; it does not construct simplicial \(L_0,L_1\), project edge flows, or solve HodgeRank. |
| Discrete Morse theory | Not implemented | No source module or test | No discrete gradient vector field, critical cells, cancellations, or Morse–Smale decomposition. |
| Discrete Ricci curvature | Not implemented | No source module or test | No Forman, augmented Forman, or Ollivier curvature. |
| Mapper | Not implemented | No source module or test | No cover, pullback clustering, nerve, or stability diagnostics. |
| Diffusion geometry | Not implemented | No source module or test | Activation averaging is not a diffusion-map embedding or heat-kernel signature. |
| Rips, zigzag/vineyards, diagram distance, bootstrap confidence | Not implemented | No source module or test | These remain frontier work. |

Two existing names must be separated immediately:

- `data/persistence.ts` persists plugin data to notes/settings; it is unrelated to persistent homology.
- Encounter `persistence: "momentary" | "recurring"` means temporal recurrence; it is unrelated to a persistence interval. New topology types should use `PersistenceInterval` or `PersistenceDiagram`, never the unqualified property name.

## Mathematical comment standard

Every new mathematical module must begin with a comment containing these five fields:

```ts
/**
 * Mathematical object: C_k(K; F_2) with an ordered simplex basis.
 * Result used: boundary-of-boundary theorem, d_{k-1} d_k = 0.
 * Preconditions: finite downward-closed complex; face-compatible filtration.
 * Consequence: reduced boundary columns pair births and deaths in persistent homology.
 * Non-claim: the returned representative is not canonical or necessarily shortest.
 */
```

Function comments must explain why the theorem applies at that point in the algorithm. References belong in the module header and in this document; tests must encode the theorem's invariant. A comment such as “uses Hodge theory” without the operator, domain, hypotheses, and consequence is insufficient.

## Phase 0 — repair the mathematical contract

Do this before adding new visuals.

1. Rename the current motif output from `Hole` to `MissingFaceBoundary` and expose it as a local completion opportunity, not a Betti class. Keep a temporary compatibility adapter for UI consumers.
2. Replace `computeBetti` with boundary-operator ranks over \(\mathbb F_2\):
   \[
   \beta_k = \dim C_k - \operatorname{rank}\partial_k - \operatorname{rank}\partial_{k+1}.
   \]
   Build canonical ordered bases, sparse boundary columns, and assert \(\partial_{k-1}\partial_k=0\). This is the rank-nullity theorem applied to \(H_k=\ker\partial_k/\operatorname{im}\partial_{k+1}\), not empty-cycle enumeration.
3. Add fixtures that distinguish motifs from homology: a square boundary has β₁=1 but no empty triangle; two homologous cycles must not be counted twice; a triangulated disk has β₁=0; a triangulated sphere has β₂=1; a filled tetrahedron has β₂=0.
4. Correct user-facing labels, inference rules, and explainers. `open-triad` may consume missing triangular faces, but must not claim that every such face is an independent β₁ generator.
5. In `core/sheaf.ts`, temporarily rename `h1` to `obstructionRank` and `h0` to `globalBaselineDimension`, or implement the actual cochain complex before retaining cohomological notation. Add a documentation warning in the Contextuality Lab.

**Exit criterion:** Euler–Poincaré holds on every finite fixture,
\(\chi(K)=\sum_k(-1)^k f_k=\sum_k(-1)^k\beta_k\), and motif counts are nowhere presented as Betti numbers.

## Phase 1 — persistent homology and inspectable witnesses

This is the first product milestone.

1. Add `core/topology/chain-complex.ts` with simplex bases, face indices, sparse \(\mathbb F_2\) columns, and filtration validation. Enforce the lower-star/face condition: every face enters no later than its coface. When raw weights violate it, derive a face-compatible value and report the adjustment.
2. Add `core/topology/persistence.ts` implementing the standard left-to-right column-reduction algorithm (`low` pairing) over \(\mathbb F_2\). This is not Smith normal form; it is filtered boundary-matrix reduction preserving filtration order.
3. Track the change-of-basis matrix so each finite or essential \(H_1\) interval carries a cycle witness. State in comments that representatives are basis- and reduction-order-dependent. Add an optional shortest homologous cycle pass only after the basic witness is correct.
4. Replace `computeFiltrationEvents` with events derived from interval births/deaths. Preserve non-topological “simplex appeared” markers under a different type.
5. Add `PersistenceInterval`, `PersistenceDiagram`, `CycleRepresentative`, coefficient-field, metric, and provenance types. Cache results by model revision plus filtration metric.
6. Add property tests: permutation invariance of interval multisets under tie-free filtrations; every representative has zero boundary; a death column's paired birth is correct; static Betti numbers equal the number of intervals alive at a threshold.
7. Add a barcode/diagram panel and brush linking. Hovering an interval highlights its stored witness; the copy must say “one representative of this class,” not “the unique hole.”
8. Rank writing prompts by persistence only after calibrating the filtration direction and units. Never compare lifetimes from different metrics without normalisation.

**Theorems/results to cite in code:** the persistence-module decomposition theorem for pointwise finite-dimensional one-parameter persistence; the standard matrix-reduction pairing theorem; and the bottleneck stability theorem. Stability applies only after specifying the filtered-function perturbation being bounded—it does not make inference weights objectively meaningful.

**Exit criterion:** the square, annulus, sphere, and noisy-cycle fixtures yield correct barcodes and clickable cycle witnesses; the old filtration-event code is no longer an independent source of topology.

## Phase 2 — uncertainty instead of a decorative “noise cone”

1. Define the sampling model first: note subsampling, edge/weight perturbation, or temporal block bootstrap answer different questions. Default to stratified note/encounter subsampling so folders and time ranges are not accidentally erased.
2. Recompute diagrams in a worker, match them to the full diagram with bottleneck or Wasserstein matchings, and report support frequency plus interval endpoint distributions.
3. Use the persistence stability theorem as a perturbation bound where its hypotheses hold. Label bootstrap output as empirical uncertainty, not a theorem-level confidence interval unless coverage is established.
4. Require minimum support and effect size before generating “gap to write” prompts. Show why an interval ranked highly: lifetime, bootstrap support, witness size, and metric provenance.

**Exit criterion:** seeded resampling is reproducible, cancellation-safe, and distinguishes one injected robust loop from short-lived noise in synthetic fixtures.

## Phase 3 — simplicial Hodge theory and flow

1. Add oriented real-valued boundary matrices \(B_1,B_2\) separately from the \(\mathbb F_2\) persistence representation. Construct
   \[
   L_0=B_1B_1^T,\qquad L_1=B_1^TB_1+B_2B_2^T.
   \]
2. Define the edge-flow input. Link direction, citation direction, edit transition, and inferred-score gradient are different 1-cochains; do not silently invent an orientation.
3. Compute the orthogonal decomposition
   \[
   C^1=\operatorname{im}B_1^T\oplus\ker L_1\oplus\operatorname{im}B_2
   \]
   using sparse least-squares/eigensolvers. Comments must invoke the finite-dimensional combinatorial Hodge decomposition and the isomorphism \(\ker L_k\cong H^k(K;\mathbb R)\).
4. Implement HodgeRank only for an explicitly directed comparison flow. The vertex potential is defined up to one additive constant per connected component; fix a gauge and expose residual/cyclic inconsistency.
5. Cross-check the harmonic dimension against static β₁ at the same threshold. Do not claim that a harmonic vector “agrees with” a persistent representative: they live over different fields and choose different representatives of a class. Compare support/overlap only as a diagnostic.

**Exit criterion:** orthogonality and reconstruction tests pass, \(\dim\ker L_1=\beta_1\), and every rendered flow identifies its source cochain.

## Phase 4 — rigorous contextuality and sheaf obstruction

This phase should offer two named models rather than blending them.

### 4A. Preserve and correctly name the current language-context model

1. Formalise stalk vector spaces and restriction maps for a cellular sheaf on the context–note incidence complex.
2. Construct \(C^0,C^1,\delta^0\) (and \(\delta^1\) if the base has 2-cells), then compute \(H^0=\ker\delta^0\) and \(H^1=\ker\delta^1/\operatorname{im}\delta^0\). Only then restore `h0`/`h1` labels.
3. Replace one-hot role “baseline shifts” with declared linear restriction maps or keep the present holonomy model under its own name. A finite set of roles is not automatically a vector-space sheaf.
4. Use the sheaf Laplacian theorem only for a genuine cellular sheaf: \(\ker L_k\cong H^k\). Render a harmonic obstruction witness and the contexts/notes supporting it.

### 4B. Add an Abramsky–Brandenburger empirical-model mode

1. Define a measurement scenario \((X,\mathcal M,O)\): measurements/questions \(X\), a cover of jointly observable contexts \(\mathcal M\), and outcomes \(O\). Notes may describe evidence, but must not be silently equated with measurements.
2. Implement the event presheaf \(\mathcal E(U)=O^U\) with restriction by function restriction. Store empirical distributions or supports on maximal contexts and validate compatibility/no-signalling on overlaps.
3. Search for a compatible global section. In Abramsky–Brandenburger language, contextuality is obstruction to a global assignment compatible with all local data; plain disagreement on an overlap fails the compatibility premise and is not contextuality.
4. Implement the support hierarchy: possibilistic logical contextuality, strong contextuality, and—only when distributions are present—probabilistic contextuality/non-contextual fraction via a linear program.
5. Add the Abramsky–Mansfield–Barbosa style Čech cohomology obstruction as a **sound witness, not a complete decision procedure**: a non-zero obstruction witnesses contextuality, while a zero obstruction can be a false negative. Document coefficient choices and the chosen local section.
6. In language shown to users, translate carefully: “These locally valid readings have no common global assignment” and “This cohomology class witnesses that failure.” Never claim quantum contextuality for ordinary semantic inconsistency.

**Exit criterion:** canonical contextual and non-contextual measurement scenarios pass; incompatible marginals are reported as local inconsistency; cohomological false-negative fixtures prevent treating vanishing obstruction as proof of non-contextuality.

## Phase 5 — hypergraph theory beyond averaging

1. Keep encounters irreducible and retain the incidence representation. Add a typed choice of hypergraph operator rather than one generic “hypergraph Laplacian.”
2. Implement a documented diffusion operator, initially the normalised incidence/bipartite Laplacian. State whether it is vertex-to-hyperedge diffusion, a clique expansion, a star expansion, or a nonlinear operator; these are not interchangeable.
3. If reproducing synchronization claims, implement the paper's oscillator dynamics and hypotheses as an experiment separate from activation averaging. Report degree heterogeneity, overlap, directionality, initial conditions, and convergence criterion.
4. Add higher-order diagnostics tied to results: incidence duality, connected components via the incidence bipartite graph, overlap matrices, and cross-order correlations. Preserve closure deficit as a cross-layer diagnostic, not a topological invariant.
5. Connect hypergraph encounters to contextuality only through an explicit measurement cover or cellular-sheaf base. An encounter is not automatically a context in the Abramsky sense.

**Exit criterion:** each Dynamics Lab result names its operator and assumptions, and identical fixtures visibly distinguish clique-expanded pairwise flow from irreducible incidence flow.

## Phase 6 — curvature, Mapper, diffusion geometry, and Morse theory

Implement these in dependency order, not in the visual order of the original vision.

1. **Forman curvature first:** implement graph Forman curvature, then a separately named augmented/simplicial variant with its exact formula. Unit-test paths, cycles, trees, and complete complexes. Do not describe negative curvature as a guaranteed community bridge; treat it as a ranked structural signal and validate against edge-removal impact.
2. **Diffusion geometry:** reuse a validated symmetric positive-semidefinite operator; compute diffusion coordinates from eigenpairs and heat-kernel signatures. Document the spectral theorem and the diffusion-distance truncation. The time slider must show eigenvalue/eigengap diagnostics and disconnected-component handling.
3. **Mapper:** define lens, interval cover, overlap percentage, within-bin metric, clustering method, and nerve construction. By the nerve theorem, homotopy equivalence requires a good cover; ordinary Mapper clusters usually do not establish those hypotheses, so UI copy must say “summary” rather than “same topology.” Add parameter-sensitivity views before interpreting loops.
4. **Discrete Morse:** begin with Forman's discrete Morse functions and acyclic partial matchings. Verify Morse inequalities and homology preservation after cancellations. A graph-layout scalar is not automatically a valid discrete Morse function; construct or repair a valid matching. Defer Morse–Smale terrain labels until critical cells are stable under perturbation.

**Exit criterion:** every view has synthetic truth cases, parameter sensitivity, and a plain-language sentence whose strength matches the theorem actually used.

## Phase 7 — frontier work

1. **Vietoris–Rips persistence:** record embedding model/version, metric, normalisation, duplicate handling, and maximum dimension. Invoke the stability of Rips persistence only with a stated metric-space perturbation bound. Compare semantic-space bars with relation-complex bars; do not merge them.
2. **Temporal topology:** start with vineyard updates only for continuously changing filtration values on a fixed complex. Use zigzag persistence when notes/relations are both inserted and deleted. These are different algebraic settings and need different data models.
3. **Diagram distance:** implement bottleneck first for robustness comparisons, then \(p\)-Wasserstein with diagonal matching and essential-class handling. A distance measures diagram change, not automatically “knowledge growth.”
4. **Performance:** move reductions, eigensolvers, bootstrap, and diagram matching behind cancellable workers; add sparse memory budgets and deterministic fallbacks.

## Delivery slices

| Slice | User-visible result | Required internal proof obligation |
| --- | --- | --- |
| A | Correct static β₀/β₁/β₂ and separately named missing-face prompts | Boundary complex, rank-nullity, Euler–Poincaré tests |
| B | Barcode linked to a cycle witness | Valid filtration, reduction pairing, witness boundary is zero |
| C | Ranked “gaps to write” with uncertainty | Reproducible resampling and disclosed ranking provenance |
| D | Gradient/harmonic/curl flow view | Hodge reconstruction, orthogonality, harmonic–Betti equality |
| E | Honest Contextuality Lab with two modes | Actual sheaf cochains or renamed holonomy; AB global-section semantics |
| F | Theorem-labelled hypergraph dynamics | Operator and model hypotheses shown with every result |
| G | Curvature/diffusion/Mapper/Morse views | Fixture truth cases and parameter-sensitivity reports |

Slices A–C are the next release. D–E are the following release. F–G and frontier work should not block the first rigorous “shape of knowledge” product.

## Primary references to keep beside the implementation

- Edelsbrunner, Letscher, and Zomorodian, *Topological Persistence and Simplification*; Zomorodian and Carlsson, *Computing Persistent Homology*.
- Cohen-Steiner, Edelsbrunner, and Harer, *Stability of Persistence Diagrams*.
- Eckmann, *Harmonische Funktionen und Randwertaufgaben in einem Komplex*; modern combinatorial Hodge treatments should be cited for the exact operators implemented.
- Forman, *Morse Theory for Cell Complexes* and *Bochner's Method for Cell Complexes and Combinatorial Ricci Curvature*.
- Singh, Mémoli, and Carlsson, *Topological Methods for the Analysis of High Dimensional Data Sets and 3D Object Recognition* (Mapper).
- Coifman and Lafon, *Diffusion Maps*.
- Abramsky and Brandenburger, *The Sheaf-Theoretic Structure of Non-Locality and Contextuality*.
- Abramsky, Mansfield, and Barbosa, *The Cohomology of Non-Locality and Contextuality*; and later work on cohomological obstructions and their limitations.
- Hansen and Ghrist, *Toward a Spectral Theory of Cellular Sheaves*.

The references guide implementation; the acceptance tests decide whether the implementation has earned the language used in the interface.
