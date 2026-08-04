import type { NodeID, SimplexKey } from "../core/types";

export interface CycleHighlight {
  intervalId: string;
  dimension: number;
  /** The chain's simplices, as stable keys. */
  simplexKeys: SimplexKey[];
  nodeIds: NodeID[];
}

/**
 * A surface that can draw a representative cycle.
 *
 * This interface is the entire seam between the barcode and whatever view is the primary
 * canvas. Today that is the full-vault force canvas (the recorded §13.2 decision, since it
 * is the only surface that exists). If the dense-vault plan later demotes it in favour of
 * bounded projections, the focused evidence map implements this interface and the link
 * moves — the barcode holds no reference to any particular view and does not change.
 */
export interface CycleHighlightTarget {
  setCycleHighlight(highlight: CycleHighlight | null): void;
}

/** Brush-linking in both directions, with neither side importing the other. */
export class CycleHighlightBus {
  private targets = new Set<CycleHighlightTarget>();
  private listeners = new Set<(intervalId: string | null) => void>();
  private current: CycleHighlight | null = null;

  registerTarget(target: CycleHighlightTarget): () => void {
    this.targets.add(target);
    target.setCycleHighlight(this.current);
    return () => {
      this.targets.delete(target);
      target.setCycleHighlight(null);
    };
  }

  /** Barcode → canvas. */
  highlight(highlight: CycleHighlight | null): void {
    this.current = highlight;
    this.targets.forEach((target) => target.setCycleHighlight(highlight));
  }

  /** Canvas → barcode. */
  select(intervalId: string | null): void {
    this.listeners.forEach((listener) => listener(intervalId));
  }

  onSelect(listener: (intervalId: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get highlighted(): CycleHighlight | null {
    return this.current;
  }
}
