import { ItemView, WorkspaceLeaf } from "obsidian";
import { SimplicialModel } from "../core/model";
import type { PluginSettings, RenderFilterMetric } from "../core/types";
import { VIEW_TYPE_SIMPLICIAL } from "../core/types";
import { Renderer } from "../render/renderer";
import { computeFiltrationEvents, getEventThresholds, type FiltrationEvent } from "../core/filtration";
import type { RelationHistory } from "../core/history";

export interface SimplicialViewActions {
  recordEncounter: () => void;
  openContextuality: () => void;
  findExpressiveView: () => Promise<void>;
}

export class SimplicialView extends ItemView {
  private filtrationEvents: FiltrationEvent[] = [];
  private eventMarkers: HTMLElement[] = [];

  private onRescan?: (_reason: string, _delayMs: number) => void;

  constructor(
    leaf: WorkspaceLeaf,
    private model: SimplicialModel,
    private renderer: Renderer,
    private settings: PluginSettings,
    private onSettingsChanged: () => void,
    onRescan?: (_reason: string, _delayMs: number) => void,
    private actions?: SimplicialViewActions,
    private history?: RelationHistory,
  ) {
    super(leaf);
    this.onRescan = onRescan;
    this.computeFiltrationEvents();
    this.model.subscribe(() => {
      this.computeFiltrationEvents();
    });
  }

  setRescanCallback(callback: (_reason: string, _delayMs: number) => void): void {
    this.onRescan = callback;
  }

  private computeFiltrationEvents(): void {
    if (!this.settings.showFiltrationSlider) {
      // Hide slider if disabled
      if (this.sliderWrap) {
        this.sliderWrap.addClass("simplicial-hidden");
      }
      return;
    }
    // Show slider if enabled
    if (this.sliderWrap) {
      this.sliderWrap.removeClass("simplicial-hidden");
    }
    this.filtrationEvents = computeFiltrationEvents(this.model, this.settings.renderFilterMetric);
    this.updateEventMarkers();
  }

  refreshSettings(): void {
    this.computeFiltrationEvents();
  }

  getViewType(): string {
    return VIEW_TYPE_SIMPLICIAL;
  }

  getDisplayText(): string {
    return "Simplicial graph";
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("simplicial-view");
    const canvasWrap = contentEl.createDiv({ cls: "simplicial-view-wrap" });
    const hud = contentEl.createDiv({ cls: "simplicial-hud" });
    const legend = contentEl.createDiv({ cls: "simplicial-legend" });
    this.renderFiltrationControls(hud);
    this.renderLegend(legend);
    const filters = contentEl.createDiv({ cls: "simplicial-filters" });
    this.addFilterToggle(
      filters,
      "edges",
      () => this.settings.showEdges,
      (value) => (this.settings.showEdges = value),
    );
    this.addFilterToggle(
      filters,
      "clusters",
      () => this.settings.showClusters,
      (value) => (this.settings.showClusters = value),
    );
    this.addFilterToggle(
      filters,
      "cores",
      () => this.settings.showCores,
      (value) => (this.settings.showCores = value),
    );

    // Add floating canvas controls
    this.renderFloatingControls(contentEl);
    this.renderExploreActions(contentEl);

    this.renderer.init(canvasWrap);
  }

  private renderExploreActions(container: HTMLElement): void {
    if (!this.actions) return;

    const explore = container.createDiv({ cls: "simplicial-explore" });
    const copy = explore.createDiv({ cls: "simplicial-explore-copy" });
    copy.createSpan({ cls: "simplicial-explore-title", text: "Explore" });
    copy.createSpan({
      cls: "simplicial-explore-hint",
      text: "Discover groups, then review what the plugin suggests",
    });

    const discover = explore.createEl("button", {
      cls: "simplicial-explore-action mod-cta",
      text: "Find expressive view",
    });
    discover.title =
      "Turn on all evidence sources, choose balanced discovery thresholds, and reveal suggested links, groups, and encounters. Missing-face display stays off. Nothing is confirmed or written to notes.";
    discover.setAttr("aria-label", discover.title);
    discover.addEventListener(
      "click",
      () =>
        void (async () => {
          discover.disabled = true;
          discover.setText("Discovering…");
          try {
            await this.actions?.findExpressiveView();
          } finally {
            discover.disabled = false;
            discover.setText("Find expressive view");
          }
        })(),
    );

    const encounter = explore.createEl("button", {
      cls: "simplicial-explore-action",
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- Already sentence case; the rule counts the ◇ glyph as the first word.
      text: "◇ Record encounter",
    });
    encounter.title = "Record several notes as one meaningful group; this does not imply pairwise links.";
    encounter.setAttr("aria-label", encounter.title);
    encounter.addEventListener("click", () => this.actions?.recordEncounter());

    const contextuality = explore.createEl("button", {
      cls: "simplicial-explore-action",
      text: "Contextuality",
    });
    contextuality.title = "Compare overlapping groups to find interpretations that cannot be reconciled globally.";
    contextuality.setAttr("aria-label", contextuality.title);
    contextuality.addEventListener("click", () => this.actions?.openContextuality());

    this.renderJourneyReplay(explore);
  }

