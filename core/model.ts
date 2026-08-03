import { generateFaces, plannedFaces } from "./faces.js";
import { hashLabel } from "./hash.js";
import { normalizeKey, normalizeNodes, relationKey, uniqueNodes } from "./normalize.js";
import type {
  AnalysisSummary,
  BettiResult,
  HigherOrderRelation,
  Hyperedge,
  LayoutNode,
  NodeID,
  Rect,
  RelationKey,
  Simplex,
  SimplexKey,
} from "./types.js";
import { computeBetti } from "./betti.js";
import { logger } from "./logger.js";

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomBorderPosition(width: number, height: number, padding: number): { px: number; py: number } {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const usableHalfWidth = Math.max(padding + 40, halfWidth - padding);
  const usableHalfHeight = Math.max(padding + 40, halfHeight - padding);
  const side = Math.floor(Math.random() * 4);

  switch (side) {
    case 0:
      return {
        px: randomInRange(-usableHalfWidth, usableHalfWidth),
        py: -usableHalfHeight,
      };
    case 1:
      return {
        px: usableHalfWidth,
        py: randomInRange(-usableHalfHeight, usableHalfHeight),
      };
    case 2:
      return {
        px: randomInRange(-usableHalfWidth, usableHalfWidth),
        py: usableHalfHeight,
      };
    default:
      return {
        px: -usableHalfWidth,
        py: randomInRange(-usableHalfHeight, usableHalfHeight),
      };
  }
}

function createNode(id: NodeID, bounds?: Rect, isVirtual = false): LayoutNode {
  const width = bounds?.width ?? 960;
  const height = bounds?.height ?? 640;
  const { px, py } = randomBorderPosition(width, height, 80);
  return {
    id,
    px,
    py,
    vx: 0,
    vy: 0,
    isVirtual,
    isPinned: false,
    displayAlpha: 1,
  };
}

type Listener = () => void;

export class SimplicialModel {
  readonly nodes = new Map<NodeID, LayoutNode>();
  readonly simplices = new Map<SimplexKey, Simplex>();
  /**
   * The hypergraph layer. Structurally separate from `simplices`: nothing in here
   * ever reaches `generateFaces()` or `computeBetti()`.
   */
  readonly hyperedges = new Map<RelationKey, Hyperedge>();
  private listeners = new Set<Listener>();
  private batchDepth = 0;
  private hasPendingEmit = false;

  // Analysis cache - invalidated on model mutation
  private _analysisCache: AnalysisSummary | null = null;
  private _analysisDirty = true;
  /** Cross-layer map cache (see core/incidence.ts). Invalidated with the analysis cache. */
  private _crossLayerCache: unknown = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange(): void {
    if (this.batchDepth > 0) {
      this.hasPendingEmit = true;
      return;
    }
    this.flushChange();
  }

