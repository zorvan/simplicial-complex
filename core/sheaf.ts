import { add, frac, rank, subtract, type Fraction, type Matrix } from "./linalg.js";
import type { SimplicialModel } from "./model.js";
import { relationKey } from "./normalize.js";
import type { NodeID, RelationKey } from "./types.js";

/**
 * The sheaf layer.
 *
 * The hypergraph asks who was together. The simplicial complex asks whether that
 * togetherness is compositional. Neither asks whether a note means the same thing
 * in each context it appears in — and until now the plugin could not, because
 * `extractRole()` gives every note exactly one role for the whole vault.
 *
 * A sheaf replaces that global assignment with a local one, and then asks whether
 * the local assignments glue.
 *
 * **The reading is relative, and that is the whole point.** A context tells you how
 * the notes inside it stand to one another — this one is the reference, that one is
 * the project — not what they are absolutely. So a context's section is only ever
 * observed up to the context's own baseline. Two contexts overlapping in a single
 * note are therefore *always* pairwise compatible: one shift reconciles them. It
 * takes a cycle of contexts for compatibility to fail, and that failure is
 * contextuality in the Abramsky–Brandenburger sense: local consistency everywhere,
 * global consistency nowhere.
 *
 * If every context assigns a note the same role — the degenerate case, and exactly
 * what backfilling from `extractRole` produces — every measure here reports zero
 * obstruction. Current behaviour is the trivial case of the new one.
 */

/**
 * The stalk alphabet. Deliberately the small discrete role set the inference layer
 * already uses: it keeps the baseline and obstruction diagnostics finite, and a richer
 * stalk (embeddings, tag sets, notes-on-the-relation) can replace it without
 * changing anything below.
 */
export const SHEAF_ROLES = ["action", "project", "research", "idea", "creative", "reference"] as const;
export type SheafRole = (typeof SHEAF_ROLES)[number];

export type ContextSource = "folder" | "tag" | "query" | "moc" | "manual";

export interface SheafContext {
  id: string;
  name: string;
  source: ContextSource;
  /** Folder path, tag, query string or MOC note path, depending on `source`. */
  definition: string;
  /** Namespaced relation keys this context covers. */
  relations: RelationKey[];
}

/**
 * What a context says about a note. Absent means the context has no reading of it,
 * which is different from the context saying "reference".
 */
export type LocalSection = Map<NodeID, SheafRole>;

export interface SheafData {
  contexts: SheafContext[];
  /** One local section per context id. */
  sections: Map<string, LocalSection>;
}

// ---------------------------------------------------------------------------
// HG-25 — stalks and restriction
// ---------------------------------------------------------------------------

/**
 * The support of a context: every note in any relation it covers.
 *
 * Relations are resolved through the model rather than trusted, so a context that
 * still names a dissolved relation simply covers less rather than throwing.
 */
export function contextSupport(model: SimplicialModel, context: SheafContext): NodeID[] {
  const support = new Set<NodeID>();
  context.relations.forEach((key) => {
    const hyperedge = model.getHyperedge(key);
    if (hyperedge) {
      hyperedge.nodes.forEach((id) => support.add(id));
      return;
    }
    const bare = key.startsWith("s:") ? key.slice(2) : key;
    const simplex = model.getSimplex(bare);
    simplex?.nodes.forEach((id) => support.add(id));
  });
  return [...support].sort();
}

/**
 * Backfill a context's local section from a global role assignment.
 *
 * This is the degenerate seed: every context starts agreeing with every other, so
 * a vault that has never diverged reports exactly what it reported before the sheaf
 * existed. Divergence is something the user does, not something inferred.
 */
export function backfillSection(
  model: SimplicialModel,
  context: SheafContext,
  globalRoles: Map<NodeID, SheafRole>,
  fallback: SheafRole = "reference",
): LocalSection {
  const section: LocalSection = new Map();
  contextSupport(model, context).forEach((id) => {
    section.set(id, globalRoles.get(id) ?? fallback);
  });
  return section;
}

/** Restriction to a single note: the projection HG-25 calls for, made explicit. */
export function restrict(section: LocalSection, nodeId: NodeID): SheafRole | undefined {
  return section.get(nodeId);
}

