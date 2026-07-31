# Hypergraph Layer — Implementation Plan (v3)

**Project:** simplicial-complex
**Source:** `Obsidian-Extension-Hypergraph.md`
**Status:** Planning
**Owner:** Amin Razavi

---

## Thesis

The plugin currently models one kind of togetherness: the simplex, whose defining property is downward closure — asserting `{A,B,C}` asserts `{A,B}`, `{A,C}`, `{B,C}`. `core/faces.ts:generateFaces()` materializes that closure automatically, and `core/model.ts:addSimplex()` calls it unconditionally.

That is correct for simplices and wrong for encounters. A triad that only means something as a triad is a **hyperedge**: an irreducible group relation making no claim about its subgroups. This plan adds the hypergraph as a first-class second layer, keeps the two layers structurally separate, and adds explicit user-driven transformations between them.

**The invariant that governs every ticket below:** a hyperedge never enters `generateFaces()`, never enters `model.simplices`, and never contributes to boundary/Betti computation.

---

## Scope across the four layers

The source document names four complementary layers. All four are in scope for v3; they differ in phase and in how much of the mathematics is worth building now.

| Layer                  | Function                                                | Tickets                  | Phase |
| ---------------------- | ------------------------------------------------------- | ------------------------ | ----- |
| **Hypergraph**         | Encounters and irreducible group emergence              | HG-01…HG-17              | 1–5   |
| **Simplicial complex** | Coherence inherited across subrelations                 | already built + HG-08/09 | —     |
| **Sheaf**              | What can be translated or glued across contexts         | HG-25…HG-29              | 7     |
| **Persistence**        | How encounters and transformations persist through time | HG-30…HG-32              | 8     |

The hypergraph layer comes first because it is the layer the current code actively contradicts — `addSimplex()` asserts closure that was never claimed. The sheaf and Persistence layers add structure the code lacks but does not currently misrepresent, so they are additive rather than corrective.

**Ordering caveat:** Persistence is numbered last but is depended on earlier. HG-08 (promote) and HG-09 (relax) claim to "retain provenance", and HG-13 tracks `occurrences[]` — both are partial, ad-hoc versions of the event log HG-30 defines properly. Either accept that HG-08/09/13 store provenance in a form HG-30 later migrates, or pull HG-30 forward to Phase 3. _Recommendation: pull HG-30 forward_ — it is small, and retrofitting history onto records that were overwritten is impossible by construction.

---

## Current-state facts the plan depends on

| Fact                                                                                 | Location                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| `addSimplex()` unconditionally calls `generateFaces()`                               | `core/model.ts:168`                           |
| Keys are node-set hashes with no kind namespace                                      | `core/normalize.ts:normalizeKey`              |
| Betti computation iterates `model.simplices` wholesale                               | `core/betti.ts:15`                            |
| Parser recognizes only `△`/`simplex:` inline and `simplices:` frontmatter            | `data/parser.ts:7,47`                         |
| Persistence serializes only `nodes`/`label`/`weight` into a `simplices:` array       | `data/persistence.ts:11,32`                   |
| Renderer selects geometry by `simplex.nodes.length` and caches blobs by node-set key | `render/renderer.ts:211`, `render/blobs.ts:9` |
| `FocusState.involvesSimplex()` is simplex-typed                                      | `core/types.ts:153`                           |
| Inference engine emits `Simplex` objects only                                        | `data/inference/engine.ts`                    |

### Key collision — resolve before any other ticket

`normalizeKey({A,B,C})` is identical whether the relation is a simplex or a hyperedge, and both a simplex and a hyperedge over the same node set are legitimately allowed to coexist (that is precisely what "promote" produces if we keep provenance). Every map, cache key, focus set, and persisted reference must therefore be namespaced (`s:<hash>` / `h:<hash>`). HG-01 owns this; nothing else can land first.

---

## Phase 1 — Model foundation

### HG-01 — Namespaced relation keys and `HigherOrderRelation` type

**Size:** M · **Deps:** none · **Blocks:** everything

Introduce the discriminated union and a kind-aware key scheme.

- Add to `core/types.ts`:
  - `type RelationKind = "simplex" | "hyperedge"`
  - `interface Hyperedge { nodes: NodeID[]; label?: string; colorKey?: ColorKey; weight?: number; occurredAt?: number; occurrences?: number[]; persistence?: "momentary" | "recurring"; sourcePath?: string; mode?: string }`
  - `type HigherOrderRelation = ({ kind: "simplex" } & Simplex) | ({ kind: "hyperedge" } & Hyperedge)`
  - `type RelationKey = string` (namespaced), keep `SimplexKey` as-is for the simplicial layer.