  private renderJourneyReplay(container: HTMLElement): void {
    const events = this.history?.all().sort((a, b) => a.timestamp - b.timestamp) ?? [];
    if (events.length === 0) return;
    const wrap = container.createDiv({ cls: "simplicial-replay" });
    const label = wrap.createSpan({ cls: "simplicial-replay-label", text: "Now" });
    const slider = wrap.createEl("input", { type: "range" });
    slider.min = "0";
    slider.max = String(events.length);
    slider.step = "1";
    slider.value = String(events.length);
    slider.title = "Replay relational history";
    const update = (): void => {
      const index = Number(slider.value);
      if (index === events.length) {
        this.renderer.setReplayState(null);
        label.setText("Now");
        return;
      }
      const event = events[index];
      const state = this.history!.replayAt(event.timestamp);
      this.renderer.setReplayState(state);
      label.setText(
        `${new Date(event.timestamp).toLocaleDateString()} · ${state.simplices.size} simplex · ${state.hyperedges.size} encounter`,
      );
    };
    slider.addEventListener("input", update);
    const live = wrap.createEl("button", { text: "Live" });
    live.addEventListener("click", () => {
      slider.value = String(events.length);
      update();
    });
  }

  async onClose(): Promise<void> {
    await Promise.resolve();
    this.renderer.setReplayState(null);
    this.renderer.destroy();
  }

  private addFilterToggle(
    container: HTMLElement,
    label: string,
    getValue: () => boolean,
    setValue: (_value: boolean) => void,
  ): void {
    const button = container.createEl("button", {
      cls: `simplicial-filter ${getValue() ? "is-on" : ""}`,
      text: label,
    });
    button.addEventListener("click", () => {
      const next = !getValue();
      setValue(next);
      button.toggleClass("is-on", next);
      this.onSettingsChanged();
      this.renderer.render();
    });
  }

  private sliderWrap: HTMLElement | null = null;
  private sliderEl: HTMLInputElement | null = null;

