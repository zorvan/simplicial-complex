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