- Add `core/normalize.ts:relationKey(kind, nodes)` producing `s:<hash>` / `h:<hash>`, plus `parseRelationKey()`.
- Do **not** rewrite existing `SimplexKey` call sites in this ticket; simplex keys stay bare for back-compat, hyperedges are namespaced from birth. Add a comment recording this asymmetry.

**Acceptance:** `relationKey` round-trips through `parseRelationKey`; a simplex and hyperedge over the same nodes produce distinct keys; `npm run check` clean; unit tests in `tests/core.test.ts`.

---

### HG-02 — Hyperedge store in `SimplicialModel`

**Size:** L · **Deps:** HG-01

Add a parallel store that structurally cannot leak into the simplicial layer.

- `readonly hyperedges = new Map<RelationKey, Hyperedge>()` in `core/model.ts`.
- `addHyperedge(h)` — normalizes nodes, creates missing `LayoutNode`s, **never** calls `generateFaces()`, invalidates analysis cache, emits change.
- `removeHyperedge(key)`, `getHyperedge(key)`, `getHyperedgesForNode(id)`, `getAllRelations(): HigherOrderRelation[]`.
- Extend `removeNode()` and `updateNodeId()` to maintain the hyperedge map (currently they only walk `simplices`).
- Extend `replaceSourceSimplices()` into `replaceSourceRelations(sourcePath, simplices, hyperedges)` so a file rescan clears both layers for that path.
- Add a guard: `addSimplex()` throws in dev / logs an error if handed an object with `kind === "hyperedge"`.

**Acceptance:** adding a 3-node hyperedge leaves `model.simplices.size` unchanged; `removeNode` on a participant drops the hyperedge; `computeBetti` output is byte-identical before and after adding hyperedges (regression test).

---

### HG-03 — Incidence matrix and cross-layer mapping

**Size:** M · **Deps:** HG-02

New `core/incidence.ts`:

- `buildIncidenceMatrix(model): { nodes: NodeID[]; edges: RelationKey[]; matrix: Uint8Array }` (row-major, node × hyperedge).
- `nodeDegrees()`, `edgeSizes()`, `pairwiseCooccurrence()` derived helpers.
- `crossLayerMap(model)` — for each hyperedge, which of its implied faces exist as simplices, and for each simplex, which hyperedges cover it. This is the shared substrate for every diagnostic in Phase 3, so build it once and cache it on the model alongside `_analysisCache`.

**Acceptance:** incidence matrix matches a brute-force reference on a fixture vault; cache invalidates on any relation mutation.

---

## Phase 2 — Syntax, parsing, persistence

### HG-04 — `◇` inline syntax and `hyperedges:` frontmatter

**Size:** M · **Deps:** HG-01

- `data/parser.ts`: add `HYPEREDGE_MARKER = /^(◇|hyperedge:|encounter:)\s+(.+)$/gim`. Unlike `△`/`△△`, arity is unbounded — take all tokens.
- Parse `hyperedges:` frontmatter array with `nodes`, `label`, `mode`, `occurredAt`.
- `ParsedFileResult` gains `hyperedges: Hyperedge[]`.
- **Fix an existing bug while here:** `parseSimplices()` returns early when `frontmatter.simplices` exists, so inline `△` markers in a note that also has frontmatter simplices are silently ignored. The hyperedge path must merge frontmatter and inline results, and the simplex path should be brought in line — call it out in the PR since it changes existing behavior.
- Dedupe per kind, not globally.

**Acceptance:** fixture note with both `△` and `◇` lines plus both frontmatter arrays yields the expected 4 relations; a `◇` line produces zero auto-generated faces.

---

### HG-05 — Hyperedge persistence and write-back

**Size:** M · **Deps:** HG-04, HG-02

- `data/persistence.ts`: `hyperedgeToSerializable()` (nodes, label, mode, occurredAt, persistence), `updateHyperedgeArray()`, `writeHyperedgeToSourceNote()`, and central-file equivalents.
- `ensureCentralFile()` initial content gains `hyperedges: []`.
- `WritebackTarget` gains `kind: RelationKind` so the panel can route writes correctly.

