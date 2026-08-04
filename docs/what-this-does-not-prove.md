# What this does not prove

The mathematics in this plugin is real and the implementation is tested against it. That makes it easy to over-read. This document is the list of things the numbers do **not** establish, and it is the companion to [How topology is computed](./how-topology-is-computed.md).

## A gap is not a missing idea

A persistent 1-dimensional class means some notes form a loop that nothing in your vault fills. It does not mean a synthesis is missing, that you should write one, or that the connection would be valuable. The plugin says "consider writing a synthesis that explains whether the loop should remain open or be filled" — and an open loop is frequently the correct state of the world. Some things genuinely do not close.

## A representative cycle is not _the_ cycle

Every witness is one valid representative of its class. It is:

- **not canonical** — another valid reduction of exactly the same data returns a different chain for the same class;
- **not minimal** — no shortest-homologous-cycle claim is made, and shortest-cycle computation is deferred work;
- **dependent on the tie policy** — where filtration values are equal, which simplex the reduction reached first affects which witness comes back.

The class is well defined. The chain shown is a witness to it, not an identity for it.

## Bootstrap support is not a confidence interval

Empirical stability resamples your vault under a stated scheme and reports how often a feature reappeared. The stability theorem bounds how far a diagram can move when the filtering function moves; it does **not** supply a coverage probability, and none is claimed. "Reappeared in 86% of subsamples" is a statement about that sampling scheme with that seed and that many samples. It is not a p-value, and it is not a 95% interval.

Subsampling and weight perturbation answer different questions — "does this survive seeing fewer notes" and "does this survive the scores being slightly wrong" — and their numbers are not comparable.

## Birth and death are not dates

They are positions in the filtration, which is derived from relation strength. A class that "dies at 0.6" was filled by a relation whose evidence score is 0.4. Nothing here is a timeline. Relation _history_ is a separate, append-only feature and is the thing that knows about time.

## Betti numbers are not importance

β₁ = 7 means the rank of the first homology group is 7. It does not rank your vault against anyone else's, measure quality, or indicate that seven specific things are wrong.

## Inferred relations are guesses

A cycle assembled largely from relations the plugin inferred is evidence about the plugin's inference settings as much as about your notes. Every ranked prompt reports what fraction of its witness was inferred rather than authored, and that number is worth reading first.

## An encounter is not a set of pairs

A `◇` hyperedge asserts that some notes meant something _together_. It makes no claim about any pair or subgroup within it, generates no faces, and contributes nothing to any topological result. This is a structural guarantee, not a default that can drift.

## The obstruction rank is not H¹

The Contextuality Lab reports the rank of non-closing holonomy vectors. That is an obstruction rank. Constructing actual sheaf cohomology requires a cochain complex and a quotient, which do not yet exist in this codebase, so no H¹ is claimed. Local disagreement between two contexts is likewise _not_ contextuality in the Abramsky–Brandenburger sense, and the interface says so where it could be misread.

## The score is not a verdict

Ranked prompts are ordered by a sum of disclosed terms — lifetime, support, cross-domain diversity, compactness, recurrence, minus penalties for inferred relations and witness size. The breakdown is shown because the ranking is a heuristic over quantities the plugin can measure, not a judgement about meaning. Reorder it, ignore it, or disagree with it.

## Nothing here is written to your notes

Topology is derived and cached in memory. No Betti number, bar, witness, or ranking is ever serialized into a note.
