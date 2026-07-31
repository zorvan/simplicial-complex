/* global window -- Allow window for setTimeout/clearTimeout in Obsidian/Electron environment (ESLint browser globals) */
import { normalizeKey, relationKey } from "../core/normalize";
import type {
  FocusState,
  HigherOrderRelation,
  LayoutNode,
  NodeID,
  RelationKey,
  RelationSelection,
  Simplex,
  SimplexKey,
} from "../core/types";
import { SimplicialModel } from "../core/model";
import { createInteractionTracker, logInteraction, type ReinforcementState } from "../data/interactions";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class InteractionController {
  hoveredNodeId: NodeID | null = null;
  lockedNodeId: NodeID | null = null;
  hoveredSimplexKey: SimplexKey | null = null;
  /** Namespaced (`h:`) key of the focused encounter, kept separate so the two layers never alias. */
  hoveredHyperedgeKey: RelationKey | null = null;
  holdNode: NodeID | null = null;
  private holdTimer: number | null = null;
  private hoverIntentTimer: number | null = null;
  private pressedNodeId: NodeID | null = null;
  private draggingNodeId: NodeID | null = null;
  private draggedNodeWasPinned = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private pressX = 0;
  private pressY = 0;
  private movedDuringPointerDown = false;
  private interactionTracker: ReinforcementState;

  constructor(
    private model: SimplicialModel,
    private onWake?: () => void,
    private onSelection?: (selection: RelationSelection | null) => void,
    private onHoverIntent?: (selection: RelationSelection | null) => void,
    private onPinnedStateChanged?: () => void,
    private onInteraction?: (tracker: ReinforcementState) => void,
  ) {
    this.interactionTracker = createInteractionTracker();
  }

  getInteractionTracker(): ReinforcementState {
    return this.interactionTracker;
  }

  setInteractionTracker(state: ReinforcementState): void {
    this.interactionTracker = state;
  }

  logConfirm(simplexKey: SimplexKey, nodeIds: NodeID[]): void {
    logInteraction(this.interactionTracker, { type: "confirm", simplexKey, nodeIds, weight: 0.5 });
    this.onInteraction?.(this.interactionTracker);
  }

  logReject(simplexKey: SimplexKey, nodeIds: NodeID[]): void {
    logInteraction(this.interactionTracker, { type: "reject", simplexKey, nodeIds, weight: -0.3 });
    this.onInteraction?.(this.interactionTracker);
  }

  logPromote(simplexKey: SimplexKey, nodeIds: NodeID[]): void {
    logInteraction(this.interactionTracker, { type: "promote", simplexKey, nodeIds, weight: 0.8 });
    this.onInteraction?.(this.interactionTracker);
  }

  logDissolve(simplexKey: SimplexKey, nodeIds: NodeID[]): void {
    logInteraction(this.interactionTracker, { type: "dissolve", simplexKey, nodeIds, weight: -0.5 });
    this.onInteraction?.(this.interactionTracker);
  }

  logCreate(nodeIds: NodeID[]): void {
    logInteraction(this.interactionTracker, { type: "create", nodeIds, weight: 0.6 });
    this.onInteraction?.(this.interactionTracker);
  }

  getFocusState(): FocusState {
    const activeNodeIds = new Set<NodeID>();
    const activeSimplexKeys = new Set<SimplexKey>();
    const activeHyperedgeKeys = new Set<RelationKey>();
    const targetNode = this.lockedNodeId ?? this.hoveredNodeId;
    if (targetNode) {
      activeNodeIds.add(targetNode);
      this.model.getSimplicesForNode(targetNode).forEach((simplex) => {
        activeSimplexKeys.add(normalizeKey(simplex.nodes));
        simplex.nodes.forEach((nodeId) => activeNodeIds.add(nodeId));
      });
      this.model.getHyperedgesForNode(targetNode).forEach((hyperedge) => {
        activeHyperedgeKeys.add(relationKey("hyperedge", hyperedge.nodes));
        hyperedge.nodes.forEach((nodeId) => activeNodeIds.add(nodeId));
      });
    }
    if (this.hoveredSimplexKey) {
      activeSimplexKeys.add(this.hoveredSimplexKey);
      this.model.getSimplex(this.hoveredSimplexKey)?.nodes.forEach((nodeId) => activeNodeIds.add(nodeId));
    }
    if (this.hoveredHyperedgeKey) {
      activeHyperedgeKeys.add(this.hoveredHyperedgeKey);
      this.model.getHyperedge(this.hoveredHyperedgeKey)?.nodes.forEach((nodeId) => activeNodeIds.add(nodeId));
    }

    const involvesRelation = (relation: HigherOrderRelation, key?: RelationKey): boolean => {
      if (relation.kind === "hyperedge") {
        const hyperedgeKey = key ?? relationKey("hyperedge", relation.nodes);
        return activeHyperedgeKeys.has(hyperedgeKey) || relation.nodes.some((nodeId) => activeNodeIds.has(nodeId));
      }
      const simplexKey = key ?? normalizeKey(relation.nodes);
      return activeSimplexKeys.has(simplexKey) || relation.nodes.some((nodeId) => activeNodeIds.has(nodeId));
    };

    return {
      isActive: activeNodeIds.size > 0 || activeSimplexKeys.size > 0 || activeHyperedgeKeys.size > 0,
      lockedNodeId: this.lockedNodeId,
      hoveredNodeId: this.hoveredNodeId,
      hoveredSimplexKey: this.hoveredSimplexKey,
      hoveredHyperedgeKey: this.hoveredHyperedgeKey,
      activeNodeIds,
      activeSimplexKeys,
      activeHyperedgeKeys,
      involvesNode: (nodeId: NodeID) => activeNodeIds.has(nodeId),
      involvesSimplex: (simplex: Simplex, key?: SimplexKey) => involvesRelation({ kind: "simplex", ...simplex }, key),
      involvesRelation,
    };
  }

  updateHover(mx: number, my: number, nodes: LayoutNode[], hoverDelayMs = 1000): void {
    this.onWake?.();
    const nextHovered = nodes.find((node) => (node.px - mx) ** 2 + (node.py - my) ** 2 <= 400)?.id ?? null;
    if (nextHovered !== this.hoveredNodeId) {
      this.hoveredNodeId = nextHovered;
      this.scheduleHoverIntent(hoverDelayMs);
    }
  }

  clearFocus(): void {
    this.clearHoverIntent();
    this.hoveredNodeId = null;
    this.hoveredSimplexKey = null;
    this.hoveredHyperedgeKey = null;
    this.lockedNodeId = null;
    this.onSelection?.(null);
  }

  focusHoveredNode(): void {
    this.lockedNodeId = this.hoveredNodeId;
  }

  onMousedown(nodeId: NodeID, mx: number, my: number): void {
    const node = this.model.nodes.get(nodeId);
    if (!node) return;
    this.pressedNodeId = nodeId;
    this.draggingNodeId = null;
    this.draggedNodeWasPinned = node.isPinned;
    this.dragOffsetX = mx - node.px;
    this.dragOffsetY = my - node.py;
    this.pressX = mx;
    this.pressY = my;
    this.movedDuringPointerDown = false;
    this.holdTimer = window.setTimeout(() => {
      this.holdNode = nodeId;
      this.onWake?.();
    }, 200);
  }

  onPointerMove(mx: number, my: number): boolean {
    if (!this.pressedNodeId) return false;
    const node = this.model.nodes.get(this.pressedNodeId);
    if (!node) return false;
    const movement = (mx - this.pressX) ** 2 + (my - this.pressY) ** 2;
    if (movement > 1) {
      this.clearHoldTimer();
      this.holdNode = null;
    }
    const movedEnough = movement > 1;
    if (movedEnough) {
      this.movedDuringPointerDown = true;
      this.draggingNodeId = this.pressedNodeId;
    }
    if (!this.draggingNodeId) return false;
    this.hoveredNodeId = this.draggingNodeId;
    this.model.setPinnedState(
      this.draggingNodeId,
      this.draggedNodeWasPinned,
      mx - this.dragOffsetX,
      my - this.dragOffsetY,
    );
    const dragged = this.model.nodes.get(this.draggingNodeId);
    if (dragged) {
      dragged.vx = 0;
      dragged.vy = 0;
    }
    this.onWake?.();
    return true;
  }

  onMouseup(): boolean {
    const didDrag = this.movedDuringPointerDown && !!this.draggingNodeId;
    this.clearHoldTimer();
    this.pressedNodeId = null;
    this.draggingNodeId = null;
    this.draggedNodeWasPinned = false;
    this.movedDuringPointerDown = false;
    this.holdNode = null;
    if (didDrag) {
      this.onWake?.();
    }
    return didDrag;
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  cancelHoverSelection(): void {
    this.clearHoverIntent();
  }

  togglePin(nodeId: NodeID): boolean {
    const node = this.model.nodes.get(nodeId);
    if (!node) return false;
    this.model.setPinnedState(nodeId, !node.isPinned, node.px, node.py);
    this.onWake?.();
    this.onPinnedStateChanged?.();
    return !node.isPinned;
  }

  selectSimplex(simplexKey: string | null): void {
    this.clearHoverIntent();
    this.hoveredSimplexKey = simplexKey;
    this.hoveredHyperedgeKey = null;
    this.onSelection?.(simplexKey ? { kind: "simplex", key: simplexKey } : null);
    if (simplexKey) {
      const simplex = this.model.getSimplex(simplexKey);
      if (simplex) {
        logInteraction(this.interactionTracker, {
          type: "select",
          simplexKey,
          nodeIds: simplex.nodes,
          weight: 0.1,
        });
      }
    }
  }

  selectHyperedge(hyperedgeKey: RelationKey | null): void {
    this.clearHoverIntent();
    this.hoveredHyperedgeKey = hyperedgeKey;
    this.hoveredSimplexKey = null;
    this.onSelection?.(hyperedgeKey ? { kind: "hyperedge", key: hyperedgeKey } : null);
    if (hyperedgeKey) {
      const hyperedge = this.model.getHyperedge(hyperedgeKey);
      if (hyperedge) {
        logInteraction(this.interactionTracker, {
          type: "select",
          simplexKey: hyperedgeKey,
          nodeIds: hyperedge.nodes,
          weight: 0.1,
        });
      }
    }
  }

  selectRelation(selection: RelationSelection | null): void {
    if (!selection) {
      this.selectSimplex(null);
      return;
    }
    if (selection.kind === "hyperedge") this.selectHyperedge(selection.key);
    else this.selectSimplex(selection.key);
  }

  lerpAlpha(node: LayoutNode, focusState: FocusState): void {
    const targetAlpha = !focusState.isActive || focusState.involvesNode(node.id) ? 1 : 0.2;
    node.displayAlpha = lerp(node.displayAlpha, targetAlpha, 0.12);
  }

  private scheduleHoverIntent(hoverDelayMs: number): void {
    this.clearHoverIntent();
    if (!this.hoveredNodeId) {
      this.onHoverIntent?.(null);
      return;
    }
    this.hoverIntentTimer = window.setTimeout(() => {
      const simplex = this.model
        .getSimplicesForNode(this.hoveredNodeId!)
        .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))[0];
      const nextKey = simplex ? normalizeKey(simplex.nodes) : null;
      this.hoveredSimplexKey = nextKey;
      this.onHoverIntent?.(nextKey ? { kind: "simplex", key: nextKey } : null);
    }, hoverDelayMs);
  }

  private clearHoverIntent(): void {
    if (this.hoverIntentTimer !== null) {
      window.clearTimeout(this.hoverIntentTimer);
      this.hoverIntentTimer = null;
    }
  }
}
