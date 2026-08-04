import { ItemView, Setting, WorkspaceLeaf } from "obsidian";
import { SimplicialModel } from "../core/model";
import {
  DEFAULT_ANALYSIS_CONFIG,
  type TopologyAnalysisConfig,
  type TopologyAnalysisService,
  type TopologyAnalysisState,
} from "../core/topology/analysis-service";
import type { CycleRepresentative, PersistenceInterval } from "../core/topology/persistence-types";
import { VIEW_TYPE_SIMPLICIAL_PERSISTENCE, type PluginSettings } from "../core/types";
import { rankPersistentGaps, type PersistentGap } from "../data/inference/persistent-gaps";
import type { CycleHighlightBus } from "../render/cycle-highlight";

type Tab = "barcode" | "diagram";

/** Lane colours are dimension identity, not a scale. Kept in CSS; classes only here. */
const DIMENSION_LABEL: Record<number, string> = {
  0: "H₀ — connected pieces",
  1: "H₁ — loops",
  2: "H₂ — voids",
};

/**
 * PH-05. Barcode as the primary representation, persistence diagram as a second tab.
 *
 * Everything drawn here comes from one `PersistenceResult`. The view computes no topology
 * of its own — that is the rule that keeps the barcode, the filtration markers and the
 * panel from disagreeing about what is true.
 */