function roleVector(role: SheafRole): Fraction[] {
  return SHEAF_ROLES.map((candidate) => frac(candidate === role ? 1 : 0));
}

// ---------------------------------------------------------------------------
// HG-26 — the cover
// ---------------------------------------------------------------------------

export interface ContextOverlap {
  a: string;
  b: string;
  nodes: NodeID[];
}

export function contextOverlaps(model: SimplicialModel, contexts: SheafContext[]): ContextOverlap[] {
  const supports = new Map(contexts.map((context) => [context.id, new Set(contextSupport(model, context))]));
  const overlaps: ContextOverlap[] = [];
  for (let i = 0; i < contexts.length; i++) {
    for (let j = i + 1; j < contexts.length; j++) {
      const a = supports.get(contexts[i].id)!;
      const b = supports.get(contexts[j].id)!;
      const shared = [...a].filter((id) => b.has(id)).sort();
      if (shared.length === 0) continue;
      overlaps.push({ a: contexts[i].id, b: contexts[j].id, nodes: shared });
    }
  }
  return overlaps;
}

// ---------------------------------------------------------------------------
// HG-27 — pairwise agreement and global sections
// ---------------------------------------------------------------------------

export interface PairwiseAgreement extends ContextOverlap {
  /** True when one baseline shift reconciles the two readings across the whole overlap. */
  agrees: boolean;
  /** Notes the two contexts read differently once the shift is applied. */
  disagreeingNodes: NodeID[];
}

/**
 * Do two contexts agree where they meet?
 *
 * Up to a shift, because a context's reading is relative. Two contexts sharing a
 * single note therefore always agree — which is not a loophole, it is the reason
 * pairwise agreement is a weaker condition than global agreement and the reason
 * contextuality can exist at all.
 */
export function pairwiseAgreement(model: SimplicialModel, data: SheafData, overlap: ContextOverlap): PairwiseAgreement {
  const sectionA = data.sections.get(overlap.a);
  const sectionB = data.sections.get(overlap.b);
  if (!sectionA || !sectionB) {
    return { ...overlap, agrees: true, disagreeingNodes: [] };
  }

  const readings = overlap.nodes
    .map((id) => ({ id, a: sectionA.get(id), b: sectionB.get(id) }))
    .filter(
      (entry): entry is { id: NodeID; a: SheafRole; b: SheafRole } => entry.a !== undefined && entry.b !== undefined,
    );
  if (readings.length <= 1) return { ...overlap, agrees: true, disagreeingNodes: [] };

  // The two readings are reconcilable by one shift exactly when their difference is
  // constant across the overlap. For one-hot role vectors that leaves two cases:
  // they agree outright everywhere, or they disagree in the *same* way everywhere
  // (A always says X where B always says Y), which is a relabelling, not a conflict.
  const identical = readings.every((entry) => entry.a === entry.b);
  const anchor = readings[0];
  const uniformShift = readings.every((entry) => entry.a === anchor.a && entry.b === anchor.b);
  if (identical || uniformShift) return { ...overlap, agrees: true, disagreeingNodes: [] };

  // Otherwise, report the notes that break whichever pattern is closer to holding.
  const disagreeingNodes = readings.filter((entry) => entry.a !== entry.b).map((entry) => entry.id);
  return { ...overlap, agrees: false, disagreeingNodes };
}

interface IncidenceEdge {
  nodeId: NodeID;
  contextId: string;
  /** What this context reads the note as, one-hot over `SHEAF_ROLES`. */
  value: Fraction[];
}

interface IncidenceGraph {
  edges: IncidenceEdge[];
  /** Adjacency by vertex id; note vertices are `n:<id>`, context vertices `c:<id>`. */
  adjacency: Map<string, Array<{ to: string; edgeIndex: number; forward: boolean }>>;
  vertices: string[];
}