**Acceptance:** create → write → reload vault → hyperedge reappears with metadata intact; simplex write-back is unaffected (existing tests still pass).

---

### HG-06 — Migration and back-compat

**Size:** S · **Deps:** HG-05

Existing vaults have only `simplices:`. No data migration is needed — the two arrays are independent — but the plugin must not corrupt notes written by older versions.

- Unknown frontmatter keys preserved on write (verify `parseManagedFrontmatter`/`serializeFrontmatter` round-trip).
- Version note in `CHANGELOG.md`; document both syntaxes in `README.md`.

**Acceptance:** a note carrying unrelated frontmatter keys survives a hyperedge write-back byte-identical apart from the managed arrays.

---

## Phase 3 — Transformations

### HG-07 — Create encounter

**Size:** M · **Deps:** HG-02, HG-05

- Command `create-encounter` ("Simplicial: create encounter from selection/open notes"), mirroring `formSimplexFromOpenNote()` in `main.ts:135`.
- Extend `ui/create-simplex-modal.ts` into a relation modal with a kind toggle (simplex / encounter), label field, and — for encounters — a `mode` field.
- Sets `occurredAt: Date.now()`, `persistence: "momentary"`.

**Acceptance:** command produces a hyperedge, persists it, renders it, and generates no faces.

---

### HG-08 — Promote to simplex

**Size:** M · **Deps:** HG-07, HG-03

User asserts the faces are meaningful.

- `promoteToSimplex(key)` on the model: adds the simplex (full face generation), and by default **retains** the hyperedge as encounter provenance (`promotedTo: SimplexKey`). Retention is what makes HG-09 reversible and what "Persistence" requires — the journey must not be retrospectively rewritten.
- Panel action + command. Confirmation dialog lists exactly which faces will be created.
- Write-back updates both frontmatter arrays in one edit.

**Acceptance:** promoting `◇ A B C` yields simplex `{A,B,C}` plus 3 auto-generated faces, hyperedge still present and marked promoted; Betti recomputes.

---

### HG-09 — Relax to hyperedge

**Size:** M · **Deps:** HG-08

Removes the downward-closure claim, preserves the group relation.

- `relaxToHyperedge(simplexKey)`: create/re-activate the hyperedge, delete the simplex, and drop faces that no longer have a non-auto-generated parent — the existing orphan sweep in `removeSimplex()` (`core/model.ts:176`) already implements this; reuse rather than duplicate it.
- Preserve `occurredAt` from the original hyperedge if one exists.

**Acceptance:** promote-then-relax returns the model to a state equal to the pre-promote state except for retained provenance; faces shared with an unrelated simplex are **not** deleted (explicit test).

---

### HG-10 — Crystallize concept

**Size:** L · **Deps:** HG-07, HG-13

A recurring hyperedge precipitates a new note representing the emergent concept.

- Panel action on hyperedges with `persistence: "recurring"`.
- Creates a note (configurable folder) with frontmatter linking back to participants and the originating hyperedge; adds the new node to the model.
- Offer, but never perform automatically, a follow-up hyperedge from `{new concept} ∪ participants`.
- **Explicitly out of scope: automatic promotion of recurring hyperedges.** Repetition is evidence, not proof. Enforce with a test asserting no code path calls `promoteToSimplex` without a user action.

**Acceptance:** crystallize creates the note, wires the node, and leaves the source hyperedge unpromoted.

---

## Phase 4 — Diagnostics

### HG-11 — Closure deficit and simpliciality

**Size:** M · **Deps:** HG-03

New `core/diagnostics.ts`:

- `closureDeficit(model, hyperedgeKey)` — count and list of implied faces absent from the simplicial layer, normalized to `[0,1]`.
- `simpliciality(model)` — how close the hyperedge collection is to downward closure, vault-wide and per-component.
- Guard combinatorics: an n-node hyperedge implies `2^n − n − 2` faces. Cap enumeration at the existing `MAX_FACE_GEN_DIM` scale and report large hyperedges as "unbounded deficit" rather than enumerating.

**Acceptance:** hand-computed fixtures match; a 12-node hyperedge does not hang the UI.

---

### HG-12 — Face independence

**Size:** M · **Deps:** HG-11

Do proper subgroups produce meaningful results? Reuse the existing scorer (`data/inference/scorer.ts`) to score each proper subset of a hyperedge against the same signals used for simplices; low subset scores with a high full-set score is the signature of genuine irreducibility.

