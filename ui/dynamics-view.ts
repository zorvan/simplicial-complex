/* global window -- Allow window for the yield between simulation slices in the Obsidian/Electron environment (ESLint browser globals) */
import { ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import {
  KERNEL_NAMES,
  competingRhythms,
  synchronizationTime,
  type KernelName,
  type SynchronizationResult,
} from "../core/activation";
import { SimplicialModel } from "../core/model";
import type { RelationKey } from "../core/types";
import { VIEW_TYPE_SIMPLICIAL_DYNAMICS } from "../core/types";

const KERNEL_COPY: Record<KernelName, { title: string; claim: string }> = {
  pairwise: {
    title: "Pairwise",
    claim: "Attention flows along links, one note to one note.",
  },
  simplicial: {
    title: "Simplicial",
    claim: "Attention flows through coherent groups and every face they imply.",
  },
  hypergraph: {
    title: "Hypergraph",
    claim: "Attention flows through whole encounters, which are never decomposed.",
  },
};

interface EncounterRun {
  key: RelationKey;
  label: string;
  results: SynchronizationResult[];
}

/**
 * HG-21. The instrument.
 *
 * The same vault run under three models of how attention spreads, side by side.
 * The point is not any one number — it is that the three disagree, and that which
 * one matches how a vault actually behaves is now an empirical question rather than
 * an assumption baked into the renderer.
 *
 * Runs on demand and in bounded slices. Nothing here happens on the render loop.
 */
export class DynamicsLabView extends ItemView {
  private runs: EncounterRun[] = [];
  private isRunning = false;
  private lastRunAt: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private model: SimplicialModel,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SIMPLICIAL_DYNAMICS;
  }

  getDisplayText(): string {
    return "Dynamics lab";
  }

  getIcon(): string {
    return "activity";
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    this.render();
  }

  /**
   * Yielding between encounters keeps a large vault from freezing the window. The
   * simulation is bounded per encounter by `maxIterations`; this bounds the wall
   * clock across all of them.
   */
  private async run(): Promise<void> {
    if (this.isRunning) return;
    const keys = [...this.model.hyperedges.keys()];
    if (keys.length === 0) {
      new Notice("No encounters to run. Record one with ◇ first.");
      return;
    }

    this.isRunning = true;
    this.runs = [];
    this.render();

    for (const key of keys) {
      const hyperedge = this.model.getHyperedge(key);
      if (!hyperedge) continue;
      const results = KERNEL_NAMES.map((name) => synchronizationTime(this.model, key, name)).filter(
        (result): result is SynchronizationResult => result !== null,
      );
      this.runs.push({
        key,
        label: hyperedge.label?.trim() || hyperedge.nodes.map((id) => shortName(id)).join(" · "),
        results,
      });
      await yieldToWindow();
    }

    this.isRunning = false;
    this.lastRunAt = Date.now();
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("div", { cls: "simplicial-panel-title", text: "Dynamics lab" });
    contentEl.createEl("div", {
      cls: "simplicial-explanation-tension",
      text: "Three models of how attention spreads, run over the same vault. Where they disagree is where the shape of your notes is doing something a graph cannot describe.",
    });

    new Setting(contentEl)
      .setName("Run simulation")
      .setDesc(
        this.lastRunAt
          ? `Last run ${new Date(this.lastRunAt).toLocaleTimeString()} · ${this.runs.length} encounter${this.runs.length === 1 ? "" : "s"}.`
          : "Seeded and deterministic: the same vault gives the same answer every time.",
      )
      .addButton((button) => {
        button.setButtonText(this.isRunning ? "Running…" : "Run");
        button.setDisabled(this.isRunning);
        button.onClick(() => void this.run());
      });

    const legend = contentEl.createDiv({ cls: "simplicial-kernel-legend" });
    KERNEL_NAMES.forEach((name) => {
      const row = legend.createDiv({ cls: "simplicial-kernel-legend-row" });
      row.createEl("span", { cls: `simplicial-kernel-swatch is-${name}` });
      row.createEl("span", { cls: "simplicial-kernel-name", text: KERNEL_COPY[name].title });
      row.createEl("span", { cls: "simplicial-kernel-claim", text: KERNEL_COPY[name].claim });
    });

    if (this.runs.length === 0) {
      contentEl.createEl("div", {
        cls: "simplicial-panel-value",
        text: this.isRunning ? "Running…" : "Nothing run yet.",
      });
      return;
    }

    this.runs.forEach((run) => this.renderRun(contentEl, run));
    this.renderCompetingRhythms(contentEl);
  }

  private renderRun(contentEl: HTMLElement, run: EncounterRun): void {
    const card = contentEl.createDiv({ cls: "simplicial-dynamics-card" });
    card.createEl("div", { cls: "simplicial-panel-section-label", text: run.label });

    run.results.forEach((result) => {
      const row = card.createDiv({ cls: "simplicial-dynamics-row" });
      const head = row.createDiv({ cls: "simplicial-measure-head" });
      head.createEl("span", {
        cls: `simplicial-kernel-name is-${result.kernel}`,
        text: KERNEL_COPY[result.kernel].title,
      });
      head.createEl("span", {
        cls: "simplicial-measure-figure",
        // A kernel that never settled says so; reporting the cap would be a number
        // that looks like a measurement and is not one.
        text: result.converged ? `${result.iterations} iterations` : "did not settle",
      });
      this.renderTrace(row, result);
    });

    const settled = run.results.filter((result) => result.converged);
    if (settled.length > 1) {
      const fastest = settled.reduce((best, current) => (current.iterations! < best.iterations! ? current : best));
      const slowest = settled.reduce((worst, current) => (current.iterations! > worst.iterations! ? current : worst));
      if (fastest.kernel !== slowest.kernel) {
        card.createEl("div", {
          cls: "simplicial-measure-reading",
          text: `Settles fastest as a ${KERNEL_COPY[fastest.kernel].title.toLowerCase()} structure and slowest as a ${KERNEL_COPY[slowest.kernel].title.toLowerCase()} one.`,
        });
      }
    }
  }

  /** The order-parameter trace, drawn as bars so it needs no canvas and no library. */
  private renderTrace(container: HTMLElement, result: SynchronizationResult): void {
    const trace = container.createDiv({ cls: "simplicial-trace" });
    const sampleCount = 48;
    const stride = Math.max(1, Math.ceil(result.orderTrace.length / sampleCount));
    for (let index = 0; index < result.orderTrace.length; index += stride) {
      const value = Math.max(0, Math.min(1, result.orderTrace[index]));
      trace.createDiv({
        cls: `simplicial-trace-bar is-${result.kernel}`,
        attr: { style: `height: ${Math.max(2, Math.round(value * 100))}%;` },
      });
    }
  }

  private renderCompetingRhythms(contentEl: HTMLElement): void {
    // Compared within one kernel: the hypergraph one, because a rhythm belongs to
    // the encounter and comparing across kernels would compare two different claims.
    const hypergraphResults = this.runs
      .map((run) => run.results.find((result) => result.kernel === "hypergraph"))
      .filter((result): result is SynchronizationResult => result !== undefined);
    const competing = competingRhythms(hypergraphResults);
    if (competing.length === 0) return;

    const section = contentEl.createDiv({ cls: "simplicial-dynamics-card" });
    section.createEl("div", { cls: "simplicial-panel-section-label", text: "Competing rhythms" });
    competing.slice(0, 5).forEach((rhythm) => {
      section.createEl("div", {
        cls: "simplicial-measure-reading",
        text: `${rhythm.sharedNodes.map(shortName).join(" · ")} belongs to two encounters that settle ${rhythm.separation} iterations apart. It is being asked to move at two speeds.`,
      });
    });
  }
}

function shortName(nodeId: string): string {
  return nodeId.split("/").pop()?.replace(/\.md$/, "") ?? nodeId;
}

function yieldToWindow(): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