function buildIncidenceGraph(model: SimplicialModel, data: SheafData): IncidenceGraph {
  const edges: IncidenceEdge[] = [];
  const adjacency = new Map<string, Array<{ to: string; edgeIndex: number; forward: boolean }>>();
  const vertices = new Set<string>();

  const link = (from: string, to: string, edgeIndex: number, forward: boolean) => {
    vertices.add(from);
    vertices.add(to);
    const list = adjacency.get(from) ?? [];
    list.push({ to, edgeIndex, forward });
    adjacency.set(from, list);
  };

  data.contexts.forEach((context) => {
    const section = data.sections.get(context.id);
    if (!section) return;
    contextSupport(model, context).forEach((nodeId) => {
      const role = section.get(nodeId);
      if (!role) return;
      const edgeIndex = edges.length;
      edges.push({ nodeId, contextId: context.id, value: roleVector(role) });
      // Orientation: node → context is `+`, matching `x_node − x_context = reading`.
      link(`n:${nodeId}`, `c:${context.id}`, edgeIndex, true);
      link(`c:${context.id}`, `n:${nodeId}`, edgeIndex, false);
    });
  });

  return { edges, adjacency, vertices: [...vertices].sort() };
}

export interface FundamentalCycle {
  /** Vertex ids around the cycle, note and context vertices alternating. */
  vertices: string[];
  contexts: string[];
  nodes: NodeID[];
  /** Sum of ±readings around the cycle. Zero means the cycle closes. */
  holonomy: Fraction[];
  closes: boolean;
}

/**
 * Fundamental cycles of the incidence graph, one per non-tree edge, each carrying
 * its holonomy.
 *
 * `δx = y` is solvable exactly when every cycle closes — Kirchhoff's condition. So
 * the cycles are not a heuristic for the obstruction; they are the obstruction, and
 * each one names the contexts it runs through.
 */
export function fundamentalCycles(model: SimplicialModel, data: SheafData): FundamentalCycle[] {
  const graph = buildIncidenceGraph(model, data);
  const parent = new Map<string, { vertex: string; edgeIndex: number; forward: boolean } | null>();
  const depth = new Map<string, number>();
  const usedTreeEdges = new Set<number>();
  const cycles: FundamentalCycle[] = [];

  graph.vertices.forEach((root) => {
    if (parent.has(root)) return;
    parent.set(root, null);
    depth.set(root, 0);
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const link of graph.adjacency.get(current) ?? []) {
        if (usedTreeEdges.has(link.edgeIndex)) continue;
        if (parent.has(link.to)) continue;
        usedTreeEdges.add(link.edgeIndex);
        parent.set(link.to, { vertex: current, edgeIndex: link.edgeIndex, forward: link.forward });
        depth.set(link.to, (depth.get(current) ?? 0) + 1);
        queue.push(link.to);
      }
    }
  });

  const pathToRoot = (vertex: string): string[] => {
    const path = [vertex];
    let cursor = vertex;
    while (true) {
      const step = parent.get(cursor);
      if (!step) break;
      cursor = step.vertex;
      path.push(cursor);
    }
    return path;
  };

  graph.edges.forEach((edge, edgeIndex) => {
    if (usedTreeEdges.has(edgeIndex)) return;
    const from = `n:${edge.nodeId}`;
    const to = `c:${edge.contextId}`;
    const fromPath = pathToRoot(from);
    const toPath = pathToRoot(to);
    const toIndex = new Map(toPath.map((vertex, index) => [vertex, index]));
    let meetIndexFrom = -1;
    let meetIndexTo = -1;
    for (let index = 0; index < fromPath.length; index++) {
      const found = toIndex.get(fromPath[index]);
      if (found !== undefined) {
        meetIndexFrom = index;
        meetIndexTo = found;
        break;
      }
    }
    if (meetIndexFrom === -1) return;

    const loop = [...fromPath.slice(0, meetIndexFrom + 1), ...toPath.slice(0, meetIndexTo).reverse()];
    const holonomy = accumulateHolonomy(loop, edgeIndex, graph);
    cycles.push({
      vertices: loop,
      contexts: [...new Set(loop.filter((v) => v.startsWith("c:")).map((v) => v.slice(2)))].sort(),
      nodes: [...new Set(loop.filter((v) => v.startsWith("n:")).map((v) => v.slice(2)))].sort(),
      holonomy,
      closes: holonomy.every((value) => value.n === 0),
    });
  });

  return cycles;
}