**Acceptance:** on a fixture where a triad shares no pairwise evidence, `faceIndependence` is high; where all three pairs are linked, it is low.

---

### HG-13 — Encounter persistence and recurrence

**Size:** M · **Deps:** HG-02, HG-05

- Record `occurrences: number[]` when the same node set is encountered again (parser re-scan, manual create, or activation co-firing from HG-16).
- Derive `persistence: "momentary" | "recurring"` via a settings threshold (`encounterRecurrenceThreshold`, default 3).
- Reuse the decay model in `data/interactions.ts` rather than inventing a second half-life scheme.

**Acceptance:** re-encountering a set thrice flips it to `recurring` and enables the crystallize action.

---

### HG-14 — Overlap pressure

**Size:** S · **Deps:** HG-03

Detect a note participating in too many mutually inconsistent hyperedges: for node `v`, measure the number of incident hyperedges weighted by how little they overlap with each other (high count + low mutual Jaccard = high pressure). Surfaces the "one note is overloaded across incompatible contexts" reading.

**Acceptance:** a node in 5 disjoint hyperedges scores higher than a node in 5 nested ones.

---

### HG-15 — Diagnostics surfacing in panel and HUD

**Size:** M · **Deps:** HG-11–HG-14

- `ui/panel.ts`: hyperedge-specific section — closure deficit, face independence, persistence, overlap pressure — each with a one-line plain-language reading, in the register of _"This cluster looks visually coherent, but its meaning exists only at order three."_
- `render/components/hud.ts`: vault-level simpliciality and encounter counts.
- `data/explainer.ts`: extend to explain hyperedges, not just inferred simplices.

**Acceptance:** hovering a hyperedge shows all four measures; simplex panels are unchanged.

---

## Phase 5 — Visual language

### HG-16 — Hyperedge rendering primitive

**Size:** L · **Deps:** HG-02

Simplex reads as a stable field/membrane; hyperedge must read as a transient enclosure.

- `render/blobs.ts`: dashed/soft-edged enclosure with lower fill alpha and no interior gradient; **cache keys must include the relation kind** (the current cache is keyed by node set alone — a simplex and hyperedge over the same nodes would collide).
- `render/renderer.ts`: extend `getRenderableSimplices()` → `getRenderableRelations()`, `findSimplexAtPoint()` → `findRelationAtPoint()`, and honor `maxRenderedDim` for simplices only (hyperedge order is not dimension and must not be capped by it).
- Settings: `showHyperedges`, `hyperedgeOpacity`.
- Layout: `layout/engine.ts` applies cohesion across hyperedge members without creating pairwise edges. Verify sparse-graph tuning (`sparseEdgeLength`, `sparseGravityBoost`) still behaves.

**Acceptance:** a hyperedge and a simplex over the same nodes render distinguishably and simultaneously; frame time on a 500-node fixture within 10% of current.

---

### HG-17 — Focus, pulse, and coalition highlighting

**Size:** M · **Deps:** HG-16

- Generalize `FocusState.involvesSimplex` → `involvesRelation(relation, key)` in `core/types.ts` and `interaction/controller.ts`.
- Focusing a hyperedge pulses its participants in phase — synchronized breathing as an interface experience, asserting temporary alignment of attention rather than permanent semantic connection.
- Respect `prefers-reduced-motion`; provide a settings kill switch.

**Acceptance:** focusing a hyperedge animates only its members; reduced-motion users get a static highlight.

---

### HG-18 — Emergence and closure-deficit visuals

**Size:** S · **Deps:** HG-16, HG-11

- Emergence: visual precipitation cue on hyperedges eligible for crystallization (HG-10).
- Closure deficit: hyperedges whose implied faces are largely absent read as more "unresolved" than hyperedges sitting on a filled-in neighborhood.

**Acceptance:** high-closure-deficit hyperedges are visually distinct from low-deficit ones without reading the panel.

> **Correction from the first draft.** This ticket originally also covered obstruction rendering, described as reusing `render/components/holes.ts`. That conflated two different objects. A β₁ hole is a **missing simplex** — a cycle of relations with no filler. A sheaf obstruction is a **failure to glue existing local data** — every relation is present, but no globally consistent assignment over them exists. A vault can have zero holes and severe obstruction, or vice versa. Obstruction moves to HG-28, where it depends on an actual sheaf.