  private renderFiltrationControls(container: HTMLElement): void {
    this.sliderWrap = container.createDiv({ cls: "simplicial-filtration" });

    // Header with label and value
    const header = this.sliderWrap.createDiv({ cls: "simplicial-filtration-header" });
    header.createSpan({ text: "Filter" });
    const valueEl = header.createSpan({
      cls: "simplicial-filtration-value",
      text: this.settings.renderFilterThreshold.toFixed(3),
    });

    // Metric select dropdown
    const metricSelect = this.sliderWrap.createEl("select", { cls: "simplicial-filtration-metric" });
    const metrics: Array<{ value: RenderFilterMetric; label: string }> = [
      { value: "weight", label: "weight" },
      { value: "confidence", label: "confidence" },
      { value: "decayed-weight", label: "decayed" },
    ];
    metrics.forEach((metric) => {
      const option = metricSelect.createEl("option", { text: metric.label });
      option.value = metric.value;
      option.selected = this.settings.renderFilterMetric === metric.value;
    });

    // Dual slider container
    const sliderContainer = this.sliderWrap.createDiv({ cls: "simplicial-filtration-sliders" });

    // Coarse slider (0 to 1, step 0.1)
    const coarseRow = sliderContainer.createDiv({ cls: "simplicial-slider-row" });
    coarseRow.createSpan({ text: "Range", cls: "simplicial-slider-label" });
    const coarseSlider = coarseRow.createEl("input", {
      type: "range",
      cls: "simplicial-filtration-slider coarse",
    });
    coarseSlider.min = "0";
    coarseSlider.max = "1";
    coarseSlider.step = "0.1";
    coarseSlider.value = String(Math.round(this.settings.renderFilterThreshold * 10) / 10);

    // Fine slider (±0.05 around coarse, step 0.001)
    const fineRow = sliderContainer.createDiv({ cls: "simplicial-slider-row" });
    fineRow.createSpan({ text: "Fine", cls: "simplicial-slider-label" });
    const fineSlider = fineRow.createEl("input", {
      type: "range",
      cls: "simplicial-filtration-slider fine",
    });
    fineSlider.min = "-0.05";
    fineSlider.max = "0.05";
    fineSlider.step = "0.001";
    fineSlider.value = "0";

    // Store reference for updates
    this.sliderEl = coarseSlider;

    let coarseValue = Number(coarseSlider.value);
    let fineOffset = 0;

    const updateValue = (): number => {
      let value = coarseValue + fineOffset;
      value = Math.max(0, Math.min(1, value));
      valueEl.setText(value.toFixed(3));
      this.settings.renderFilterThreshold = value;
      this.onSettingsChanged();
      this.renderer.render();
      return value;
    };

    coarseSlider.addEventListener("input", () => {
      coarseValue = Number(coarseSlider.value);
      fineOffset = 0;
      fineSlider.value = "0";
      updateValue();
    });

    fineSlider.addEventListener("input", () => {
      fineOffset = Number(fineSlider.value);
      updateValue();
    });

    fineSlider.addEventListener("change", () => {
      const currentValue = coarseValue + fineOffset;
      if (currentValue <= 0 || currentValue >= 1) {
        coarseValue = Math.max(0, Math.min(1, currentValue));
        coarseSlider.value = String(Math.round(coarseValue * 10) / 10);
        fineOffset = 0;
        fineSlider.value = "0";
      }
    });

    metricSelect.addEventListener("change", () => {
      this.settings.renderFilterMetric = metricSelect.value as RenderFilterMetric;
      this.onSettingsChanged();
      this.renderer.render();
      this.computeFiltrationEvents();
    });

    // Add initial event markers
    this.updateEventMarkers();
  }