/**
 * Walk the loop summing `±reading`, where the sign is the traversal direction.
 *
 * Node → context is `+` because the system being solved is `x_node − x_context =
 * reading`; the reverse traversal contributes the same term negated. A loop whose
 * total is zero is one the readings can be reconciled around.
 */
function accumulateHolonomy(loop: string[], closingEdgeIndex: number, graph: IncidenceGraph): Fraction[] {
  let total: Fraction[] = SHEAF_ROLES.map(() => frac(0));
  const apply = (edge: IncidenceEdge, forward: boolean) => {
    total = total.map((value, index) => (forward ? add(value, edge.value[index]) : subtract(value, edge.value[index])));
  };

  for (let index = 0; index + 1 < loop.length; index++) {
    const link = (graph.adjacency.get(loop[index]) ?? []).find((candidate) => candidate.to === loop[index + 1]);
    if (!link) continue;
    apply(graph.edges[link.edgeIndex], link.forward);
  }
  // Close the loop with the non-tree edge, traversed context → node.
  apply(graph.edges[closingEdgeIndex], false);
  return total;
}

export interface GluingResult {
  /** Contexts that disagree pairwise on their overlap — the easy, uninteresting kind. */
  pairwiseDisagreements: PairwiseAgreement[];
  cycles: FundamentalCycle[];
  /** Rank of non-closing holonomy vectors; not a computed sheaf-cohomology group. */
  obstructionRank: number;
  /** Free incidence-component baselines over the role space; not a computed H⁰. */
  globalBaselineDimension: number;
  glues: boolean;
  /**
   * The signature the whole layer exists for: pairwise compatible everywhere, and
   * globally impossible. Distinct from plain local inconsistency, which is easy to
   * find and says nothing interesting.
   */
  contextualityDetected: boolean;
}

/**
 * HG-27 and HG-28. Does the cover glue, and if not, in how many independent ways
 * does it fail?
 */
export function checkGluing(model: SimplicialModel, data: SheafData): GluingResult {
  const overlaps = contextOverlaps(model, data.contexts);
  const agreements = overlaps.map((overlap) => pairwiseAgreement(model, data, overlap));
  const pairwiseDisagreements = agreements.filter((agreement) => !agreement.agrees);

  const cycles = fundamentalCycles(model, data);
  const openCycles = cycles.filter((cycle) => !cycle.closes);
  const holonomyMatrix: Matrix = openCycles.map((cycle) => cycle.holonomy);
  const obstructionRank = holonomyMatrix.length > 0 ? rank(holonomyMatrix) : 0;

  // Components of the incidence graph each carry one free baseline, so a gluing
  // cover admits exactly one reading per component per role dimension.
  const componentCount = incidenceComponents(model, data);
  const glues = obstructionRank === 0;

  return {
    pairwiseDisagreements,
    cycles,
    obstructionRank,
    globalBaselineDimension: glues ? componentCount * SHEAF_ROLES.length : 0,
    glues,
    contextualityDetected: obstructionRank > 0 && pairwiseDisagreements.length === 0,
  };
}

function incidenceComponents(model: SimplicialModel, data: SheafData): number {
  const graph = buildIncidenceGraph(model, data);
  const seen = new Set<string>();
  let components = 0;
  graph.vertices.forEach((vertex) => {
    if (seen.has(vertex)) return;
    components++;
    const stack = [vertex];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      (graph.adjacency.get(current) ?? []).forEach((link) => {
        if (!seen.has(link.to)) stack.push(link.to);
      });
    }
  });
  return components;
}

// ---------------------------------------------------------------------------
// HG-28 — obstructions and the contextual fraction
// ---------------------------------------------------------------------------

export interface Obstruction {
  contexts: string[];
  nodes: NodeID[];
  /** How far this cycle is from closing. Zero would mean it closes. */
  magnitude: number;
}

/**
 * One entry per independent obstruction class, each naming a concrete cycle of
 * contexts. Redundant cycles — those spanned by ones already listed — are dropped,
 * so the count matches `obstructionRank` rather than counting the same failure repeatedly.
 */