---

## Phase 6 — Dynamics Lab

### HG-19 — Activation and excitation propagation

**Size:** L · **Deps:** HG-16

Synchronize **attention and activation**, never note content.

- `core/activation.ts`: ephemeral per-node activation from open / edit / manual focus / query participation / recency. Never persisted to notes; lives in plugin data at most.
- Propagation kernels behind one interface: pairwise (graph), simplicial (faces), hypergraph (incidence).
- Feed activation into render alpha and the pulse from HG-17.

**Acceptance:** opening a note raises its hyperedge co-members and leaves unrelated notes quiet; activation state is absent from all note files (test asserts no write-back).

---

### HG-20 — Synchronization-time diagnostic

**Size:** M · **Deps:** HG-19

`synchronizationTime(model, hyperedgeKey, kernel)` — iterations for member activation variance to fall below a threshold under a chosen kernel. Runs off the main thread or in a bounded time slice; it is a simulation, not a render-loop computation.

**Acceptance:** deterministic under a seeded initial state; bounded runtime on a 500-node vault.

---

### HG-21 — Dynamics Lab view

**Size:** L · **Deps:** HG-19, HG-20

A view (new `VIEW_TYPE`) running the same vault under all three kernels side by side, with per-kernel sync time, order-parameter trace, and detection of competing encounter rhythms. This is the ticket that makes the plugin an experimental instrument rather than a renderer — and the one most safely deferred if scope pressure appears.

**Acceptance:** all three kernels run on the active vault and report distinguishable results on a fixture designed to separate them.

---

## Phase 7 — Sheaf layer: contextuality and obstruction

The hypergraph asks _who was together_. The simplicial complex asks _whether that togetherness is compositional_. Neither asks _whether a note means the same thing in each context it appears in_ — and that is the question the plugin is currently least equipped to answer, because `extractRole()` (`data/inference/roles.ts:4`) assigns each note exactly one role for the whole vault. A note is `research` everywhere or `project` everywhere. The sheaf layer replaces that global assignment with a local one and then asks whether the local assignments glue.

This is where obstruction actually lives, and where "one note is overloaded across incompatible contexts" gets a real invariant instead of the count-based proxy in HG-14.

### HG-25 — Cellular sheaf over the complex

**Size:** L · **Deps:** HG-03

New `core/sheaf.ts`.

- **Stalks.** Each node carries a stalk: the set of contextual attributes it holds — role, label, sense — _within a given relation_, not globally. Each relation carries a stalk for the shared/consensus assignment.
- **Restriction maps.** Relation → member node, and simplex → face. Initially these are simple projections; the structure matters more than the sophistication.
- **Sections.** A local section assigns values to nodes over a sub-collection of relations.
- Backfill: derive the initial per-relation role from `extractRole()`, then allow divergence. This keeps existing behavior as the degenerate case where every context agrees.

**Acceptance:** a note participating in three relations can carry three different roles; with all three equal, every Phase 7 diagnostic reports zero obstruction (degenerate case = current behavior).

---

### HG-26 — Contexts and the cover

**Size:** M · **Deps:** HG-25

A sheaf is defined over a cover, and the cover has to come from somewhere. Ship an explicit notion of context rather than inferring one.

- `Context` = a named sub-collection of relations, defined by folder, tag, query, MOC note, or manual selection.
- Contexts may overlap — overlap is the entire point; disjoint contexts have nothing to glue.
- UI for defining and naming contexts; persisted in plugin settings, not in notes.

**Acceptance:** a user can define two overlapping contexts and see which nodes lie in the intersection.

---

### HG-27 — Gluing check and global sections (H⁰)

**Size:** L · **Deps:** HG-26

- Pairwise agreement: for each pair of contexts, do their sections agree on the overlap?
- H⁰ = the space of globally consistent assignments. Non-trivial H⁰ means the vault admits a coherent shared reading; H⁰ collapsing to a single trivial value means agreement was purchased by saying nothing.
- **Linear algebra is a real dependency here.** `computeBetti()` uses direct enumeration and explicitly avoids boundary-matrix rank computation (`core/betti.ts:12`), so there is nothing to reuse. This ticket needs a small `core/linalg.ts` — rank, kernel, and a sheaf Laplacian over ℚ or GF(2). Budget for it; it is the single largest hidden cost in Phase 7.

