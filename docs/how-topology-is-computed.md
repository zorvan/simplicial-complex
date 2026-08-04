# How topology is computed

This describes exactly what the plugin does to produce the numbers it shows, so that any claim on screen can be traced back to an algorithm and a theorem. The companion document, [What this does not prove](./what-this-does-not-prove.md), is the other half and is not optional reading.

## 1. What enters the computation

Only the **simplicial** layer. A hyperedge — an encounter recorded with `◇` — asserts nothing about its subgroups, so it never enters a boundary matrix. Adding encounters to a vault leaves every Betti number and every bar unchanged. A hyperedge contributes only if you explicitly promote it to a simplex, which is a deliberate action with a dialog listing the faces it will assert.

Vertices are the notes. Simplices are the confirmed and inferred relations, plus the faces auto-generated to keep the complex downward closed.

## 2. The filtration

Each relation carries a score in `[0, 1]` — its weight, confidence, or decayed weight, whichever metric is selected. The filtration value is `1 - score`, so **stronger evidence enters earlier**. Notes themselves enter at 0: every note exists from the start, and relations accumulate.

A filtration is only usable if every sublevel set is a complex, which requires `f(face) ≤ f(coface)`. Where a relation was weighted below one of its own faces, the plugin **delays the coface** rather than advancing the face — advancing would invent evidence you never supplied. Every such repair is listed in the Persistence X-ray under "filtration values were delayed to keep faces first".

Simplices are then placed in one total order, sorted by value, then dimension, then key. Equal values are broken by dimension, which guarantees a face precedes a tied coface. That tie rule is a policy, versioned as `filtration-order-v1`, and it is part of the analysis cache key because changing it changes pairings.

## 3. Static homology

β_k is computed by rank-nullity over F₂:

```
β_k = dim C_k − rank ∂_k − rank ∂_{k+1}
```

Boundary matrices are sparse F₂ columns; ranks come from pivot-based column reduction. The analyzed skeleton includes the (k+1)-simplices, because their boundary rank is what determines H_k.

A slow, obviously-correct dense implementation (`NaiveTopologyChecker`) exists purely as an independent oracle in tests. It is not reachable from any production path.

## 4. Persistence

The filtered boundary matrix D is reduced left to right until no two columns share a lowest nonzero row, yielding `R = DV`:

- a column that reduces to **zero** creates a class — a birth;
- a column whose lowest entry is row `i` **kills** the class born at simplex `i` — a death;
- a birth never paired is **essential** and reported with `death: null`.

This is the matrix-reduction pairing theorem. The pairing is independent of the reduction's choices, even though `R` and `V` are not. It is **not** Smith normal form: the filtration order carries the information and must not be permuted.

Zero-length bars — born and killed at the same threshold — are retained internally for verification and hidden by default, because they describe the tie policy rather than the vault.

## 5. Representative cycles

When column `j` reduces to zero, `D·V_j = 0`, so the chain `V_j` is a cycle; `V` is unitriangular, so `V_j` contains simplex `j` and the cycle is born exactly when `j` enters. That chain is the witness.

Every returned witness is verified here, not assumed: ∂z is recomputed over F₂ and must be empty, and for a finite bar the death column's lowest entry must be the birth column. A chain that fails either check is withheld and counted, never displayed.

Witness tracking roughly doubles peak memory, so it is a request-level choice rather than a default.

## 6. Empirical stability

Off by default. When enabled, the whole analysis is re-run on seeded resamples and each resulting diagram is matched to the full diagram by **bottleneck matching** — finite classes with the diagonal available, essential classes paired among themselves in birth order, since an essential class cannot be discarded onto a diagonal.

Reported: support frequency, birth and death quantiles, unmatched rate, sample count, seed, and the sampling scheme in words. Subsampling and weight perturbation are different questions and never share a label.

## 7. Where it runs

The reduction runs in a Web Worker. Obsidian installs only `main.js`, `styles.css` and `manifest.json`, so the worker is compiled separately, inlined into the bundle as a string, and started from a Blob URL — there is no second file to lose. If no worker can start, the same engine runs on the main thread and the view says so.

Cancellation is cooperative: the reduction returns to the event loop between column batches, so a `cancel` message can actually be delivered mid-run and superseding a request does not destroy the worker. Polling a flag alone would not be enough — a worker has one thread, and while a synchronous loop runs, no message can be dequeued for it to observe. Yielding is gated on elapsed time, so a reduction that finishes in a few milliseconds never yields at all.

Terminating and restarting is the fallback for a hang, and it costs a startup plus a cold first request.

Results are cached in memory against model revision, metric, dimension, coefficient field, tie policy and uncertainty configuration. **Nothing is written to your notes.**

## 8. Limits

Ceilings on simplex count and on live column entries are sized for mobile, which is the tighter platform and stays supported. Beyond them the analysis reports what it could not do, with the phase and input size, rather than freezing.

## References

- Hatcher, _Algebraic Topology_, §2.1 — simplicial homology, ∂∂ = 0, rank-nullity.
- Edelsbrunner, Letscher and Zomorodian, _Topological Persistence and Simplification_.
- Zomorodian and Carlsson, _Computing Persistent Homology_.
- Cohen-Steiner, Edelsbrunner and Harer, _Stability of Persistence Diagrams_.
- Edelsbrunner and Harer, _Computational Topology_, Ch. VII — filtrations.
- Abramsky and Brandenburger, _The Sheaf-Theoretic Structure of Non-Locality and Contextuality_ — the terminology boundary the Contextuality Lab respects.
