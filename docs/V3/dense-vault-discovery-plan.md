# Dense-vault knowledge discovery plan

**Status:** Proposed  
**Prepared:** 2026-08-03  
**Starting point:** v0.4.0  
**Target releases:** 0.4.6 (DV-0x–DV-2x), 0.5.x (DV-3x), 0.6.0+ (DV-4x, DV-5x) — see [Release placement](#release-placement)  
**Sibling plan:** [`v0.4.5-v0.5.0-implementation-plan.md`](./v0.4.5-v0.5.0-implementation-plan.md) — mathematical correctness and persistent topology. That plan's §13 holds the combined ordering; this document must not contradict it.  
**Mathematical contract:** [`Reframe-stop-computing-numbers-start-revealing-shape.md`](./Reframe-stop-computing-numbers-start-revealing-shape.md)

## Purpose

Large vaults currently place notes, links, simplices, inferred clusters, and hyperedges into one global force field. The result is dense overlap, slow simulation, and ambiguous proximity. Increasing repulsion or reducing gravity changes the appearance but does not solve the information problem.

The primary product goal is not to display every relation at once or teach the user mathematics. It is to help a user understand their ideas, how those ideas depend on context, where they agree or conflict, and what is worth examining next. The mathematical layer must make discoveries more rigorous and inspectable without becoming the main interface.

> Reduce overlap by selecting the right question, context, and scale—not by spreading every object farther apart.

## Scale this plan designs for

"Large vault" is not a feeling. The target sizes, which every budget and layout decision below must hold at:

| Tier    | Notes   | Expectation                                                                                                                           |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Small   | ≤ 500   | Everything current works; the existing 500-node benchmark budgets apply unchanged.                                                    |
| Common  | 2 000   | Full discovery workflow interactive, no degraded mode.                                                                                |
| Large   | 10 000  | Primary target of this plan. Overview and focused projections interactive; whole-vault operations may be incremental or backgrounded. |
| Extreme | 50 000+ | Must not crash or hang. Degraded modes and honest limits are acceptable; silent truncation is not.                                    |

10 000 notes is an ordinary Obsidian vault, not an edge case. Designing for it is what decides whether cached deterministic layout suffices or whether the projection service needs incremental recomputation.

Existing mitigations to build on rather than rediscover: `render/renderer.ts` already performs viewport culling and progressive node rendering, and `layout/engine.ts` already uses a Barnes-Hut quadtree. The dense-overlap problem is an information problem, as stated above — but the plan should not describe the renderer as though nothing has been done.

## Product principles

1. **Question before projection.** A view begins from a note, context, theme, time range, or discovery question rather than the entire vault.
2. **Stable orientation.** Primary maps keep durable positions. Continuous force motion is optional and never the only way to navigate.
3. **Progressive disclosure.** Overview views show themes and bridges; details appear through selection, expansion, and zoom.
4. **Distinct relations remain distinct.** Links, simplices, hyperedges, and context overlaps must not be flattened into interchangeable lines.
5. **Evidence before assertion.** Every inferred discovery identifies its supporting notes, relation type, confidence, and inference provenance.
6. **Mathematics remains inspectable.** A theorem-derived result exposes its mathematical object, assumptions, computation, and witness in an optional formal explanation.
7. **The user remains authoritative.** Suggestions do not silently become authored relations, contexts, or interpretations.

## Target experience

The default large-vault experience is a discovery workspace rather than a fully expanded graph.

It should answer questions such as:

- What themes are developing in my vault?
- Which idea connects otherwise separate areas?
- Where does the same concept play different roles?
- Which local perspectives can be combined?
- Which locally coherent perspectives resist a global interpretation?
- Which gaps or unresolved loops persist under stricter evidence?
- What changed in my thinking during a selected period?
- What should I inspect, clarify, or write next, and why?

The workspace presents a small ranked set of discovery cards. Opening a card produces a focused local projection containing only the necessary contexts, notes, relations, and witnesses.

## Cold start

The largest product risk in this plan is that its primary surface depends on data most users do not have.

Contexts are authored in the Contextuality Lab and stored through `data/sheaf-store.ts`. A user who installs the plugin, points it at a 10 000-note vault, and opens the discovery workspace has **zero** contexts, so a context-map-first design shows them an empty screen at exactly the moment the plugin has to prove itself.

The resolution has three parts, and all three are requirements, not options:

1. **The discovery inbox is the default surface, not the context map.** Discovery cards can be produced from links, simplices, hyperedges, folders, tags, and time alone. They do not require authored contexts, so the workspace is useful on first open.
2. **Candidate contexts are offered, never assumed.** On first scan, derive candidate contexts from folders, tags, and MOC structure using the existing `deriveContext` and `suggestDerivedContexts` paths. Present them as clearly provisional — visually distinct, labeled with their derivation, and dismissable in one action. They are an invitation to author, not a claim about the vault.
3. **The context map earns its place as contexts accumulate.** It becomes the recommended entry point once the vault has authored contexts covering a stated fraction of active notes; before that it stays available but is not the default.

A related trap: a user with three contexts and 10 000 notes has a context map that is technically stable and practically useless. Overview quality depends on coverage, so the workspace must say what fraction of the vault the visible contexts actually account for rather than implying the map is the whole picture.

## Information architecture

Use a multilevel navigation model:

```text
Vault
└── theme or domain
    └── context
        └── relation or discovery
            └── note and source evidence
```

These levels are projections, not a claim that knowledge has one permanent hierarchy. A note may belong to several contexts and a context may participate in several themes.

### Overview level

Show themes or context groups as stable aggregate objects. Display only important bridges, unresolved tensions, and recent change. Do not render individual labels, simplex faces, or ordinary links.

### Context level

Show a selected context and its immediate overlaps. Summarize internal relations and reveal the concepts whose roles differ across neighboring contexts.

### Local investigation level

Show the notes and higher-order relations needed to inspect one discovery. Include source paths, relation provenance, local interpretations, and counter-evidence.

### Formal explanation level

Optionally expose the mathematical object and witness: a representative cycle, failed gluing assignment, obstruction cocycle, persistent interval, incidence pattern, or other reproducible result.

## Relation display policy

Dense overlap is reduced first by deciding what each relation means and when it deserves screen space.

| Structure        | Meaning                                 | Overview representation                 | Focused representation                                |
| ---------------- | --------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Link             | Pairwise evidence or authored reference | Usually suppressed or summarized        | One edge with reason and direction                    |
| Simplex          | Coherence supported across proper faces | Aggregate coherence badge or region     | Members, supported faces, and provenance              |
| Hyperedge        | Irreducible group encounter             | Encounter count or pulse marker         | One relation object connected to participants         |
| Context overlap  | Concepts shared between local readings  | Bridge between context summaries        | Shared concepts and restriction/translation evidence  |
| Inferred cluster | Candidate grouping, not a vault fact    | Suggestion card only when highly ranked | Candidate members, score components, and alternatives |

Auto-generated simplex faces must not create duplicate visual or layout importance when the parent simplex already communicates the same structure. Hidden or filtered relations must not continue affecting a focused layout.

## Contextuality and sheaf role

Contextuality is a central interpretive framework for the discovery experience. Sheaf and cohomological machinery belongs in the formal diagnostic layer.

The workflow is:

```text
Vault evidence
    ↓
Contexts and overlaps
    ↓
Local interpretations
    ↓
Compatibility checks
    ↓
Gluing attempts
    ↓
Obstruction analysis
    ↓
Human explanation and possible refinement
```

The interface should distinguish carefully among:

- ordinary disagreement on an overlap;
- missing or insufficient local information;
- a mismatch repairable by revising one assignment;
- several valid global interpretations;
- a structural obstruction to a global interpretation.

User-facing language should describe the discovery—for example, “this term plays incompatible roles in these contexts.” Terms such as `H¹`, cocycle, or contextual fraction belong in the optional formal explanation. The implementation must follow the mathematical-contract requirements in `Reframe-stop-computing-numbers-start-revealing-shape.md`; a heuristic mismatch must never be labeled as sheaf cohomology.

Note that `core/sheaf.ts` currently reports `h1` as the rank of a holonomy matrix, with no cochain complex behind it. The sibling plan's MC-05 renames that to an obstruction rank. Until MC-05 lands, no view described here may present the existing number under a cohomological name — including in a formal-explanation panel, where the label would be most believed.

## Primary views

### 1. Discovery inbox

**The default surface**, for the reasons in [Cold start](#cold-start). A ranked, refreshable list of findings rather than a graph of everything. Initial card types:

- unexpected bridge;
- context-dependent role;
- unresolved local disagreement;
- candidate gluing obstruction;
- persistent conceptual gap;
- emerging or declining theme;
- neglected but structurally important note;
- possible missing intermediate concept.

Each card contains:

- a one-sentence claim;
- why it was surfaced;
- the smallest useful set of supporting notes and contexts;
- authored versus inferred status;
- uncertainty or competing interpretation;
- one action: inspect, compare, refine, dismiss, or save.

### 2. Context map

A stable map of contexts and their overlaps. Context size represents visible scope, not an absolute claim of importance. Bridges represent shared concepts or validated translation maps, not every underlying note link. Subject to the coverage disclosure in [Cold start](#cold-start).

### 3. Focused evidence map

A small local graph opened from a discovery card. It may use a short-lived local simulation, deterministic layout, or incidence layout because its scope is bounded. It never silently expands to the whole vault.

**This view is the proposed primary canvas.** That has a consequence outside this document: the sibling plan's PH-05 brush-links persistence bars to a highlighted representative cycle _on a canvas_, and today that canvas is the full-vault force view this plan demotes. The decision must be recorded before PH-05 begins (sibling §13.2). If the focused evidence map wins, PH-05 links into it, and a representative cycle that escapes the current projection becomes an explicit "expand to show the full witness" action rather than a silent full-vault expansion.

### 4. Development timeline

Show when contexts, encounters, and interpretations appeared or changed. This prevents the current state from overwriting the journey and helps distinguish contradiction from development through time.

### 5. Formal inspector

Show the reproducible witness and hypotheses behind a discovery. This view serves advanced users, debugging, and mathematical development without burdening ordinary navigation.

## Layout strategy

The first release does not require a new global physical field.

Use deterministic or cached layouts for overview and context maps:

- aggregate contexts before positioning;
- allocate non-overlapping regions based on visible content;
- position shared concepts near relevant boundaries;
- preserve positions between sessions and incremental scans;
- move existing objects only when necessary;
- provide pan, zoom, fit-all, fit-selection, and reset;
- keep labels and hit targets in screen space while geometry lives in world space.

If a force layout remains available, constrain it to a selected context or discovery neighborhood. The current full-vault force canvas becomes an optional expressive/experimental view.

### Where cached positions live

"Preserve positions between sessions" needs a named store, because the obvious one is wrong.

The only position persistence today is `settings.pinnedNodes`, restored and captured in `main.ts` and written into the plugin's `data.json`. That file is read and rewritten wholesale, is synced between devices, and is loaded on every plugin start. Putting cached positions for thousands of notes and contexts there would inflate startup, produce large sync churn on every pan, and risk data loss on a partial write.

Requirements for the layout cache:

- store it as a **separate file under the plugin directory**, not in `data.json`, and never in the vault's note tree;
- key entries by stable node/context identity so a rename does not orphan a position, and prune entries whose target no longer exists on scan;
- cap total size explicitly and evict least-recently-viewed regions when the cap is reached — an unbounded cache is a slow leak;
- treat the cache as disposable: a missing, corrupt, or version-mismatched cache degrades to a fresh deterministic layout without an error dialog;
- keep `settings.pinnedNodes` as it is. User pinning is authored intent and belongs in settings; cached positions are derived data and do not.

## Ranking and explanation contract

Discovery ranking may combine:

- user-selected question or active note;
- structural relevance;
- contextual disagreement or gluing status;
- persistence across evidence thresholds;
- recency and temporal change;
- surprise relative to existing themes;
- confidence and evidence diversity;
- prior user dismissal or confirmation.

Ranking is not itself proof. Every result must include a typed explanation record.

**This record is shared with the sibling plan.** Its ticket PH-08 ("ranked gaps to write") produces the same object under a different name — a claim, its evidence, its provenance, its uncertainty, one suggested action. There is one type, and persistent-homology results are one `DiscoveryKind` within it, carrying their interval and witness through `witnessRef` and their lifetime and bootstrap support through `scoreComponents`. Whichever plan implements it first owns the definition; the other conforms without forking it.

```ts
interface DiscoveryExplanation {
  claim: string;
  kind: DiscoveryKind;
  evidencePaths: string[];
  contextIds: string[];
  authoredInputs: string[];
  inferredInputs: string[];
  scoreComponents: Record<string, number>;
  uncertainty: string[];
  witnessRef?: string;
  suggestedAction: "inspect" | "compare" | "refine" | "write" | "dismiss";
}
```

The exact type can evolve, but claim, evidence, provenance, uncertainty, and action are required.

## Implementation phases

Each ticket names its files so it can be scheduled against the sibling plan's MC/PH tickets, which touch several of the same modules.

### DV-00 — establish observability and baselines

**Files:** `scripts/dense-vault-benchmark.mjs` (new), `fixtures/dense-vault/` (new), `core/diagnostics.ts`, `docs/V3/hypergraph-verification.md`

1. **Extend the existing benchmark harness, do not start a second one.** `scripts/hypergraph-benchmark.mjs`, `fixtures/hypergraph-v3`, and the deterministic 500-node budgets shipped in v0.4.0 already exist and are documented in `hypergraph-verification.md`. Add the larger tiers and the density metrics there.
2. Add generated fixtures at the 2 000, 10 000, and 50 000-note tiers with overlapping links, simplices, hyperedges, inferred clusters, and contexts. Generation must be seeded and reproducible.
3. Record scan time, render time, layout frame cost, visible object count, and interaction latency per tier.
4. Add counters showing how many objects are loaded, eligible, visible, aggregated, and filtered.
5. Verify that display filters and layout inputs are separate and explicit — and record which currently are not, since hidden relations influencing layout is an existing defect this plan depends on fixing.

**Exit criterion:** one benchmark command reproduces every tier and reports performance plus visible-density metrics, with the numbers written into the verification document alongside the existing evidence.

### DV-01 — focused projections

**Files:** `core/projection/spec.ts` (new), `core/projection/service.ts` (new), `core/model.ts`, `layout/engine.ts`, `render/renderer.ts`, `ui/view.ts`

1. Introduce a `ProjectionSpec` describing seeds, context scope, depth, time range, relation kinds, confidence threshold, and object budget.
2. Build a projection service that returns a bounded view model without mutating the underlying complex or hypergraph.
3. Add entry points for active-note neighborhood, selected context, selected discovery, and explicit note selection.
4. Ensure filtered and auto-generated structures do not influence the local layout unless included by the projection.
5. Add an object-budget fallback that aggregates before dropping evidence.

**Default object budget: 300 visible objects, 600 hard ceiling.** This is a design decision, not a measurement outcome — a budget deferred to benchmarking leaves this ticket ungateable, and "predictable maximum" without a number is not predictable. Revise it against DV-00 evidence if the evidence disagrees; do not start without it.

**Exit criterion:** at the 10 000-note tier, opening a projection never exceeds the hard ceiling, never starts a full-vault simulation, and reports its aggregation decisions in the counters from DV-00.

### DV-02 — stable context overview

**Files:** `core/projection/context-graph.ts` (new), `layout/deterministic.ts` (new), `layout/position-cache.ts` (new), `data/sheaf-store.ts`, `ui/view.ts`

1. Reuse authored Contextuality Lab contexts first; use folder or semantic groups only as clearly labeled candidates, per [Cold start](#cold-start).
2. Build a context-overlap graph with shared concepts and provenance.
3. Add deterministic placement, cached positions, collision-free aggregate regions, pan/zoom, fit-all, and fit-selection. Positions live in the store defined in [Where cached positions live](#where-cached-positions-live).
4. Expand one context in place while keeping surrounding contexts stable.
5. Represent cross-context notes as bridges without duplicating their identity in the data model.
6. Display context coverage — what fraction of active notes the visible contexts account for.

**Exit criterion:** reopening or rescanning the same vault preserves orientation; expanding one context does not reorganize the entire map; and a deleted, corrupt, or version-mismatched position cache degrades silently to a fresh deterministic layout.

### DV-03 — discovery inbox and explanations

**Files:** `data/discovery/types.ts` (new), `data/discovery/engine.ts` (new), `data/discovery/rules/` (new), `data/explainer.ts`, `ui/panel.ts`, `ui/discovery-view.ts` (new)

1. Define the discovery record and explanation contract, shared with the sibling plan's PH-08.
2. Implement a small initial set: bridges, contextual role changes, unresolved overlap mismatches, and neglected structural notes.
3. Rank within each discovery kind before attempting one universal score.
4. Provide evidence inspection, dismissal, confirmation, and “not useful” feedback.
5. Keep inferred discoveries separate from authored vault state.
6. **Decide the relationship to the existing suggestion surface.** `data/explainer.ts` and `ui/panel.ts` already produce explained suggestions. The inbox either replaces that surface or wraps it; running both leaves two ranked lists with different provenance formats competing for the user's attention. Record the decision before building, and before PH-08 adds a third.

**Exit criteria — both required:**

- _Traceability:_ every displayed card can be traced to source paths and reconstructed deterministically from a model revision.
- _Usefulness:_ precision@5 on the labeled evaluation fixture meets the threshold in [Evaluating discovery quality](#evaluating-discovery-quality).

Traceability alone is not enough. A deterministic, fully-provenanced, useless inbox passes a traceability gate, and the entire product thesis is that the ranking is worth reading.

### DV-04 — rigorous contextual diagnostics

**Files:** `core/sheaf.ts`, `ui/sheaf-view.ts`, `render/components/obstructions.ts`, `data/discovery/rules/`

**Blocked on:** the sibling plan's MC-05 (terminology correction) and the 0.6.0 cellular-sheaf formalization. No contextuality-labelled UI copy ships before both. This is a hard dependency, not a preference — the whole point of the terminology work is that it precedes the interface built on top of it.

1. Complete the formalization described in the repository’s mathematical roadmap before using cohomological labels.
2. Separate local inconsistency, gluing failure, and a genuine cohomological obstruction in types and UI copy.
3. Store inspectable assignments, restriction results, and obstruction witnesses.
4. Suggest minimal refinements: clarify a role, split an overloaded concept, distinguish time periods, or revise a context boundary.
5. Require user confirmation before persisting any refinement.

**Exit criterion:** canonical compatible, inconsistent, and obstructed fixtures produce distinct results, and every obstruction shown to the user has an inspectable witness.

### DV-05 — multiscale mathematical discovery

**Files:** `data/discovery/rules/`, `core/topology/` (consumer only), `ui/discovery-view.ts`

**Blocked on:** the sibling plan's PH-01 through PH-04. This ticket consumes persistence results; it must not compute topology independently, and it must not reinterpret an interval the reducer already paired.

1. Integrate persistent homology only after the boundary and filtration contract is correct.
2. Use Mapper or another aggregate construction for question-specific summaries rather than as a decorative full-vault layout.
3. Add temporal comparison for emerging, merging, splitting, and declining themes.
4. Cross-check discoveries from independent methods where possible; agreement increases confidence but does not erase provenance.
5. Generate writing or reflection prompts only from findings that meet explicit evidence and uncertainty thresholds.

**Exit criterion:** theorem-derived discoveries expose hypotheses and witnesses, and their user-facing explanations remain useful without mathematical terminology.

### DV-06 — optional local spatial experiments

After the discovery workflow is useful, evaluate alternative layouts for bounded projections:

- incidence layouts for hyperedges;
- packed local context regions;
- diffusion embeddings for scale-dependent structural distance;
- semantic embeddings with cached, stable placement — subject to the constraint in [Non-functional constraints](#non-functional-constraints);
- local force relaxation after deterministic initialization.

Do not reintroduce a single global simulation as a dependency of the primary experience.

**Exit criterion:** each experiment is compared using task completion, stability, latency, and explanation quality—not visual appeal alone.

## Evaluating discovery quality

Every exit criterion in DV-03 that concerns provenance can be met by a system that surfaces nothing worth reading. The ranking needs an offline measure that exists before release, not user studies afterward.

1. Build `fixtures/discovery-eval/` — a hand-authored vault, small enough to reason about completely, containing planted structure: a genuine bridge between two areas, a concept that genuinely changes role across two contexts, a genuine unresolved overlap, and a deliberately neglected structurally-important note. Record the expected findings as labels.
2. Include **negative controls**: plausible-looking structure that should _not_ surface — coincidental co-occurrence, a shared stopword-heavy title, two notes in one folder with nothing else in common.
3. Gate on **precision@5 ≥ 0.6 and recall of planted findings ≥ 0.8** for the initial card set. Adjust the numbers once there is evidence; do not ship without numbers.
4. Track dismissal rate per discovery kind in the shipped product, and treat a kind whose dismissal rate stays high as a candidate for removal. A card type nobody acts on costs attention on every open.
5. Re-run the evaluation on every ranking change. Ranking regressions are silent otherwise — nothing crashes when the inbox gets worse.

## Non-functional constraints

1. **No network access.** The plugin performs no outbound requests. This binds DV-06's "semantic embeddings" in particular: any embedding must be computed locally from vault content, or the feature does not ship. A knowledge tool that quietly sends note content to a third party violates what users assume about a local-first vault, regardless of the quality of the resulting layout.
2. **No note mutation from inferred results.** Discoveries, projections, and cached positions never write to notes. Authored relations change notes; inferences do not.
3. **Platform parity.** `manifest.json` declares `"isDesktopOnly": false`. Every view in this plan is therefore a mobile view until that declaration changes. Budgets are set from the lowest supported platform, and the decision to drop mobile — if made — belongs to the sibling plan's §4.4 and is made once, for both plans.
4. **Degrade honestly.** At the extreme tier, or when a budget is exceeded, the interface says what it limited and why. Silent truncation of evidence is the failure mode this entire plan exists to prevent.

## Storage, settings, and migration

1. Add new settings through merged defaults; change no existing key's meaning.
2. The layout position cache is a separate plugin-directory file with its own schema version, not part of `data.json` and not part of settings. A version mismatch discards the cache.
3. Discovery dismissals and confirmations are user decisions and _are_ persisted — in settings or an adjacent store — keyed so that a re-scan does not resurrect a dismissed card. Losing them silently teaches users to stop dismissing.
4. Cached projections and discovery results are derived data: keyed by model revision plus `ProjectionSpec`, never serialized into the vault, and safe to discard at any time.
5. No note-syntax change in any ticket in this plan.

## Release placement

| Release | Tickets             | Rationale                                                                                      |
| ------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| 0.4.5   | — (sibling plan)    | Mathematical correctness lands first; this plan builds interface on top of corrected meanings. |
| 0.4.6   | DV-00, DV-01, DV-02 | Independent of all topology work, and the largest visible improvement per unit of effort.      |
| 0.5.0   | — (sibling plan)    | Persistent topology, worker execution.                                                         |
| 0.5.x   | DV-03               | The inbox, emitting the shared explanation record that PH-08 also uses.                        |
| 0.6.0+  | DV-04, DV-05, DV-06 | Gated on the sheaf formalization and on persistence respectively.                              |

DV-00 through DV-02 are genuinely independent of the sibling plan and can proceed in parallel with 0.4.5 if capacity allows, provided they do not touch `core/filtration.ts`, `core/betti.ts`, or `core/sheaf.ts` — all of which are being rewritten there. The full shared-surface list is in the sibling plan's §13.2.

## Release gate for 0.4.6 (DV-00 – DV-02)

- `npm run verify` passes;
- the dense-vault benchmark reports every tier, with budgets recorded;
- a 10 000-note fixture opens the workspace within the DV-00 interaction-latency budget;
- no projection exceeds its object ceiling, and every aggregation is reported in the counters;
- reopening a vault preserves orientation; a discarded position cache degrades without an error;
- hidden and filtered relations provably do not influence projected layouts;
- context coverage is displayed wherever a context map implies completeness;
- no inferred structure has been written into a note.

## Performance budgets

Set exact budgets from DV-00 measurements, against the tiers in [Scale this plan designs for](#scale-this-plan-designs-for). Enforce these architectural limits immediately, without waiting for a number:

- no per-frame work proportional to every possible node pair;
- no full-vault simulation required to open the main view;
- bounded visible objects in focused projections;
- expensive topology and sheaf computations off the render loop;
- cached results keyed by model revision, settings, and projection specification;
- cancellable background work after vault or query changes;
- incremental recomputation where the mathematical dependency permits it.

## Success measures

Visual density alone is not the product metric. Evaluate whether users can:

- find the evidence behind a discovery;
- explain why two ideas were related;
- distinguish an encounter from supported simplicial coherence;
- recognize when a concept changes role across contexts;
- identify whether a tension is local, temporal, or structural;
- return to the same conceptual region without relearning the map;
- dismiss an unhelpful inference without altering authored knowledge;
- reach a useful note or question faster than through search alone.

Operational metrics include initial interaction latency, projection construction time, layout stability, maximum visible-object count, cache hit rate, and discovery confirmation/dismissal rates.

These are the measures that matter, and none of them can be checked before release. That is what [Evaluating discovery quality](#evaluating-discovery-quality) exists for: a labeled fixture is the pre-release proxy for the questions above, and it is the only one available while the product is still being built.

## Non-goals

- Displaying the entire vault at full detail by default.
- Finding one universal two-dimensional arrangement of all knowledge.
- Treating semantic similarity as proof of a relation or encounter.
- Calling ordinary disagreement “contextuality.”
- Presenting a heuristic inconsistency score as sheaf cohomology.
- Automatically promoting encounters, clusters, or discoveries into authored simplices.
- Hiding uncertainty behind a single confidence number.
- Teaching mathematical terminology before giving the user an actionable interpretation.

## Recommended first milestone

Build **focused projections plus a stable context overview** (DV-00, DV-01, DV-02 — release 0.4.6) before adding new global layout physics.

The milestone should let a user:

1. open a vault with no authored contexts and still get something worth reading, with candidate contexts offered as provisional;
2. open a vault with authored contexts into a stable overview of them, and see what fraction of the vault those contexts cover;
3. select a context, note, or bridge;
4. receive a bounded evidence map within a stated object budget;
5. understand why each visible relation is present;
6. compare local interpretations across an overlap;
7. return to the overview without losing spatial orientation.

Step 1 is not optional polish. A milestone that only works on a vault someone has already curated demonstrates nothing about the problem this plan opens with — a large vault that has never been organized is the case that motivated the work.

This directly resolves dense overlap while establishing the interface needed for later contextuality, sheaf-cohomology, persistence, and other theorem-backed discoveries.