**Acceptance:** hand-built fixture with a known global section reports it; fixture with a deliberate disagreement reports none.

---

### HG-28 — Obstruction detection and contextual fraction (H¹)

**Size:** L · **Deps:** HG-27

The payoff ticket. An obstruction is a cycle of contexts that agree pairwise but admit no global assignment — local consistency without global consistency, which is contextuality in the Abramsky–Brandenburger sense.

- Compute H¹ representatives; each nonzero class is a concrete obstruction with an identifiable cycle of contexts.
- **Contextual fraction:** what proportion of the data admits a globally consistent explanation. Bounded, comparable, and far more informative than a boolean.
- Surface as: _"These four notes are pairwise compatible. There is no way to read all four together."_ That sentence is the sharpest thing this plugin could say to a user, and no centrality measure gets near it.
- Distinguish clearly from β₁ in all UI copy — different object, different cause, different remedy.

**Acceptance:** the canonical pairwise-consistent / globally-inconsistent fixture (three contexts, cyclic disagreement) reports exactly one obstruction class and a contextual fraction below 1; a fully consistent vault reports zero and 1.0.

---

### HG-29 — Obstruction rendering

**Size:** M · **Deps:** HG-28, HG-16

Obstruction as a gap between fields that cannot glue — visually distinct from a hole, which is an absence of filler. Suggested treatment: fields that visibly fail to meet at a seam, rather than an empty region. Panel lists the participating contexts and where agreement breaks.

**Acceptance:** a vault with an obstruction but no β₁ hole, and a vault with a β₁ hole but no obstruction, look clearly different.

---

## Phase 8 — Persistence layer: persistence through time

Preventing the journey from being retrospectively rewritten or lost. Every transformation in Phase 3 destroys or overwrites something; without this layer the plugin quietly asserts that the current state was always the state.

### HG-30 — Append-only relation event log

**Size:** M · **Deps:** HG-02 · **Recommended: pull forward to Phase 3**

- `core/history.ts`: append-only log of relation lifecycle events — `encountered`, `created`, `promoted`, `relaxed`, `crystallized`, `dissolved`, `recurred` — each with timestamp, relation key, actor (user vs. inference), and prior state.
- Persisted in a managed vault file (append-only, never rewritten in place).
- **Subsumes HG-13's `occurrences[]`** — recurrence becomes a query over the log rather than a separate counter. If HG-30 lands first, HG-13 shrinks to a derived getter.
- Rule enforced by test: no code path mutates or deletes a logged event. Corrections are new events, not edits.

**Acceptance:** promote → relax → promote leaves three events and a reconstructible history; deleting the relation does not delete its history.

---

### HG-31 — Journey view and replay

**Size:** L · **Deps:** HG-30

- Panel section: this relation's history — when first encountered, when promoted, by what evidence, what it was before.
- Replay: scrub the vault's relational history over time. `core/filtration.ts` already implements scrubbing over a weight-ordered threshold; the same UI pattern applies to a time-ordered event sequence — reuse the interaction, not the data path.

**Acceptance:** scrubbing to a past timestamp reconstructs the relation set as of that moment.

---

### HG-32 — Consequence tracking

**Size:** M · **Deps:** HG-30, HG-10

Encounters have consequences: a crystallized concept descends from specific hyperedges; a promotion descends from specific evidence. Record lineage links so a note can answer "what did I come from?" and a hyperedge can answer "what did this produce?"

**Acceptance:** a crystallized note displays its originating encounter and that encounter displays its descendants, after a vault reload.

---

## Cross-cutting

### HG-22 — Settings

**Size:** S · **Deps:** Phase 2

`PluginSettings` additions: `showHyperedges`, `hyperedgeOpacity`, `enableHyperedgePulse`, `encounterRecurrenceThreshold`, `crystallizeFolder`, `enableDynamicsLab`, `activationDecayHalfLifeMinutes`. Defaults must keep existing vaults visually identical until a hyperedge exists.

### HG-23 — Test coverage

**Size:** M · **Deps:** all

Extend `tests/core.test.ts` (or split into `tests/hypergraph.test.ts`):

- **Invariant test:** no hyperedge ever appears in `model.simplices` — assert after every public mutation.
- Betti regression: hyperedges do not perturb β₀/β₁/β₂.
- Promote/relax round-trip, including the shared-face non-deletion case.
- Parser fixtures for both syntaxes and the merge fix from HG-04.
- Diagnostics against hand-computed fixtures.
- No-auto-promotion test (HG-10).