export class PersistenceView extends ItemView {
  private tab: Tab = "barcode";
  private showZeroLength = false;
  private selectedIntervalId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeSelect: (() => void) | null = null;
  private state: TopologyAnalysisState | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private model: SimplicialModel,
    private settings: PluginSettings,
    private service: TopologyAnalysisService,
    private highlightBus: CycleHighlightBus,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SIMPLICIAL_PERSISTENCE;
  }

  getDisplayText(): string {
    return "Persistence X-ray";
  }

  getIcon(): string {
    return "bar-chart-horizontal";
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    this.unsubscribe = this.service.subscribe((state) => {
      this.state = state;
      this.render();
    });
    // Canvas -> barcode, the other half of the brush link.
    this.unsubscribeSelect = this.highlightBus.onSelect((intervalId) => {
      this.selectedIntervalId = intervalId;
      this.render();
    });
    this.service.request(this.config());
  }

  async onClose(): Promise<void> {
    // Closing the view must not leave a stale computation able to apply its result.
    this.service.cancel();
    this.highlightBus.highlight(null);
    this.unsubscribe?.();
    this.unsubscribeSelect?.();
    await Promise.resolve();
  }

  refresh(): void {
    this.service.request(this.config());
  }

  private config(): TopologyAnalysisConfig {
    return {
      ...DEFAULT_ANALYSIS_CONFIG,
      metric: this.settings.renderFilterMetric ?? DEFAULT_ANALYSIS_CONFIG.metric,
      bootstrap: {
        ...DEFAULT_ANALYSIS_CONFIG.bootstrap,
        enabled: this.settings.enableBootstrapUncertainty ?? false,
        sampleCount: this.settings.bootstrapSampleCount ?? DEFAULT_ANALYSIS_CONFIG.bootstrap.sampleCount,
      },
      limits: {
        ...DEFAULT_ANALYSIS_CONFIG.limits,
        maxSimplices: this.settings.topologyMaxSimplices ?? DEFAULT_ANALYSIS_CONFIG.limits.maxSimplices,
      },
    };
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({ cls: "simplicial-panel-title", text: "Persistence X-ray" });
    contentEl.createDiv({
      cls: "simplicial-explanation-tension",
      text: "Which shapes in your vault survive as the evidence threshold moves. A long bar is a feature that does not depend on where you drew the line; a short one does.",
    });

    this.renderControls(contentEl);

    const state = this.state;
    if (!state || state.status === "idle") {
      contentEl.createDiv({ cls: "simplicial-panel-value", text: "Nothing computed yet." });
      return;
    }
    if (state.status === "running") {
      this.renderRunning(contentEl, state);
      return;
    }
    if (state.status === "failed" && state.failure) {
      this.renderFailure(contentEl, state);
      return;
    }
    const result = state.result;
    if (!result) return;

    this.renderProvenance(contentEl, state);

    const visible = result.intervals.filter(
      (interval) => this.showZeroLength || interval.lifetime === null || interval.lifetime > 0,
    );
    if (visible.length === 0) {
      contentEl.createDiv({
        cls: "simplicial-measure-reading",
        text: "No classes at any threshold. This vault's relations form a shape with nothing to persist — not an error, and not a claim that the notes are unrelated.",
      });
      return;
    }

    if (this.tab === "barcode") this.renderBarcode(contentEl, visible, result.representatives);
    else this.renderDiagram(contentEl, visible);

    this.renderGaps(contentEl);
  }

  private renderControls(container: HTMLElement): void {
    const tabs = container.createDiv({ cls: "simplicial-persistence-tabs" });
    (["barcode", "diagram"] as Tab[]).forEach((tab) => {
      const button = tabs.createEl("button", {
        cls: `simplicial-persistence-tab${this.tab === tab ? " is-active" : ""}`,
        text: tab === "barcode" ? "Barcode" : "Diagram",
      });
      button.setAttr("aria-pressed", String(this.tab === tab));
      button.onclick = () => {
        this.tab = tab;
        this.render();
      };
    });

    new Setting(container)
      .setName("Show zero-length bars")
      .setDesc(
        "Classes born and killed at the same threshold. Kept for verification; hidden by default because they describe the tie policy, not the vault.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.showZeroLength);
        toggle.onChange((value) => {
          this.showZeroLength = value;
          this.render();
        });
      });

    new Setting(container).addButton((button) => {
      button.setButtonText("Recompute");
      button.onClick(() => this.service.request(this.config()));
    });
  }

  private renderRunning(container: HTMLElement, state: TopologyAnalysisState): void {
    const phase = {
      building: "Building the filtered complex",
      reducing: "Reducing the boundary matrix",
      witnesses: "Collecting cycle witnesses",
      uncertainty: "Resampling for empirical stability",
    }[state.phase ?? "building"];
    container.createDiv({
      cls: "simplicial-measure-reading",
      text: `${phase}… ${Math.round(state.fraction * 100)}%`,
    });
    if (state.result) {
      container.createDiv({
        cls: "simplicial-panel-value",
        text: "The bars below are from the previous run and are stale until this finishes.",
      });
    }
    new Setting(container).addButton((button) => {
      button.setButtonText("Cancel");
      button.onClick(() => this.service.cancel());
    });
  }

  private renderFailure(container: HTMLElement, state: TopologyAnalysisState): void {
    const failure = state.failure;
    if (!failure) return;
    container.createDiv({ cls: "simplicial-panel-section-label", text: "Computation did not finish" });
    container.createDiv({ cls: "simplicial-measure-reading", text: failure.message });
    container.createDiv({
      cls: "simplicial-panel-value",
      text: `Phase: ${failure.phase} · ${failure.simplexCount.toLocaleString()} simplices over ${failure.vertexCount.toLocaleString()} notes.`,
    });
    new Setting(container).addButton((button) => {
      button.setButtonText(failure.reason === "engine-error" ? "Restart engine and retry" : "Retry");
      button.onClick(() => {
        if (failure.reason === "engine-error") this.service.restartWorker();
        this.service.request(this.config());
      });
    });
  }

  /** Metric, direction, field, threshold and repairs, stated rather than assumed. */
  private renderProvenance(container: HTMLElement, state: TopologyAnalysisState): void {
    const result = state.result;
    if (!result) return;
    const parts = [
      `metric ${result.metric}`,
      `${result.direction} filtration`,
      `coefficients ${result.coefficientField}`,
      `through H${result.maxDimension}`,
      `tie policy ${result.tiePolicy}`,
      state.execution === "worker"
        ? "computed off the main thread"
        : "computed on the main thread (no worker available)",
    ];
    container.createDiv({ cls: "simplicial-panel-value", text: parts.join(" · ") });

    if (result.repairs.length > 0) {
      const details = container.createEl("details", { cls: "simplicial-persistence-repairs" });
      details.createEl("summary", {
        text: `${result.repairs.length} filtration values were delayed to keep faces first`,
      });
      result.repairs.slice(0, 20).forEach((repair) => {
        details.createDiv({
          cls: "simplicial-panel-value",
          text: `${repair.simplexKey.split("|").join(" · ")} moved ${repair.rawValue.toFixed(2)} → ${repair.repairedValue.toFixed(2)} because of ${repair.faceKey.split("|").join(" · ")}`,
        });
      });
    }

    if (result.uncertainty) {
      container.createDiv({ cls: "simplicial-measure-reading", text: result.uncertainty.samplingScheme });
      container.createDiv({
        cls: "simplicial-panel-value",
        text: `${result.uncertainty.completedSamples} of ${result.uncertainty.requestedSamples} resamples completed${result.uncertainty.truncated ? " (budget reached)" : ""} · ${Math.round(result.uncertainty.unmatchedRate * 100)}% of resampled features had no counterpart in the full diagram. This is empirical stability, not a confidence band.`,
      });
    }
  }

  private renderBarcode(
    container: HTMLElement,
    intervals: PersistenceInterval[],
    representatives: CycleRepresentative[],
  ): void {
    const witnesses = new Map(representatives.map((entry) => [entry.intervalId, entry]));
    const span = extent(intervals);

    for (const dimension of [...new Set(intervals.map((interval) => interval.dimension))].sort()) {
      const lane = container.createDiv({ cls: "simplicial-barcode-lane" });
      lane.createDiv({
        cls: "simplicial-panel-section-label",
        text: DIMENSION_LABEL[dimension] ?? `H${dimension}`,
      });

      const list = lane.createEl("ul", { cls: "simplicial-barcode-list" });
      list.setAttr("role", "listbox");
      list.setAttr("aria-label", DIMENSION_LABEL[dimension] ?? `H${dimension}`);

      for (const interval of intervals.filter((entry) => entry.dimension === dimension)) {
        const witness = witnesses.get(interval.id);
        const row = list.createEl("li", {
          cls: `simplicial-barcode-row${this.selectedIntervalId === interval.id ? " is-selected" : ""}${interval.death === null ? " is-essential" : ""}`,
        });
        row.setAttr("role", "option");
        row.setAttr("tabindex", "0");
        row.setAttr("aria-selected", String(this.selectedIntervalId === interval.id));
        row.setAttr("aria-label", describeInterval(interval, witness));

        const track = row.createDiv({ cls: "simplicial-barcode-track" });
        const bar = track.createDiv({ cls: "simplicial-barcode-bar" });
        const start = span.size === 0 ? 0 : ((interval.birth - span.min) / span.size) * 100;
        const end =
          interval.death === null ? 100 : span.size === 0 ? 100 : ((interval.death - span.min) / span.size) * 100;
        bar.setAttr("style", `left:${start.toFixed(2)}%;width:${Math.max(1.5, end - start).toFixed(2)}%`);

        row.createSpan({ cls: "simplicial-barcode-caption", text: describeInterval(interval, witness) });

        const activate = () => this.select(interval, witness ?? null);
        row.onclick = activate;
        row.onfocus = activate;
        row.onkeydown = (event: KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate();
        };
      }
    }

    if (this.selectedIntervalId) this.renderWitness(container, intervals, witnesses);
  }

  private renderWitness(
    container: HTMLElement,
    intervals: PersistenceInterval[],
    witnesses: Map<string, CycleRepresentative>,
  ): void {
    const interval = intervals.find((entry) => entry.id === this.selectedIntervalId);
    if (!interval) return;
    const section = container.createDiv({ cls: "simplicial-persistence-witness" });
    section.createDiv({ cls: "simplicial-panel-section-label", text: "Representative cycle" });

    const witness = witnesses.get(interval.id);
    if (!witness) {
      section.createDiv({
        cls: "simplicial-measure-reading",
        text:
          interval.dimension === 0
            ? "Dimension 0 classes are connected pieces; the panel names components directly rather than returning a single-vertex witness."
            : "No witness was retained for this bar. Enable witness tracking and recompute to inspect one.",
      });
      return;
    }

    section.createDiv({
      cls: "simplicial-measure-reading",
      text: "One valid representative, not the only one and not the shortest. Another reduction of the same data would return a different cycle for the same class.",
    });
    witness.simplices.forEach((key) => {
      section.createDiv({ cls: "simplicial-panel-value", text: key.split("|").join(" · ") });
    });

    if (interval.deathSimplex) {
      section.createDiv({
        cls: "simplicial-measure-reading",
        text: `Killed at ${interval.death?.toFixed(2)} by ${interval.deathSimplex.split("|").join(" · ")}, which fills this class in.`,
      });
    }
  }

  private renderDiagram(container: HTMLElement, intervals: PersistenceInterval[]): void {
    const span = extent(intervals);
    const plot = container.createDiv({ cls: "simplicial-persistence-diagram" });
    plot.setAttr("role", "img");
    plot.setAttr(
      "aria-label",
      `Persistence diagram: ${intervals.length} classes. Points far from the diagonal persist across more of the filtration.`,
    );
    for (const interval of intervals) {
      const point = plot.createDiv({
        cls: `simplicial-diagram-point is-dim-${interval.dimension}${interval.death === null ? " is-essential" : ""}${this.selectedIntervalId === interval.id ? " is-selected" : ""}`,
      });
      const x = span.size === 0 ? 0 : ((interval.birth - span.min) / span.size) * 100;
      const y = interval.death === null ? 100 : span.size === 0 ? 100 : ((interval.death - span.min) / span.size) * 100;
      point.setAttr("style", `left:${x.toFixed(2)}%;bottom:${y.toFixed(2)}%`);
      point.setAttr("title", describeInterval(interval, undefined));
    }
    container.createDiv({
      cls: "simplicial-panel-value",
      text: "Essential classes are drawn at the top edge; they never die inside the analyzed complex and have no finite death coordinate.",
    });
  }

  private renderGaps(container: HTMLElement): void {
    const result = this.state?.result;
    if (!result) return;
    const gaps = rankPersistentGaps(this.model, result);
    const section = container.createDiv({ cls: "simplicial-persistence-gaps" });
    section.createDiv({ cls: "simplicial-panel-section-label", text: "Gaps to write" });
    if (gaps.length === 0) {
      section.createDiv({
        cls: "simplicial-measure-reading",
        text: "No loop cleared the lifetime and witness thresholds. Nothing here is a claim that your vault has no gaps — only that none met the stated bar.",
      });
      return;
    }
    gaps.forEach((gap) => this.renderGap(section, gap));
  }

  private renderGap(container: HTMLElement, gap: PersistentGap): void {
    const card = container.createDiv({ cls: "simplicial-gap-card" });
    card.createDiv({ cls: "simplicial-measure-reading", text: gap.explanation.claim });

    const breakdown = card.createEl("details");
    breakdown.createEl("summary", { text: "Why this ranked here" });
    Object.entries(gap.explanation.scoreComponents).forEach(([name, value]) => {
      breakdown.createDiv({
        cls: "simplicial-panel-value",
        text: `${humanize(name)}: ${value >= 0 ? "+" : ""}${value}`,
      });
    });

    const limits = card.createEl("details");
    limits.createEl("summary", { text: "What this does not prove" });
    gap.explanation.uncertainty.forEach((line) => {
      limits.createDiv({ cls: "simplicial-panel-value", text: line });
    });

    new Setting(card).addButton((button) => {
      button.setButtonText("Show on canvas");
      button.onClick(() => {
        this.selectedIntervalId = gap.intervalId;
        this.highlightBus.highlight({
          intervalId: gap.intervalId,
          dimension: 1,
          // The verified witness itself. Reassembling it from the authored and inferred
          // lists would silently drop any relation the model no longer holds.
          simplexKeys: gap.witnessKeys,
          nodeIds: gap.nodes,
        });
        this.render();
      });
    });
  }

  private select(interval: PersistenceInterval, witness: CycleRepresentative | null): void {
    this.selectedIntervalId = interval.id;
    this.highlightBus.highlight(
      witness
        ? {
            intervalId: interval.id,
            dimension: witness.dimension,
            simplexKeys: witness.simplices,
            nodeIds: [...new Set(witness.simplices.flatMap((key) => key.split("|")))],
          }
        : null,
    );
    this.render();
  }
}

function describeInterval(interval: PersistenceInterval, witness: CycleRepresentative | undefined): string {
  const life =
    interval.death === null
      ? `born ${interval.birth.toFixed(2)}, never dies`
      : `${interval.birth.toFixed(2)} → ${interval.death.toFixed(2)}`;
  const size = witness ? ` · ${witness.simplices.length} relations` : "";
  return `H${interval.dimension} ${life}${size}`;
}

function extent(intervals: PersistenceInterval[]): { min: number; max: number; size: number } {
  const values = intervals.flatMap((interval) => [
    interval.birth,
    ...(interval.death === null ? [] : [interval.death]),
  ]);
  if (values.length === 0) return { min: 0, max: 1, size: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, size: max - min };
}

function humanize(name: string): string {
  return name.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}