  private flushChange(): void {
    this.listeners.forEach((listener) => listener());
  }

  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.hasPendingEmit) {
        this.hasPendingEmit = false;
        this.flushChange();
      }
    }
  }

  setNode(id: NodeID, opts?: Partial<Pick<LayoutNode, "isVirtual" | "isPinned" | "px" | "py">>): void {
    const existing = this.nodes.get(id);
    if (existing) {
      Object.assign(existing, opts ?? {});
      if (opts?.isVirtual === false) existing.isVirtual = false;
      this.emitChange();
      return;
    }
    const node = createNode(id, undefined, opts?.isVirtual ?? false);
    if (opts?.px !== undefined) node.px = opts.px;
    if (opts?.py !== undefined) node.py = opts.py;
    if (opts?.isPinned !== undefined) node.isPinned = opts.isPinned;
    this.nodes.set(id, node);
    this.invalidateAnalysisCache();
    this.emitChange();
  }

  removeNode(id: NodeID): void {
    this.nodes.delete(id);
    for (const [key, simplex] of [...this.simplices]) {
      if (!simplex.nodes.includes(id)) continue;
      this.simplices.delete(key);
    }
    for (const [key, hyperedge] of [...this.hyperedges]) {
      if (!hyperedge.nodes.includes(id)) continue;
      this.hyperedges.delete(key);
    }
    this.invalidateAnalysisCache();
    this.emitChange();
  }

  updateNodeId(oldId: NodeID, newId: NodeID): void {
    if (oldId === newId) return;
    const existing = this.nodes.get(oldId);
    if (existing) {
      this.nodes.set(newId, { ...existing, id: newId });
      this.nodes.delete(oldId);
    }

    for (const [key, simplex] of [...this.simplices]) {
      if (!simplex.nodes.includes(oldId)) continue;
      const updated = {
        ...simplex,
        nodes: normalizeNodes(simplex.nodes.map((node) => (node === oldId ? newId : node))),
      };
      this.simplices.delete(key);
      this.simplices.set(normalizeKey(updated.nodes), updated);
    }
    for (const [key, hyperedge] of [...this.hyperedges]) {
      if (!hyperedge.nodes.includes(oldId)) continue;
      const updated: Hyperedge = {
        ...hyperedge,
        nodes: normalizeNodes(hyperedge.nodes.map((node) => (node === oldId ? newId : node))),
      };
      this.hyperedges.delete(key);
      this.hyperedges.set(relationKey("hyperedge", updated.nodes), updated);
    }
    this.invalidateAnalysisCache();
    this.emitChange();
  }

  addSimplex(simplex: Simplex): string {
    if ((simplex as Partial<HigherOrderRelation>).kind === "hyperedge") {
      // The invariant this whole layer exists to protect: a hyperedge asserts nothing
      // about its subgroups, so it must never reach generateFaces().
      logger.error("model", "Refused to add a hyperedge through addSimplex", { nodes: simplex.nodes });
      return "";
    }
    const nodes = uniqueNodes(simplex.nodes);
    if (nodes.length < 2) return "";

    nodes.forEach((id) => {
      if (!this.nodes.has(id)) this.setNode(id, { isVirtual: false });
    });
    const normalized: Simplex = {
      ...simplex,
      nodes: normalizeNodes(nodes),
      weight: clampWeight(simplex.weight),
      autoGenerated: simplex.autoGenerated ?? false,
      userDefined: simplex.userDefined ?? !simplex.autoGenerated,
      colorKey: simplex.autoGenerated
        ? (simplex.colorKey ?? "neutral")
        : (simplex.colorKey ?? hashLabel(simplex.label)),
    };
    const key = normalizeKey(normalized.nodes);
    this.simplices.set(key, normalized);
    generateFaces(this, normalized);
    this.invalidateAnalysisCache();
    this.emitChange();
    return key;
  }

  removeSimplex(key: string): void {
    if (!this.simplices.delete(key)) return;
    for (const [candidateKey, simplex] of [...this.simplices]) {
      if (!simplex.autoGenerated) continue;
      const hasParent = [...this.simplices.entries()].some(([otherKey, other]) => {
        if (otherKey === candidateKey) return false;
        if (other.autoGenerated) return false;
        return simplex.nodes.every((node) => other.nodes.includes(node));
      });
      if (!hasParent) this.simplices.delete(candidateKey);
    }
    this.invalidateAnalysisCache();
    this.emitChange();
  }

  /**
   * Add an irreducible encounter. Deliberately does *not* call `generateFaces()`
   * and never touches `this.simplices`.
   */
  addHyperedge(hyperedge: Hyperedge): RelationKey {
    const nodes = uniqueNodes(hyperedge.nodes);
    if (nodes.length < 2) return "";

    nodes.forEach((id) => {
      if (!this.nodes.has(id)) this.setNode(id, { isVirtual: false });
    });
    const normalizedNodes = normalizeNodes(nodes);
    const key = relationKey("hyperedge", normalizedNodes);
    const existing = this.hyperedges.get(key);
    const base = existing?.suggested && !hyperedge.suggested ? undefined : existing;
    const normalized: Hyperedge = {
      ...base,
      ...hyperedge,
      nodes: normalizedNodes,
      weight: clampWeight(hyperedge.weight ?? base?.weight),
      colorKey: hyperedge.colorKey ?? base?.colorKey ?? hashLabel(hyperedge.label),
      ...(!hyperedge.suggested ? { occurredAt: base?.occurredAt ?? hyperedge.occurredAt ?? Date.now() } : {}),
    };
    this.hyperedges.set(key, normalized);
    this.invalidateAnalysisCache();
    this.emitChange();
    return key;
  }

  removeHyperedge(key: RelationKey): boolean {
    if (!this.hyperedges.delete(key)) return false;
    this.invalidateAnalysisCache();
    this.emitChange();
    return true;
  }

  getHyperedge(key: RelationKey): Hyperedge | undefined {
    return this.hyperedges.get(key);
  }

  getHyperedgesForNode(id: NodeID): Hyperedge[] {
    return [...this.hyperedges.values()].filter((hyperedge) => hyperedge.nodes.includes(id));
  }

  updateHyperedge(key: RelationKey, updates: Partial<Hyperedge>): Hyperedge | undefined {
    const existing = this.hyperedges.get(key);
    if (!existing) return undefined;
    const updated: Hyperedge = { ...existing, ...updates, nodes: existing.nodes };
    if (updates.label !== undefined) updated.colorKey = hashLabel(updates.label);
    if (updates.weight !== undefined) updated.weight = clampWeight(updates.weight);
    this.hyperedges.set(key, updated);
    this.invalidateAnalysisCache();
    this.emitChange();
    return updated;
  }

  /**
   * Exactly the faces promoting this encounter would create. Shown to the user
   * before the assertion is made — promotion is a claim about meaning, not a
   * bookkeeping step.
   */
  facesImpliedByPromotion(hyperedgeKey: RelationKey): NodeID[][] {
    const hyperedge = this.hyperedges.get(hyperedgeKey);
    if (!hyperedge) return [];
    return plannedFaces(this, { nodes: hyperedge.nodes });
  }

  /**
   * HG-08. The user asserts the lower-dimensional faces are meaningful.
   *
   * The encounter is retained by default and marked `promotedTo`: discarding it
   * would rewrite the history the persistence layer exists to protect, and it is
   * what makes `relaxToHyperedge` reversible.
   */
  promoteToSimplex(
    hyperedgeKey: RelationKey,
    options: { retainEncounter?: boolean } = {},
  ): { simplexKey: SimplexKey; createdFaces: NodeID[][] } | null {
    const hyperedge = this.hyperedges.get(hyperedgeKey);
    if (!hyperedge) return null;

    const createdFaces = this.facesImpliedByPromotion(hyperedgeKey);
    let simplexKey = "";
    this.batch(() => {
      simplexKey = this.addSimplex({
        nodes: hyperedge.nodes,
        label: hyperedge.label,
        weight: hyperedge.weight,
        sourcePath: hyperedge.sourcePath,
        userDefined: true,
        autoGenerated: false,
      });
      if (options.retainEncounter === false) {
        this.hyperedges.delete(hyperedgeKey);
      } else {
        this.hyperedges.set(hyperedgeKey, { ...hyperedge, promotedTo: simplexKey });
      }
      this.invalidateAnalysisCache();
      this.emitChange();
    });
    if (!simplexKey) return null;
    return { simplexKey, createdFaces };
  }

  /**
   * HG-09. Withdraw the downward-closure claim while preserving the group relation.
   *
   * `removeSimplex` already sweeps auto-generated faces that lost their last
   * non-auto parent, and correctly leaves faces that some unrelated simplex still
   * asserts — this reuses that rather than duplicating the rule.
   */
  relaxToHyperedge(simplexKey: SimplexKey): RelationKey | null {
    const simplex = this.simplices.get(simplexKey);
    if (!simplex || simplex.autoGenerated) return null;

    const key = relationKey("hyperedge", simplex.nodes);
    const existing = this.hyperedges.get(key);
    let result = "";
    this.batch(() => {
      result = this.addHyperedge({
        ...existing,
        nodes: simplex.nodes,
        label: existing?.label ?? simplex.label,
        weight: existing?.weight ?? simplex.weight,
        sourcePath: existing?.sourcePath ?? simplex.sourcePath,
        // Keep the original encounter time; relaxing is not a new encounter.
        occurredAt: existing?.occurredAt,
        promotedTo: undefined,
      });
      this.removeSimplex(simplexKey);
    });
    return result || null;
  }

  /**
   * HG-10. Record that an encounter precipitated a new concept note.
   *
   * Deliberately does not promote: repetition is evidence, not proof, of
   * simplicial coherence.
   */
  crystallizeHyperedge(hyperedgeKey: RelationKey, conceptNodeId: NodeID): boolean {
    const hyperedge = this.hyperedges.get(hyperedgeKey);
    if (!hyperedge) return false;
    this.batch(() => {
      if (!this.nodes.has(conceptNodeId)) this.setNode(conceptNodeId, { isVirtual: false });
      this.hyperedges.set(hyperedgeKey, { ...hyperedge, crystallizedInto: conceptNodeId });
      this.invalidateAnalysisCache();
      this.emitChange();
    });
    return true;
  }

  /** Both layers, each tagged with its kind, keyed as in `relationKey`. */
  getAllRelations(): Array<{ key: RelationKey; relation: HigherOrderRelation }> {
    const relations: Array<{ key: RelationKey; relation: HigherOrderRelation }> = [];
    this.simplices.forEach((simplex, key) => {
      relations.push({ key: relationKey("simplex", simplex.nodes), relation: { kind: "simplex", ...simplex } });
      void key;
    });
    this.hyperedges.forEach((hyperedge, key) => {
      relations.push({ key, relation: { kind: "hyperedge", ...hyperedge } });
    });
    return relations;
  }

  replaceInferredSimplices(simplices: Simplex[]): void {
    this.batch(() => {
      for (const [key, simplex] of [...this.simplices]) {
        if (simplex.inferred) {
          this.simplices.delete(key);
        }
      }
      simplices.forEach((simplex) => {
        simplex.nodes.forEach((id) => {
          if (!this.nodes.has(id)) this.setNode(id, { isVirtual: false });
        });
        this.addSimplex(simplex);
      });
      this.invalidateAnalysisCache();
      this.emitChange();
    });
  }

  /** Replace probabilistic inferred encounters without touching authored encounters. */
  replaceInferredHyperedges(hyperedges: Hyperedge[]): void {
    this.batch(() => {
      for (const [key, hyperedge] of this.hyperedges) {
        if (hyperedge.inferred && hyperedge.suggested) this.hyperedges.delete(key);
      }
      hyperedges.forEach((hyperedge) => this.addHyperedge({ ...hyperedge, inferred: true, suggested: true }));
      this.invalidateAnalysisCache();
      this.emitChange();
    });
  }

  /**
   * Re-seat everything a single file owns. A rescan must clear *both* layers for
   * that path, otherwise a hyperedge deleted from a note would linger forever.
   */
  replaceSourceRelations(sourcePath: string, simplices: Simplex[], hyperedges: Hyperedge[]): void {
    this.batch(() => {
      for (const [key, simplex] of [...this.simplices]) {
        if (simplex.sourcePath === sourcePath && !simplex.autoGenerated) {
          this.simplices.delete(key);
        }
      }
      for (const [key, hyperedge] of [...this.hyperedges]) {
        if (hyperedge.sourcePath === sourcePath) {
          this.hyperedges.delete(key);
        }
      }
      simplices.forEach((simplex) => {
        simplex.nodes.forEach((id) => {
          if (!this.nodes.has(id)) this.setNode(id, { isVirtual: true });
        });
        this.addSimplex({ ...simplex, sourcePath });
      });
      hyperedges.forEach((hyperedge) => {
        hyperedge.nodes.forEach((id) => {
          if (!this.nodes.has(id)) this.setNode(id, { isVirtual: true });
        });
        this.addHyperedge({ ...hyperedge, sourcePath });
      });
      this.invalidateAnalysisCache();
      this.emitChange();
    });
  }

  replaceSourceSimplices(sourcePath: string, simplices: Simplex[]): void {
    this.replaceSourceRelations(sourcePath, simplices, []);
  }

  updateMetadata(key: string, meta: Partial<Pick<Simplex, "label" | "weight">>): void {
    const simplex = this.simplices.get(key);
    if (!simplex) return;
    const updated: Simplex = { ...simplex, ...meta };
    if (meta.label !== undefined) updated.colorKey = simplex.autoGenerated ? "neutral" : hashLabel(meta.label);
    if (meta.weight !== undefined) updated.weight = clampWeight(meta.weight);
    this.simplices.set(key, updated);
    this.invalidateAnalysisCache();
    this.emitChange();
  }

  setPinnedState(nodeId: NodeID, pinned: boolean, px?: number, py?: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.isPinned = pinned;
    if (px !== undefined) node.px = px;
    if (py !== undefined) node.py = py;
    this.emitChange();
  }

  getSimplicesForNode(id: NodeID): Simplex[] {
    return [...this.simplices.values()].filter((simplex) => simplex.nodes.includes(id));
  }

  getNeighbors(id: NodeID): NodeID[] {
    const neighbors = new Set<NodeID>();
    this.getSimplicesForNode(id).forEach((simplex) => {
      simplex.nodes.forEach((node) => {
        if (node !== id) neighbors.add(node);
      });
    });
    return [...neighbors];
  }

  getSimplicesByDim(targetDim: number): Simplex[] {
    return [...this.simplices.values()].filter((simplex) => simplex.nodes.length - 1 === targetDim);
  }

  getAllNodes(): LayoutNode[] {
    return [...this.nodes.values()];
  }

  getSimplex(key: SimplexKey): Simplex | undefined {
    return this.simplices.get(key);
  }

  /**
   * Invalidate the analysis cache. Called automatically on model mutations.
   */
  private invalidateAnalysisCache(): void {
    this._analysisDirty = true;
    this._crossLayerCache = null;
  }

  /** Backing store for the cross-layer map in core/incidence.ts. */
  readCrossLayerCache<T>(): T | null {
    return this._crossLayerCache as T | null;
  }

  writeCrossLayerCache<T>(value: T): T {
    this._crossLayerCache = value;
    return value;
  }

  /**
   * Get cached analysis summary. Recomputes only if cache is dirty.
   */
  getAnalysisSummary(): AnalysisSummary {
    if (!this._analysisDirty && this._analysisCache) {
      return this._analysisCache;
    }

    this._analysisCache = this.computeAnalysisSummary();
    this._analysisDirty = false;
    return this._analysisCache;
  }

  /**
   * Get cached Betti numbers. Recomputes only if cache is dirty.
   */
  getCachedBetti(): BettiResult {
    // Get from analysis cache if available, otherwise compute just Betti
    if (!this._analysisDirty && this._analysisCache) {
      return this._analysisCache.betti ?? { b0: 0, b1: 0, b2: 0, holes: [] };
    }
    return computeBetti(this, 2);
  }

  private computeAnalysisSummary(): AnalysisSummary {
    const simplices = [...this.simplices.values()];
    const edgeSimplices = simplices.filter((simplex) => simplex.nodes.length === 2);
    const adjacency = new Map<NodeID, Set<NodeID>>();
    const simplexCentrality = new Map<NodeID, number>();
    this.nodes.forEach((_, nodeId) => adjacency.set(nodeId, new Set()));
    this.nodes.forEach((_, nodeId) => simplexCentrality.set(nodeId, 0));
    edgeSimplices.forEach((simplex) => {
      const [a, b] = simplex.nodes;
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
    });
    simplices.forEach((simplex) => {
      simplex.nodes.forEach((nodeId) => {
        simplexCentrality.set(nodeId, (simplexCentrality.get(nodeId) ?? 0) + 1);
      });
    });

    let connectedComponents = 0;
    const visited = new Set<NodeID>();
    adjacency.forEach((_, nodeId) => {
      if (visited.has(nodeId)) return;
      connectedComponents++;
      const stack = [nodeId];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        adjacency.get(current)?.forEach((neighbor) => {
          if (!visited.has(neighbor)) stack.push(neighbor);
        });
      }
    });

    let maxDegreeNodeId: NodeID | null = null;
    let maxDegree = -1;
    let degreeTotal = 0;
    adjacency.forEach((neighbors, nodeId) => {
      const degree = neighbors.size;
      degreeTotal += degree;
      if (degree > maxDegree) {
        maxDegree = degree;
        maxDegreeNodeId = nodeId;
      }
    });

    let maxSimplexCentralityNodeId: NodeID | null = null;
    let maxSimplexCentrality = -1;
    let simplexCentralityTotal = 0;
    simplexCentrality.forEach((centrality, nodeId) => {
      simplexCentralityTotal += centrality;
      if (centrality > maxSimplexCentrality) {
        maxSimplexCentrality = centrality;
        maxSimplexCentralityNodeId = nodeId;
      }
    });

    const betti = computeBetti(this, 2);
    const holeCount = betti.holes.length;

    const hyperedges = [...this.hyperedges.values()];

    return {
      nodeCount: this.nodes.size,
      simplexCount: simplices.length,
      hyperedgeCount: hyperedges.length,
      recurringEncounterCount: hyperedges.filter((hyperedge) => hyperedge.persistence === "recurring").length,
      edgeCount: edgeSimplices.length,
      clusterCount: simplices.filter((simplex) => simplex.nodes.length === 3).length,
      coreCount: simplices.filter((simplex) => simplex.nodes.length >= 4).length,
      inferredCount: simplices.filter((simplex) => simplex.inferred).length,
      suggestedCount: simplices.filter((simplex) => simplex.suggested).length,
      connectedComponents,
      averageDegree: this.nodes.size ? Number((degreeTotal / this.nodes.size).toFixed(2)) : 0,
      maxDegreeNodeId,
      maxDegree: Math.max(0, maxDegree),
      maxSimplexCentralityNodeId,
      maxSimplexCentrality: Math.max(0, maxSimplexCentrality),
      averageSimplexCentrality: this.nodes.size ? Number((simplexCentralityTotal / this.nodes.size).toFixed(2)) : 0,
      betti,
      holeCount,
    };
  }
}

function clampWeight(weight: number | undefined): number {
  if (weight === undefined || Number.isNaN(weight)) return 1;
  return Math.max(0.1, Math.min(1, weight));
}