### HG-24 — Documentation

**Size:** S · **Deps:** all

`README.md` syntax reference for `◇`, the conceptual distinction (hyperedge = irreducible encounter; simplex = coherence inherited across subrelations), the four transformations, and the diagnostics glossary. `CHANGELOG.md` entry.

---

## Sequencing

```
Phase 1  HG-01 → HG-02 → HG-03           model foundation, unblocks all
Phase 2  HG-04 → HG-05 → HG-06           syntax + durability
Phase 3  HG-30 → HG-07 → HG-08 → HG-09   history first, then transformations
Phase 4  HG-11 → HG-12, HG-13, HG-14 → HG-15
Phase 5  HG-16 → HG-17 → HG-18
Phase 6  HG-19 → HG-20 → HG-21           dynamics; deferrable as a unit
Phase 7  HG-25 → HG-26 → HG-27 → HG-28 → HG-29    sheaf; needs core/linalg.ts
Phase 8  HG-31 → HG-32                   journey + consequences
Always   HG-22, HG-23, HG-24
```

Phases 6 and 7 are independent of each other and can run in either order. Phase 7 is the more distinctive of the two — synchronization dynamics have been done elsewhere; a contextuality readout over a personal knowledge base has not.

**Minimum coherent release (v0.4.0):** Phases 1–3 (including HG-30) plus HG-16, HG-22, HG-23, HG-24. That ships the distinction, the syntax, durable storage, the transformations with real history, and a visual difference — the point at which the model is honest even if the analysis is thin.

**v0.5.0 target:** Phase 4 + Phase 7. Diagnostics plus obstruction is the release where the plugin says something a graph view cannot.

---

## Open design decisions

These need a call before the phases they gate; each has a defensible default, noted.

1. **Should the inference engine emit hyperedges instead of simplices?** The engine currently synthesizes `Simplex` objects (`data/inference/engine.ts`) and therefore asserts closure it has no evidence for — by the document's own argument, inferred emergence belongs first to the hypergraph. Changing this is a significant behavioral shift for existing users. _Default: leave the engine as-is for v0.4.0, add a setting `inferenceEmits: "simplex" | "hyperedge"` defaulting to `simplex`, and revisit._ Gates nothing, but shapes HG-12.

2. **Does promotion retain the hyperedge?** _Default: yes_ (HG-08), since discarding it rewrites the history the Persistence layer is meant to protect. Cost: two relations over the same node set, which is exactly what HG-01's namespacing exists to support.

3. **Do hyperedges participate in filtration?** `core/filtration.ts` orders simplices by weight into topological events. Hyperedges have no boundary, so they cannot produce Betti events — but they could appear as a separate "encounter" track on the same timeline. _Default: excluded from filtration in v3; revisit with HG-21._

4. **Hyperedge order cap.** Simplices cap at `MAX_FACE_GEN_DIM = 4`. Hyperedges need no such cap structurally (no faces are generated), but rendering and diagnostics do degrade. _Default: no model cap, render cap at 8 members with a "large encounter" glyph, diagnostics cap per HG-11._

5. **What is a stalk, concretely?** HG-25 proposes role/label/sense per relation. Richer options exist (embedding vectors, tag sets, user-authored notes-on-the-relation), and the choice determines whether restriction maps are projections or something with real content. _Default: start with the discrete role set already in `data/inference/types.ts:NoteRole`, since it makes H⁰/H¹ computable over a small finite space and keeps HG-27's linear algebra tractable._ Gates HG-25.

6. **Where do contexts come from?** HG-26 makes them explicit and user-defined. The alternative is deriving them (folders, tag clusters, communities), which is less work for the user and much less meaningful — a derived cover mostly recovers the filing system, which is the same critique the v2 plan already made of folder-derived domains. _Default: explicit, with derived contexts as a convenience seed the user edits._

7. **Is `core/linalg.ts` worth it?** Phase 7's H⁰/H¹ needs real rank and kernel computation, which the codebase has deliberately avoided so far. A cheaper approximation — pairwise disagreement counting, no cohomology — would surface _some_ inconsistency without the machinery, but cannot distinguish "locally inconsistent" (easy, boring) from "locally consistent yet globally impossible" (the interesting case, and the whole point). _Default: build the linear algebra; the cheap version does not answer the question that motivated the layer._