  private renderFloatingControls(container: HTMLElement): void {
    const controlsWrap = container.createDiv({ cls: "simplicial-floating-controls" });

    // Toggle button
    const toggleBtn = controlsWrap.createDiv({ cls: "simplicial-controls-toggle" });
    toggleBtn.setText("⚙");
    toggleBtn.title = "Open organized canvas settings";

    // Controls panel
    const panel = controlsWrap.createDiv({ cls: "simplicial-controls-panel" });

    panel.createDiv({ cls: "simplicial-controls-title", text: "Canvas settings" });
    panel.createDiv({
      cls: "simplicial-controls-help",
      text: "Changes apply immediately. Suggested relations remain unconfirmed until you accept them.",
    });

    const guide = panel.createEl("details", { cls: "simplicial-control-guide" });
    guide.createEl("summary", { text: "How to read encounters and contextuality" });
    guide.createEl("p", {
      text: "An encounter is a dashed enclosure around notes you want to treat as one group. It does not claim that every pair is linked. Record one yourself, or enable encounter suggestions and click a proposed enclosure to review it.",
    });
    guide.createEl("p", {
      text: "Contextuality compares overlapping groups as different viewpoints. Open the lab, add suggested context seeds, assign local roles, and read the report. It may find agreement, a direct disagreement, or a contradiction that appears only when all viewpoints are combined.",
    });

    const discovery = this.addControlSection(panel, "Discovery", true);

    // Link Threshold - Dual slider (coarse + fine) with configurable bounds
    this.addDualSlider(
      discovery,
      "Link selectivity",
      this.settings.linkStrengthThreshold,
      (value) => {
        this.settings.linkStrengthThreshold = value;
        this.onSettingsChanged();
        this.onRescan?.("canvas-link-threshold-changed", 100);
      },
      this.settings.linkThresholdLowerBound,
      this.settings.linkThresholdUpperBound,
      (lower, upper) => {
        this.settings.linkThresholdLowerBound = lower;
        this.settings.linkThresholdUpperBound = upper;
        this.onSettingsChanged();
      },
    );

    // Insight Threshold
    this.addCanvasSlider(discovery, "Group confidence", this.settings.insightThreshold, 0, 1, 0.05, (value) => {
      this.settings.insightThreshold = value;
      this.onSettingsChanged();
      this.onRescan?.("canvas-insight-threshold-changed", 100);
    });

    // Suggestion Threshold
    this.addCanvasSlider(
      discovery,
      "Visible suggestion",
      this.settings.suggestionThreshold,
      0.2,
      0.95,
      0.05,
      (value) => {
        this.settings.suggestionThreshold = value;
        this.onSettingsChanged();
        this.renderer.render();
      },
    );

    this.addCanvasToggle(discovery, "Infer links", this.settings.enableLinkInference, (value) => {
      this.settings.enableLinkInference = value;
      this.onSettingsChanged();
      this.onRescan?.("canvas-link-inference-changed", 100);
    });
    this.addCanvasToggle(discovery, "Suggest encounters", this.settings.enableEncounterSuggestions, (value) => {
      this.settings.enableEncounterSuggestions = value;
      this.onSettingsChanged();
      this.onRescan?.("canvas-encounter-discovery-changed", 100);
    });
    this.addCanvasSlider(
      discovery,
      "Encounter confidence",
      this.settings.encounterSuggestionThreshold,
      0.4,
      0.95,
      0.05,
      (value) => {
        this.settings.encounterSuggestionThreshold = value;
        this.onSettingsChanged();
        this.onRescan?.("canvas-encounter-threshold-changed", 100);
      },
    );

    const visibility = this.addControlSection(panel, "What is shown", true);

    // Betti Toggle
    this.addCanvasToggle(visibility, "Show missing faces (unavailable)", false, () => undefined, true);

    // Show Suggestions Toggle
    this.addCanvasToggle(visibility, "Suggested relations", this.settings.showSuggestions, (value) => {
      this.settings.showSuggestions = value;
      this.onSettingsChanged();
      this.renderer.render();
    });

    this.addCanvasToggle(visibility, "Encounter enclosures", this.settings.showHyperedges, (value) => {
      this.settings.showHyperedges = value;
      this.onSettingsChanged();
      this.renderer.render();
    });

    const physics = this.addControlSection(panel, "Layout", false);

    // Repulsion Strength
    this.addCanvasSlider(physics, "Node spacing", this.settings.repulsionStrength, 200, 6000, 100, (value) => {
      this.settings.repulsionStrength = value;
      this.onSettingsChanged();
      // Physics changes need engine reconfigure
    });

    // Gravity Strength (very small values, 0.0001 to 0.02)
    this.addCanvasSlider(physics, "Center pull", this.settings.gravityStrength, 0.0001, 0.02, 0.0001, (value) => {
      this.settings.gravityStrength = value;
      this.onSettingsChanged();
    });

    const actions = this.addControlSection(panel, "Actions", true);

    const expressiveRow = actions.createDiv({ cls: "simplicial-control-row" });
    const expressiveBtn = expressiveRow.createEl("button", {
      cls: "simplicial-control-button",
      text: "Find expressive view",
    });
    expressiveBtn.title = "Reveal a balanced, suggestion-only view using all available evidence.";
    expressiveBtn.addEventListener(
      "click",
      () =>
        void (async () => {
          expressiveBtn.disabled = true;
          expressiveBtn.setText("Discovering…");
          try {
            await this.actions?.findExpressiveView();
          } finally {
            expressiveBtn.disabled = false;
            expressiveBtn.setText("Find expressive view");
          }
        })(),
    );

    // Rescan button
    const rescanRow = actions.createDiv({ cls: "simplicial-control-row" });
    const rescanBtn = rescanRow.createEl("button", { cls: "simplicial-control-button", text: "Rescan vault" });
    rescanBtn.addEventListener("click", () => {
      this.onRescan?.("manual-rescan", 0);
    });

    // Toggle panel visibility
    toggleBtn.addEventListener("click", () => {
      panel.toggleClass("simplicial-hidden", !panel.hasClass("simplicial-hidden"));
    });

    // Start hidden
    panel.addClass("simplicial-hidden");
  }

  private addControlSection(container: HTMLElement, label: string, open: boolean): HTMLElement {
    const details = container.createEl("details", { cls: "simplicial-control-section" });
    details.open = open;
    details.createEl("summary", { text: label });
    return details.createDiv({ cls: "simplicial-control-section-body" });
  }

  private addCanvasToggle(
    container: HTMLElement,
    label: string,
    initialValue: boolean,
    onChange: (_value: boolean) => void,
    disabled = false,
  ): void {
    const row = container.createDiv({
      cls: `simplicial-control-row${disabled ? " is-disabled" : ""}`,
    });
    row.createSpan({ text: label });
    const toggle = row.createEl("input", { type: "checkbox" });
    toggle.checked = initialValue;
    toggle.disabled = disabled;
    toggle.addEventListener("change", () => {
      onChange(toggle.checked);
    });
  }