export function obstructions(result: GluingResult): Obstruction[] {
  const open = result.cycles.filter((cycle) => !cycle.closes);
  const independent: Obstruction[] = [];
  const chosen: Matrix = [];

  for (const cycle of open) {
    const candidate = [...chosen, cycle.holonomy];
    if (rank(candidate) <= chosen.length) continue;
    chosen.push(cycle.holonomy);
    independent.push({
      contexts: cycle.contexts,
      nodes: cycle.nodes,
      magnitude: cycle.holonomy.reduce((sum, value) => sum + Math.abs(value.n / value.d), 0),
    });
    if (independent.length >= result.obstructionRank) break;
  }
  return independent;
}

/** Above this many contexts, the exact search is abandoned for a greedy lower bound. */
export const EXACT_FRACTION_CONTEXT_LIMIT = 12;

function popcount(value: number): number {
  let count = 0;
  let bits = value;
  while (bits) {
    bits &= bits - 1;
    count++;
  }
  return count;
}

export interface ContextualFraction {
  /** Proportion of the cover admitting one globally consistent reading, in `[0,1]`. */
  value: number;
  /** The largest sub-cover that glues. */
  consistentContexts: string[];
  /** False when the cover was too large to search exhaustively; `value` is then a lower bound. */
  exact: boolean;
}

/**
 * HG-28. What proportion of the data admits a globally consistent explanation.
 *
 * A boolean would say only that something is wrong. This says how much of the vault
 * can still be read together — 0.8 is a local problem, 0.3 is a vault that has
 * stopped cohering — and it is comparable across vaults because it is a proportion.
 *
 * Dropping a context can only remove cycles, never create them, so the search is
 * over a monotone family. That is what makes an exhaustive answer affordable at
 * realistic cover sizes; past the limit it degrades to a greedy lower bound and
 * says so rather than pretending.
 */
export function contextualFraction(model: SimplicialModel, data: SheafData): ContextualFraction {
  const contexts = data.contexts;
  if (contexts.length === 0) return { value: 1, consistentContexts: [], exact: true };
  if (checkGluing(model, data).glues) {
    return { value: 1, consistentContexts: contexts.map((context) => context.id), exact: true };
  }

  const gluesWith = (ids: Set<string>): boolean =>
    checkGluing(model, {
      contexts: contexts.filter((context) => ids.has(context.id)),
      sections: data.sections,
    }).glues;

  if (contexts.length <= EXACT_FRACTION_CONTEXT_LIMIT) {
    // Largest first: the answer is usually one or two contexts short of the whole
    // cover, so the search almost always stops in the first couple of rounds.
    for (let size = contexts.length - 1; size >= 1; size--) {
      for (let mask = 0; mask < 1 << contexts.length; mask++) {
        if (popcount(mask) !== size) continue;
        const ids = new Set(contexts.filter((_, index) => (mask & (1 << index)) !== 0).map((c) => c.id));
        if (gluesWith(ids)) {
          return { value: size / contexts.length, consistentContexts: [...ids].sort(), exact: true };
        }
      }
    }
    return { value: 0, consistentContexts: [], exact: true };
  }

  // Greedy: drop whichever context sits on the most open cycles, until the rest glue.
  const remaining = new Set(contexts.map((context) => context.id));
  while (remaining.size > 0 && !gluesWith(remaining)) {
    const live = { contexts: contexts.filter((c) => remaining.has(c.id)), sections: data.sections };
    const counts = new Map<string, number>();
    fundamentalCycles(model, live)
      .filter((cycle) => !cycle.closes)
      .forEach((cycle) => cycle.contexts.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1)));
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!worst) break;
    remaining.delete(worst[0]);
  }
  return { value: remaining.size / contexts.length, consistentContexts: [...remaining].sort(), exact: false };
}

// ---------------------------------------------------------------------------
// Convenience for the UI
// ---------------------------------------------------------------------------

export interface SheafReport {
  gluing: GluingResult;
  obstructions: Obstruction[];
  fraction: ContextualFraction;
  overlaps: ContextOverlap[];
}

export function analyzeSheaf(model: SimplicialModel, data: SheafData): SheafReport {
  const gluing = checkGluing(model, data);
  return {
    gluing,
    obstructions: obstructions(gluing),
    fraction: contextualFraction(model, data),
    overlaps: contextOverlaps(model, data.contexts),
  };
}