  private addCanvasSlider(
    container: HTMLElement,
    label: string,
    initialValue: number,
    min: number,
    max: number,
    step: number,
    onChange: (_value: number) => void,
  ): void {
    const row = container.createDiv({ cls: "simplicial-control-row" });
    row.createSpan({ text: label });
    const slider = row.createEl("input", { type: "range" });
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initialValue);

    // Determine decimal places based on step size
    const decimalPlaces = step < 0.001 ? 4 : step < 0.01 ? 3 : 2;
    const valueDisplay = row.createSpan({ cls: "simplicial-control-value", text: initialValue.toFixed(decimalPlaces) });

    slider.addEventListener("input", () => {
      const value = Number(slider.value);
      valueDisplay.setText(value.toFixed(decimalPlaces));
      onChange(value);
    });
  }

  private addDualSlider(
    container: HTMLElement,
    label: string,
    initialValue: number,
    onChange: (_value: number) => void,
    lowerBound: number,
    upperBound: number,
    onBoundsChange?: (_lower: number, _upper: number) => void,
  ): void {
    const wrap = container.createDiv({ cls: "simplicial-dual-slider-wrap" });

    // Value display header
    const header = wrap.createDiv({ cls: "simplicial-dual-slider-header" });
    header.createSpan({ text: label });
    const valueDisplay = header.createSpan({ cls: "simplicial-control-value", text: initialValue.toFixed(4) });

    // Main range slider with step 0.01
    const sliderRow = wrap.createDiv({ cls: "simplicial-control-row" });
    sliderRow.createSpan({ text: "Range", cls: "simplicial-slider-label" });
    const slider = sliderRow.createEl("input", { type: "range" });
    slider.min = String(lowerBound);
    slider.max = String(upperBound);
    slider.step = "0.01";
    slider.value = String(initialValue);

    // Fine tuner slider (±0.05 around current value, step 0.001)
    const fineRow = wrap.createDiv({ cls: "simplicial-control-row" });
    fineRow.createSpan({ text: "Fine", cls: "simplicial-slider-label" });
    const fineSlider = fineRow.createEl("input", { type: "range" });
    fineSlider.min = "-0.05";
    fineSlider.max = "0.05";
    fineSlider.step = "0.001";
    fineSlider.value = "0";

    let currentValue = initialValue;
    let fineOffset = 0;

    const updateValue = (): number => {
      const value = Math.max(lowerBound, Math.min(upperBound, currentValue + fineOffset));
      valueDisplay.setText(value.toFixed(4));
      onChange(value);
      return value;
    };

    slider.addEventListener("input", () => {
      currentValue = Number(slider.value);
      fineOffset = 0;
      fineSlider.value = "0";
      updateValue();
    });

    fineSlider.addEventListener("input", () => {
      fineOffset = Number(fineSlider.value);
      updateValue();
    });

    onBoundsChange?.(lowerBound, upperBound);
  }

  private updateEventMarkers(): void {
    // Clear existing markers
    this.eventMarkers.forEach((m) => m.remove());
    this.eventMarkers = [];

    if (!this.sliderWrap || !this.sliderEl || this.filtrationEvents.length === 0) return;

    const thresholds = getEventThresholds(this.filtrationEvents);
    const sliderRect = this.sliderEl.getBoundingClientRect();
    if (sliderRect.width === 0) return; // Slider not rendered yet

    thresholds.forEach((threshold) => {
      const marker = this.sliderWrap!.createDiv({ cls: "simplicial-filtration-marker" });
      const percent = threshold * 100;
      marker.style.setProperty("left", `${percent}%`);
      marker.title = `Event at ${threshold.toFixed(2)}`;
      this.eventMarkers.push(marker);
    });
  }

  private renderLegend(container: HTMLElement): void {
    const items: Array<{ label: string; cls: string }> = [
      { label: "Link baseline", cls: "is-link" },
      { label: "Tag affinity", cls: "is-tag" },
      { label: "Folder affinity", cls: "is-folder" },
      { label: "Semantic overlap", cls: "is-semantic" },
      { label: "Soft cluster", cls: "is-cluster" },
      { label: "Confirmed simplex", cls: "is-confirmed" },
    ];
    items.forEach((item) => {
      const row = container.createDiv({ cls: "simplicial-legend-item" });
      row.createSpan({ cls: `simplicial-legend-swatch ${item.cls}` });
      row.createSpan({ text: item.label });
    });
  }
}