export interface RoleRefinementSuggestion {
  contextId: string;
  nodeId: NodeID;
  from: SheafRole;
  to: SheafRole;
  before: {
    obstructionRank: number;
    contextualFraction: number;
    localDisagreements: number;
    contextualityDetected: boolean;
  };
  after: {
    obstructionRank: number;
    contextualFraction: number;
    localDisagreements: number;
    contextualityDetected: boolean;
  };
  score: number;
}

export interface RoleRefinementOptions {
  limit?: number;
  /** Bounds interactive work on very large covers. */
  maxCandidates?: number;
}

/**
 * Test one local-role change at a time and return only improvements. This is a
 * counterfactual assistant, not an inference engine: it says what would improve
 * gluing, never which reading is true, and it never mutates `data`.
 */
export function suggestRoleRefinements(
  model: SimplicialModel,
  data: SheafData,
  options: RoleRefinementOptions = {},
): RoleRefinementSuggestion[] {
  const limit = Math.max(0, options.limit ?? 8);
  const maxCandidates = Math.max(0, options.maxCandidates ?? 600);
  if (limit === 0 || maxCandidates === 0 || data.contexts.length === 0) return [];

  const baseline = analyzeSheaf(model, data);
  const before = {
    obstructionRank: baseline.gluing.obstructionRank,
    contextualFraction: baseline.fraction.value,
    localDisagreements: baseline.gluing.pairwiseDisagreements.length,
    contextualityDetected: baseline.gluing.contextualityDetected,
  };
  if (before.obstructionRank === 0 && before.localDisagreements === 0) return [];

  const implicatedContexts = new Set<string>();
  const implicatedNodes = new Set<NodeID>();
  baseline.obstructions.forEach((obstruction) => {
    obstruction.contexts.forEach((id) => implicatedContexts.add(id));
    obstruction.nodes.forEach((id) => implicatedNodes.add(id));
  });
  baseline.gluing.pairwiseDisagreements.forEach((disagreement) => {
    implicatedContexts.add(disagreement.a);
    implicatedContexts.add(disagreement.b);
    disagreement.disagreeingNodes.forEach((id) => implicatedNodes.add(id));
  });

  const suggestions: RoleRefinementSuggestion[] = [];
  let evaluated = 0;
  for (const context of data.contexts) {
    if (implicatedContexts.size > 0 && !implicatedContexts.has(context.id)) continue;
    const section = data.sections.get(context.id);
    if (!section) continue;
    for (const [nodeId, from] of section) {
      if (implicatedNodes.size > 0 && !implicatedNodes.has(nodeId)) continue;
      for (const to of SHEAF_ROLES) {
        if (to === from || evaluated >= maxCandidates) continue;
        evaluated++;
        const trialSections = new Map(data.sections);
        trialSections.set(context.id, new Map(section).set(nodeId, to));
        const report = analyzeSheaf(model, { contexts: data.contexts, sections: trialSections });
        const after = {
          obstructionRank: report.gluing.obstructionRank,
          contextualFraction: report.fraction.value,
          localDisagreements: report.gluing.pairwiseDisagreements.length,
          contextualityDetected: report.gluing.contextualityDetected,
        };
        const score =
          (before.obstructionRank - after.obstructionRank) * 100 +
          (Number(before.contextualityDetected) - Number(after.contextualityDetected)) * 50 +
          (after.contextualFraction - before.contextualFraction) * 25 +
          (before.localDisagreements - after.localDisagreements) * 10;
        if (score > 1e-9) suggestions.push({ contextId: context.id, nodeId, from, to, before, after, score });
      }
      if (evaluated >= maxCandidates) break;
    }
    if (evaluated >= maxCandidates) break;
  }

  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.contextId.localeCompare(b.contextId) ||
        a.nodeId.localeCompare(b.nodeId) ||
        a.to.localeCompare(b.to),
    )
    .slice(0, limit);
}

/** Every relation key a context could name, for the definition UI. */
export function allRelationKeys(model: SimplicialModel): RelationKey[] {
  return [
    ...[...model.simplices.values()]
      .filter((simplex) => !simplex.autoGenerated)
      .map((simplex) => relationKey("simplex", simplex.nodes)),
    ...model.hyperedges.keys(),
  ].sort();
}
