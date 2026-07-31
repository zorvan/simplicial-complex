/* global activeDocument, window -- Allow document/window references for context menu and resize handling in Obsidian/Electron environment (ESLint browser globals) */
import { Menu, Notice, Plugin, TFile, type Editor, MarkdownView } from "obsidian";
import { SimplicialModel } from "./core/model";
import { normalizeKey, resolveNodeId } from "./core/normalize";
import { logger } from "./core/logger";
import { RelationHistory, syncEncounterPersistence, type RelationEventInput } from "./core/history";
import type { SubsetScorer } from "./core/diagnostics";
import { ActivationState, createKernel, propagate, type ActivationSource } from "./core/activation";
import { createSubsetScorer } from "./data/inference/subset-scorer";
import type { Hyperedge, PluginSettings, RelationKey, RelationSelection, Simplex } from "./core/types";
import { deserializeReinforcement, serializeReinforcement, type ReinforcementState } from "./data/interactions";
import { VIEW_TYPE_SIMPLICIAL, VIEW_TYPE_SIMPLICIAL_DYNAMICS, VIEW_TYPE_SIMPLICIAL_PANEL } from "./core/types";
import {
  ensureCentralFile,
  getDefaultSettings,
  removeHyperedgeFromManagedFile,
  removeSimplexFromManagedFile,
  readCentralFileState,
  writeHyperedgeToCentralFile,
  writeHyperedgeToSourceNote,
  writeSimplexToCentralFile,
  writeSimplexToSourceNote,
} from "./data/persistence";
import { HistoryStore } from "./data/history-store";
import { VaultIndex } from "./data/vault-index";
import { InteractionController } from "./interaction/controller";
import { LayoutEngine } from "./layout/engine";
import { Renderer } from "./render/renderer";
import { CreateSimplexModal, type RelationDraft } from "./ui/create-simplex-modal";
import { PromoteEncounterModal } from "./ui/promote-encounter-modal";
import { createPromotedNote, MetadataPanel } from "./ui/panel";
import { DynamicsLabView } from "./ui/dynamics-view";
import { SimplicialView } from "./ui/view";
import { SimplicialSettingTab } from "./settings/setting-tab";

export default class SimplicialPlugin extends Plugin {
  settings!: PluginSettings;
  model!: SimplicialModel;
  index!: VaultIndex;
  engine!: LayoutEngine;
  renderer!: Renderer;
  controller!: InteractionController;
  history!: RelationHistory;
  historyStore!: HistoryStore;
  panelView: MetadataPanel | null = null;
  simplicialView: SimplicialView | null = null;
  private saveTimer: number | null = null;
  private rescanTimer: number | null = null;
  /**
   * Rebuilt after each full scan. Building the raw signal graph is the expensive
   * part, so it happens once per scan rather than once per panel render.
   */
  private subsetScorer: SubsetScorer | null = null;
  /** HG-19. Ephemeral attention. Never written to a note; see `core/activation.ts`. */
  private activation = new ActivationState();
  private activationTimer: number | null = null;

  async onload(): Promise<void> {
    const saved = ((await this.loadData()) ?? {}) as Partial<PluginSettings>;
    this.settings = { ...getDefaultSettings(), ...saved };
    if (this.settings.maxRenderedDim === 3) {
      this.settings.maxRenderedDim = 12;
    }
    logger.info("plugin", "Loading plugin", {
      persistenceMode: this.settings.persistenceMode,
      centralFile: this.settings.centralFile,
      showEdges: this.settings.showEdges,
      showClusters: this.settings.showClusters,
      showCores: this.settings.showCores,
      pinnedNodeCount: Object.keys(this.settings.pinnedNodes).length,
    });
    this.model = new SimplicialModel();
    this.history = new RelationHistory();
    this.historyStore = new HistoryStore(this.app, this.settings.historyFile);
    if (this.settings.enableRelationHistory) {
      this.history.onAppend((event) => this.historyStore.record(event));
    }
    this.engine = new LayoutEngine();
    this.engine.configure({
      noiseAmount: this.settings.noiseAmount,
      sleepThreshold: this.settings.sleepThreshold,
      repulsionStrength: this.settings.repulsionStrength,
      cohesionStrength: this.settings.cohesionStrength,
      gravityStrength: this.settings.gravityStrength,
      dampingFactor: this.settings.dampingFactor,
      boundaryPadding: this.settings.boundaryPadding,
      sparseEdgeLength: this.settings.sparseEdgeLength,
      sparseGravityBoost: this.settings.sparseGravityBoost,
    });
    this.controller = new InteractionController(
      this.model,
      () => this.engine.wake(),
      (selection) => this.panelView?.setSelection(selection),
      (selection) => void this.openPanel(selection, false),
      () => this.queueSaveSettings(),
      (tracker) => this.saveInteractionState(tracker),
    );

    // Restore interaction state if exists
    const savedInteractions = this.settings.interactionState;
    if (savedInteractions) {
      this.controller.setInteractionTracker(deserializeReinforcement(savedInteractions));
    }
    this.renderer = new Renderer(this.model, this.engine, this.controller, this.settings, {
      onContextMenu: (target, event) => this.openCanvasContextMenu(target, event),
      onLassoCreate: (nodeIds) => void this.openCreateSimplexModal(nodeIds, nodeIds[0] ?? ""),
      onNodeOpen: (nodeId) => void this.openNodeNote(nodeId),
      onHoleHover: (hole, explanation) => {
        if (hole && explanation) {
          // Show subtle notice about the hole on hover
          const nodeNames = hole.boundaryNodes.map((id) => id.split("/").pop()?.replace(/\.md$/, "") ?? id);
          new Notice(`Hole: ${explanation.headline}\n${nodeNames.join(" · ")}`, 3000);
        }
      },
      onHoleClick: (hole, explanation) => {
        // On hole click, show a more prominent notice with the prompt
        const nodeNames = hole.boundaryNodes.map((id) => id.split("/").pop()?.replace(/\.md$/, "") ?? id);
        new Notice(`🕳️ ${explanation.headline}\n\nNotes: ${nodeNames.join(" · ")}\n\n${explanation.prompt}`, 8000);
      },
    });
    this.index = new VaultIndex(
      this.app,
      this.model,
      this.settings,
      () => this.engine.wake(),
      (hyperedge) => this.recordEncounter(hyperedge, "parser"),
    );

    this.restorePinnedNodes();

    this.registerView(VIEW_TYPE_SIMPLICIAL, (leaf) => {
      const view = new SimplicialView(
        leaf,
        this.model,
        this.renderer,
        this.settings,
        () => this.queueSaveSettings(),
        (reason, delayMs) => this.scheduleFullScan(reason, delayMs),
      );
      this.simplicialView = view;
      return view;
    });
    this.registerView(VIEW_TYPE_SIMPLICIAL_PANEL, (leaf) => {
      const panel = new MetadataPanel(leaf, this.model);
      panel.setActions({
        saveMetadata: (simplexKey, updates) => this.persistSimplexMetadata(simplexKey, updates),
        promoteSimplex: (simplexKey) => this.promoteSimplex(simplexKey),
        dissolveSimplex: (simplexKey) => this.dissolveSimplex(simplexKey),
        relaxSimplex: (simplexKey) => this.relaxSimplex(simplexKey),
        saveHyperedgeMetadata: (key, updates) => this.saveHyperedgeMetadata(key, updates),
        promoteEncounter: (key) => this.promoteEncounter(key),
        crystallizeEncounter: (key) => this.crystallizeEncounter(key),
        dissolveHyperedge: (key) => this.dissolveHyperedge(key),
      });
      panel.setHistory(this.history);
      panel.setSettings(this.settings);
      panel.setSubsetScorer(this.subsetScorer);
      this.panelView = panel;
      return panel;
    });

    if (this.settings.enableDynamicsLab) {
      this.registerView(VIEW_TYPE_SIMPLICIAL_DYNAMICS, (leaf) => new DynamicsLabView(leaf, this.model));
      this.addCommand({
        id: "open-dynamics-lab",
        name: "Open dynamics lab",
        callback: () => void this.activateDynamicsLab(),
      });
    }

    this.addRibbonIcon("network", "Simplicial graph", () => void this.activateView());
    this.addCommand({
      id: "open-simplicial",
      name: "Open simplicial graph",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "insert-simplex-symbol",
      name: "Insert triangle simplex marker",
      editorCallback: (editor: Editor) => editor.replaceSelection("\u25b3 "),
    });
    this.addCommand({
      id: "insert-hyperedge-symbol",
      name: "Insert encounter hyperedge marker",
      editorCallback: (editor: Editor) => editor.replaceSelection("◇ "),
    });
    this.addCommand({
      id: "form-simplex-from-open-note",
      name: "Simplicial: form simplex from open note",
      callback: () => void this.formSimplexFromOpenNote(),
    });
    this.addCommand({
      id: "create-encounter",
      name: "Simplicial: create encounter from open note",
      callback: () => void this.createEncounterFromOpenNote(),
    });
    this.addCommand({
      id: "toggle-edges",
      name: "Toggle simplicial edges",
      callback: () => {
        if (activeDocument.activeElement?.tagName === "INPUT" || activeDocument.activeElement?.tagName === "TEXTAREA")
          return;
        this.settings.showEdges = !this.settings.showEdges;
        void this.saveSettings();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "toggle-clusters",
      name: "Toggle simplicial clusters",
      callback: () => {
        if (activeDocument.activeElement?.tagName === "INPUT" || activeDocument.activeElement?.tagName === "TEXTAREA")
          return;
        this.settings.showClusters = !this.settings.showClusters;
        void this.saveSettings();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "toggle-cores",
      name: "Toggle simplicial cores",
      callback: () => {
        if (activeDocument.activeElement?.tagName === "INPUT" || activeDocument.activeElement?.tagName === "TEXTAREA")
          return;
        this.settings.showCores = !this.settings.showCores;
        void this.saveSettings();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "clear-simplicial-focus",
      name: "Clear simplicial focus",
      callback: () => {
        if (activeDocument.activeElement?.tagName === "INPUT" || activeDocument.activeElement?.tagName === "TEXTAREA") {
          (activeDocument.activeElement as HTMLElement).blur();
          return;
        }
        this.controller.clearFocus();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "focus-hovered-node",
      name: "Focus hovered simplicial node",
      callback: () => {
        if (activeDocument.activeElement?.tagName === "INPUT" || activeDocument.activeElement?.tagName === "TEXTAREA")
          return;
        this.controller.focusHoveredNode();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "open-hovered-simplex-panel",
      name: "Open metadata panel for hovered simplex",
      callback: () => {
        if (activeDocument.activeElement?.tagName === "INPUT" || activeDocument.activeElement?.tagName === "TEXTAREA")
          return;
        void this.openPanelForCurrentSelection();
      },
    });
    this.addSettingTab(new SimplicialSettingTab(this.app, this));

    this.activation.configure({ halfLifeMinutes: this.settings.activationDecayHalfLifeMinutes });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) this.registerActivation(file.path, "opened");
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) this.registerActivation(file.path, "edited");
      }),
    );

    this.model.subscribe(() => {
      this.engine.wake();
    });
    await this.logPersistenceState();
    if (this.settings.enableRelationHistory) {
      await this.historyStore.load(this.history);
      this.syncEncounterState();
    }
    this.scheduleFullScan("startup", 0);
    this.app.workspace.onLayoutReady(() => this.scheduleFullScan("layout-ready", 50));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleFullScan("metadata-resolved", 50)));
  }

  onunload(): void {
    if (this.rescanTimer !== null) window.clearTimeout(this.rescanTimer);
    if (this.activationTimer !== null) window.clearTimeout(this.activationTimer);
    logger.info("plugin", "Unloading plugin", {
      indexedNodeCount: this.model.nodes.size,
      simplexCount: this.model.simplices.size,
      hyperedgeCount: this.model.hyperedges.size,
      historyEventCount: this.history.size,
    });
    this.renderer.destroy();
    this.index.destroy();
  }

  private restorePinnedNodes(): void {
    logger.info("plugin", "Restoring pinned nodes", {
      pinnedNodeCount: Object.keys(this.settings.pinnedNodes).length,
    });
    Object.entries(this.settings.pinnedNodes).forEach(([nodeId, pos]) => {
      this.model.setNode(nodeId, { isPinned: true, px: pos.px, py: pos.py });
    });
  }

  async saveSettings(): Promise<void> {
    const pinned: PluginSettings["pinnedNodes"] = {};
    this.model.getAllNodes().forEach((node) => {
      if (node.isPinned) pinned[node.id] = { px: node.px, py: node.py };
    });
    this.settings.pinnedNodes = pinned;
    await this.saveData(this.settings);
    this.index?.updateSettings(this.settings);
    logger.info("plugin", "Saved persistence state", {
      persistenceMode: this.settings.persistenceMode,
      centralFile: this.settings.centralFile,
      pinnedNodeCount: Object.keys(this.settings.pinnedNodes).length,
      filters: {
        edges: this.settings.showEdges,
        clusters: this.settings.showClusters,
        cores: this.settings.showCores,
      },
      inference: {
        linkBaseline: this.settings.linkGraphBaseline,
        enabled: this.settings.enableInferredEdges,
        threshold: this.settings.inferenceThreshold,
        suggestions: this.settings.showSuggestions,
        suggestionThreshold: this.settings.suggestionThreshold,
      },
      layout: {
        repulsion: this.settings.repulsionStrength,
        cohesion: this.settings.cohesionStrength,
        gravity: this.settings.gravityStrength,
        damping: this.settings.dampingFactor,
        boundaryPadding: this.settings.boundaryPadding,
        sparseEdgeLength: this.settings.sparseEdgeLength,
        sparseGravityBoost: this.settings.sparseGravityBoost,
        labelDensity: this.settings.labelDensity,
        renderFilterMetric: this.settings.renderFilterMetric,
        renderFilterThreshold: this.settings.renderFilterThreshold,
      },
      commandUi: {
        simplexSize: this.settings.commandSimplexSize,
        autoOpenPanel: this.settings.commandAutoOpenPanel,
        metadataHoverDelayMs: this.settings.metadataHoverDelayMs,
        formalMode: this.settings.formalMode,
      },
    });
  }

  private queueSaveSettings(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 150);
  }

  private saveInteractionState(tracker: ReinforcementState): void {
    this.settings.interactionState = serializeReinforcement(tracker);
    this.queueSaveSettings();
  }

  async activateView(): Promise<void> {
    await this.app.workspace.getLeaf(true).setViewState({ type: VIEW_TYPE_SIMPLICIAL, active: true });
    const right = this.app.workspace.getRightLeaf(false);
    if (right) {
      await right.setViewState({ type: VIEW_TYPE_SIMPLICIAL_PANEL, active: false });
    }
  }

  async activateDynamicsLab(): Promise<void> {
    await this.app.workspace.getLeaf(true).setViewState({ type: VIEW_TYPE_SIMPLICIAL_DYNAMICS, active: true });
  }

  private async persistSimplexMetadata(
    simplexKey: string,
    updates: { label?: string; weight?: number },
  ): Promise<void> {
    logger.info("plugin", "Persisting simplex metadata", {
      simplexKey,
      updates,
      persistenceMode: this.settings.persistenceMode,
    });
    this.model.updateMetadata(simplexKey, updates);
    const simplex = this.model.getSimplex(simplexKey);
    if (!simplex?.sourcePath) {
      logger.warn("plugin", "Simplex has no sourcePath; only settings state will be saved", {
        simplexKey,
      });
      await this.saveSettings();
      return;
    }
    await this.persistSimplex(simplex);
    await this.saveSettings();
  }

  private formSimplexFromOpenNote(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) {
      new Notice("Open a note first.");
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const links = cache?.links?.map((link) => link.link) ?? [];
    const resolvedLinks = links
      .map((link) => this.app.metadataCache.getFirstLinkpathDest(link, file.path)?.path ?? link)
      .filter((path, index, all) => all.indexOf(path) === index);
    const desiredSize = Math.max(2, Math.min(6, this.settings.commandSimplexSize));
    const nodes = [file.path, ...resolvedLinks].slice(0, desiredSize);
    logger.info("plugin", "Form simplex from open note requested", {
      sourcePath: file.path,
      linkCount: links.length,
      desiredSize,
      proposedNodes: nodes,
    });
    if (nodes.length < desiredSize) {
      new Notice(`Need at least ${desiredSize - 1} resolvable outgoing links to form this simplex.`);
      return;
    }
    this.openCreateSimplexModal(nodes, file.path);
  }

  // --- hypergraph layer -----------------------------------------------------

  /**
   * Record that a configuration was encountered.
   *
   * A rescan is not a new encounter: re-reading the same `◇` line on every startup
   * would inflate recurrence into meaninglessness, so the parser only ever records
   * a set it has never seen. Deliberate user acts do record a repeat.
   */
  private recordEncounter(hyperedge: Hyperedge, actor: RelationEventInput["actor"]): void {
    const prior = this.history.occurrencesOf(hyperedge.nodes);
    if (actor === "parser" && prior.length > 0) return;
    this.history.append({
      type: prior.length > 0 ? "recurred" : "encountered",
      kind: "hyperedge",
      nodes: hyperedge.nodes,
      actor,
      ...(hyperedge.label || hyperedge.mode
        ? {
            detail: {
              ...(hyperedge.label ? { label: hyperedge.label } : {}),
              ...(hyperedge.mode ? { mode: hyperedge.mode } : {}),
            },
          }
        : {}),
    });
    this.syncEncounterState();
  }

  private syncEncounterState(): void {
    syncEncounterPersistence(this.model, this.history, this.settings.encounterRecurrenceThreshold);
  }

  /**
   * HG-19. Record that a note is in play and spread that to whatever it is in
   * relation with.
   *
   * The hypergraph kernel is the one used for emphasis, because that is the claim
   * this plugin makes about attention: it is a group being present at once, not a
   * signal walking along edges. The other two exist to be compared against it in
   * the Dynamics Lab, not to drive the canvas.
   */
  private registerActivation(nodeId: string, source: ActivationSource): void {
    if (!this.model.nodes.has(nodeId)) return;
    this.activation.register(nodeId, source);
    this.refreshActivation();
  }

  /**
   * Attention decays continuously, so the field is recomputed on a slow timer while
   * anything is still warm and then stops. There is nothing to persist and nothing
   * to clean up in a note — the state exists only for as long as the plugin runs.
   */
  private refreshActivation(): void {
    if (this.activationTimer !== null) window.clearTimeout(this.activationTimer);
    const seed = this.activation.field();
    const kernel = createKernel(this.model, "hypergraph");
    this.renderer.setActivation(propagate(kernel, seed, 3));
    this.engine.wake();
    if (seed.size === 0) return;
    this.activationTimer = window.setTimeout(() => {
      this.activationTimer = null;
      this.refreshActivation();
    }, 20000);
  }

  /** HG-12's evidence source. Absent until the vault has been scanned at least once. */
  private rebuildSubsetScorer(): void {
    const contexts = this.index.getInferenceContexts();
    this.subsetScorer = contexts.length > 0 ? createSubsetScorer(contexts, this.settings) : null;
    this.panelView?.setSubsetScorer(this.subsetScorer);
  }

  private createEncounterFromOpenNote(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) {
      new Notice("Open a note first.");
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const links = cache?.links?.map((link) => link.link) ?? [];
    const resolvedLinks = links
      .map((link) => this.app.metadataCache.getFirstLinkpathDest(link, file.path)?.path ?? link)
      .filter((path, index, all) => all.indexOf(path) === index);
    const nodes = [file.path, ...resolvedLinks];
    if (nodes.length < 2) {
      new Notice("Need at least one resolvable outgoing link to record an encounter.");
      return;
    }
    logger.info("plugin", "Create encounter from open note requested", {
      sourcePath: file.path,
      participantCount: nodes.length,
    });
    this.openCreateRelationModal(nodes, file.path, "hyperedge");
  }

  private async createHyperedge(draft: RelationDraft, sourcePath: string): Promise<RelationKey> {
    const nodes = draft.nodes.map((node) => this.resolveDraftNode(node, sourcePath));
    const owner = this.settings.persistenceMode === "central-file" ? this.settings.centralFile : sourcePath;
    const hyperedge: Hyperedge = {
      nodes,
      label: draft.label,
      weight: draft.weight,
      mode: draft.mode ?? "encounter",
      occurredAt: Date.now(),
      persistence: "momentary",
      sourcePath: owner,
    };
    const key = this.model.addHyperedge(hyperedge);
    if (!key) return "";
    this.recordEncounter({ ...hyperedge, nodes: this.model.getHyperedge(key)!.nodes }, "user");
    await this.persistHyperedge(this.model.getHyperedge(key)!);
    return key;
  }

  private async persistHyperedge(hyperedge: Hyperedge): Promise<void> {
    const shouldWriteCentral =
      hyperedge.sourcePath === this.settings.centralFile ||
      (!hyperedge.sourcePath && this.settings.persistenceMode === "central-file");
    if (shouldWriteCentral) {
      const { file, content } = await writeHyperedgeToCentralFile(this.app, this.settings.centralFile, {
        ...hyperedge,
        sourcePath: this.settings.centralFile,
      });
      await this.app.vault.modify(file, content);
      this.index.recordWrite(file.path, content);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(hyperedge.sourcePath ?? "");
    if (!(file instanceof TFile)) {
      logger.warn("plugin", "Unable to persist hyperedge to source note", {
        nodeKey: normalizeKey(hyperedge.nodes),
        sourcePath: hyperedge.sourcePath,
      });
      return;
    }
    const content = await writeHyperedgeToSourceNote(this.app, file, hyperedge);
    await this.app.vault.modify(file, content);
    this.index.recordWrite(file.path, content);
  }

  private async removeHyperedgeFromNote(hyperedge: Hyperedge): Promise<void> {
    const nodeKey = normalizeKey(hyperedge.nodes);
    const shouldWriteCentral =
      hyperedge.sourcePath === this.settings.centralFile ||
      (!hyperedge.sourcePath && this.settings.persistenceMode === "central-file");
    const file = shouldWriteCentral
      ? await ensureCentralFile(this.app, this.settings.centralFile)
      : this.app.vault.getAbstractFileByPath(hyperedge.sourcePath ?? "");
    if (!(file instanceof TFile)) return;
    const content = await removeHyperedgeFromManagedFile(this.app, file, nodeKey);
    await this.app.vault.modify(file, content);
    this.index.recordWrite(file.path, content);
  }

  /** HG-08. Always user-initiated, always confirmed — nothing promotes on its own. */
  private promoteEncounter(hyperedgeKey: RelationKey): void {
    const hyperedge = this.model.getHyperedge(hyperedgeKey);
    if (!hyperedge) return;
    const faces = this.model.facesImpliedByPromotion(hyperedgeKey);
    new PromoteEncounterModal(this.app, hyperedge.nodes, faces, async () => {
      const result = this.model.promoteToSimplex(hyperedgeKey);
      if (!result) return;
      this.history.append({
        type: "promoted",
        kind: "hyperedge",
        nodes: hyperedge.nodes,
        actor: "user",
        prior: { persistence: hyperedge.persistence ?? "momentary" },
        detail: { createdFaceCount: result.createdFaces.length },
      });
      const simplex = this.model.getSimplex(result.simplexKey);
      if (simplex) await this.persistSimplex(simplex);
      await this.persistHyperedge(this.model.getHyperedge(hyperedgeKey)!);
      this.controller.selectSimplex(result.simplexKey);
      await this.openPanel({ kind: "simplex", key: result.simplexKey }, false);
      new Notice(
        result.createdFaces.length > 0
          ? `Promoted. ${result.createdFaces.length} face${result.createdFaces.length === 1 ? "" : "s"} asserted.`
          : "Promoted. Every implied face already existed.",
      );
    }).open();
  }

  /** HG-09. Withdraws the closure claim; the group relation survives. */
  private async relaxSimplex(simplexKey: string): Promise<void> {
    const simplex = this.model.getSimplex(simplexKey);
    if (!simplex || simplex.autoGenerated) return;
    const hyperedgeKey = this.model.relaxToHyperedge(simplexKey);
    if (!hyperedgeKey) return;
    this.history.append({
      type: "relaxed",
      kind: "simplex",
      nodes: simplex.nodes,
      actor: "user",
      prior: { label: simplex.label ?? null, weight: simplex.weight ?? null },
    });

    const owner = this.app.vault.getAbstractFileByPath(simplex.sourcePath ?? "");
    if (owner instanceof TFile) {
      const content = await removeSimplexFromManagedFile(this.app, owner, simplexKey);
      await this.app.vault.modify(owner, content);
      this.index.recordWrite(owner.path, content);
    }
    await this.persistHyperedge(this.model.getHyperedge(hyperedgeKey)!);
    this.controller.selectHyperedge(hyperedgeKey);
    await this.openPanel({ kind: "hyperedge", key: hyperedgeKey }, false);
    new Notice("Relaxed to encounter. The group relation is kept; its faces are not asserted.");
  }

  /**
   * HG-10. A recurring encounter precipitates a concept note.
   *
   * It offers a follow-up encounter including the new concept, but never promotes:
   * repetition is evidence, not proof, of simplicial coherence.
   */
  private async crystallizeEncounter(hyperedgeKey: RelationKey): Promise<void> {
    const hyperedge = this.model.getHyperedge(hyperedgeKey);
    if (!hyperedge) return;
    const title = hyperedge.label?.trim() || `encounter-${normalizeKey(hyperedge.nodes).replace(/[|/]/g, "-")}`;
    const folder = this.settings.crystallizeFolder.replace(/\/+$/, "");
    const participants = hyperedge.nodes.map((nodeId) => `  - "[[${nodeId.replace(/\.md$/, "")}]]"`).join("\n");
    const body = [
      "---",
      "crystallizedFrom:",
      participants,
      `crystallizedAt: ${Date.now()}`,
      "---",
      "",
      `# ${title}`,
      "",
      "This note names a concept that emerged from a recurring encounter between:",
      "",
      ...hyperedge.nodes.map((nodeId) => `- [[${nodeId.replace(/\.md$/, "")}]]`),
      "",
      "The encounter is retained unpromoted — the triad recurring is evidence, not proof,",
      "that its pairs are meaningful on their own.",
      "",
    ].join("\n");

    const file = await createPromotedNote(this.app, folder ? `${folder}/${title}` : title, body);
    this.index.recordWrite(file.path, body);
    this.model.crystallizeHyperedge(hyperedgeKey, file.path);
    this.history.append({
      type: "crystallized",
      kind: "hyperedge",
      nodes: hyperedge.nodes,
      actor: "user",
      detail: { conceptNote: file.path },
    });
    await this.persistHyperedge(this.model.getHyperedge(hyperedgeKey)!);
    new Notice(`Crystallized into ${file.basename}. The encounter is unchanged.`);
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  private async dissolveHyperedge(hyperedgeKey: RelationKey): Promise<void> {
    const hyperedge = this.model.getHyperedge(hyperedgeKey);
    if (!hyperedge) return;
    await this.removeHyperedgeFromNote(hyperedge);
    this.model.removeHyperedge(hyperedgeKey);
    this.history.append({
      type: "dissolved",
      kind: "hyperedge",
      nodes: hyperedge.nodes,
      actor: "user",
      prior: { label: hyperedge.label ?? null, mode: hyperedge.mode ?? null },
    });
    this.controller.clearFocus();
    this.panelView?.setSelection(null);
    new Notice("Encounter dissolved. Its history is kept.");
  }

  private async saveHyperedgeMetadata(
    hyperedgeKey: RelationKey,
    updates: { label?: string; weight?: number; mode?: string },
  ): Promise<void> {
    const updated = this.model.updateHyperedge(hyperedgeKey, updates);
    if (!updated) return;
    await this.persistHyperedge(updated);
  }

  private async promoteSimplex(simplexKey: string): Promise<void> {
    const simplex = this.model.getSimplex(simplexKey);
    if (!simplex || simplex.autoGenerated) return;
    // Log interaction
    this.controller.logPromote(simplexKey, simplex.nodes);
    const noteTitle = simplex.label?.trim() || `simplex-${simplexKey.replace(/\|/g, "-")}`;
    const body = simplex.nodes.map((nodeId) => `- [[${nodeId.replace(/\.md$/, "")}]]`).join("\n");
    const promotedFile = await createPromotedNote(this.app, noteTitle, body);
    const nextSimplex: Simplex = {
      ...simplex,
      sourcePath: promotedFile.path,
      userDefined: true,
      inferred: false,
      suggested: false,
      autoGenerated: false,
    };

    if (simplex.sourcePath && simplex.sourcePath !== promotedFile.path) {
      const originalFile = this.app.vault.getAbstractFileByPath(simplex.sourcePath);
      if (originalFile instanceof TFile) {
        const nextOriginalContent = await removeSimplexFromManagedFile(this.app, originalFile, simplexKey);
        await this.app.vault.modify(originalFile, nextOriginalContent);
        this.index.recordWrite(originalFile.path, nextOriginalContent);
      }
    }

    const promotedContent = await writeSimplexToSourceNote(this.app, promotedFile, nextSimplex);
    await this.app.vault.modify(promotedFile, promotedContent);
    this.index.recordWrite(promotedFile.path, promotedContent);
    this.model.removeSimplex(simplexKey);
    const nextKey = this.model.addSimplex(nextSimplex);
    this.controller.selectSimplex(nextKey);
    await this.openPanel(nextKey, false);
    new Notice(`Simplex now owned by ${promotedFile.basename}.`);
  }

  private openCreateSimplexModal(nodes: string[], sourcePath: string): void {
    this.openCreateRelationModal(nodes, sourcePath, "simplex");
  }

  private openCreateRelationModal(nodes: string[], sourcePath: string, kind: "simplex" | "hyperedge"): void {
    const owner = this.settings.persistenceMode === "central-file" ? this.settings.centralFile : sourcePath;
    new CreateSimplexModal(
      this.app,
      nodes,
      owner,
      async (draft) => {
        if (draft.kind === "hyperedge") {
          const key = await this.createHyperedge(draft, sourcePath);
          if (!key) return;
          this.controller.selectHyperedge(key);
          if (this.settings.commandAutoOpenPanel) {
            await this.openPanel({ kind: "hyperedge", key }, false);
          }
          logger.info("plugin", "Encounter created from guided modal", {
            relationKey: key,
            sourcePath: owner,
            hyperedgeCount: this.model.hyperedges.size,
          });
          new Notice(
            this.settings.persistenceMode === "central-file"
              ? `Encounter added to ${this.settings.centralFile}. No faces were generated.`
              : "Encounter added to note frontmatter. No faces were generated.",
          );
          return;
        }

        const simplex: Simplex = {
          nodes: draft.nodes.map((node) => this.resolveDraftNode(node, sourcePath)),
          label: draft.label,
          weight: draft.weight,
          sourcePath: owner,
          userDefined: true,
          autoGenerated: false,
        };
        const key = this.model.addSimplex(simplex);
        await this.persistSimplex(this.model.getSimplex(key)!);
        this.history.append({ type: "created", kind: "simplex", nodes: simplex.nodes, actor: "user" });
        this.controller.selectSimplex(key);
        if (this.settings.commandAutoOpenPanel) {
          await this.openPanel(key, false);
        }
        logger.info("plugin", "Simplex created from guided modal", {
          simplexKey: key,
          sourcePath: simplex.sourcePath,
          simplexCount: this.model.simplices.size,
        });
        new Notice(
          this.settings.persistenceMode === "central-file"
            ? `Simplex added to ${this.settings.centralFile}.`
            : "Simplex added to note frontmatter.",
        );
      },
      kind,
    ).open();
  }

  private async openPanelForCurrentSelection(): Promise<void> {
    const simplexKey =
      this.controller.hoveredSimplexKey ??
      (this.controller.hoveredNodeId
        ? this.model.getSimplicesForNode(this.controller.hoveredNodeId)[0]?.nodes
          ? normalizeKey(this.model.getSimplicesForNode(this.controller.hoveredNodeId)[0].nodes)
          : null
        : null);
    await this.openPanel(simplexKey, true);
  }

  private async logPersistenceState(): Promise<void> {
    logger.info("plugin", "Persistence state", {
      mode: this.settings.persistenceMode,
      centralFile: this.settings.centralFile,
    });
    if (this.settings.persistenceMode === "central-file") {
      await readCentralFileState(this.app, this.settings.centralFile);
    } else {
      logger.info("persistence", "Source-note persistence active", {
        mode: this.settings.persistenceMode,
      });
    }
  }

  private async persistSimplex(simplex: Simplex): Promise<void> {
    const shouldWriteCentral =
      simplex.sourcePath === this.settings.centralFile ||
      (!simplex.sourcePath && this.settings.persistenceMode === "central-file");
    if (shouldWriteCentral) {
      const { file, content } = await writeSimplexToCentralFile(this.app, this.settings.centralFile, {
        ...simplex,
        sourcePath: this.settings.centralFile,
      });
      await this.app.vault.modify(file, content);
      this.index.recordWrite(file.path, content);
      logger.info("plugin", "Persisted simplex to central file", {
        simplexKey: normalizeKey(simplex.nodes),
        path: file.path,
      });
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(simplex.sourcePath ?? "");
    if (!(file instanceof TFile)) {
      logger.warn("plugin", "Unable to persist simplex to source note", {
        simplexKey: normalizeKey(simplex.nodes),
        sourcePath: simplex.sourcePath,
      });
      return;
    }
    const content = await writeSimplexToSourceNote(this.app, file, simplex);
    await this.app.vault.modify(file, content);
    this.index.recordWrite(file.path, content);
    logger.info("plugin", "Persisted simplex to source note", {
      simplexKey: normalizeKey(simplex.nodes),
      path: file.path,
    });
  }

  private openCanvasContextMenu(
    target: { nodeId?: string; simplexKey?: string; hyperedgeKey?: string },
    event: MouseEvent,
  ): void {
    const menu = new Menu();
    if (target.nodeId) {
      menu.addItem((item) =>
        item
          .setTitle("Open note")
          .setIcon("file-text")
          .onClick(() => void this.openNodeNote(target.nodeId!)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Focus node")
          .setIcon("crosshair")
          .onClick(() => {
            this.controller.hoveredNodeId = target.nodeId!;
            this.controller.focusHoveredNode();
            this.renderer.render();
          }),
      );
      menu.addItem((item) =>
        item
          .setTitle("Create simplex from node + neighbors")
          .setIcon("plus-circle")
          .onClick(() => void this.createSimplexFromNode(target.nodeId!)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Record encounter from node + neighbors")
          .setIcon("diamond")
          .onClick(() => void this.createEncounterFromNode(target.nodeId!)),
      );
      menu.addItem((item) =>
        item
          .setTitle(this.model.nodes.get(target.nodeId!)?.isPinned ? "Unpin node" : "Pin node")
          .setIcon("pin")
          .onClick(() => {
            this.controller.togglePin(target.nodeId!);
            this.renderer.render();
          }),
      );
    }
    if (target.simplexKey) {
      menu.addItem((item) =>
        item
          .setTitle("Open metadata")
          .setIcon("info")
          .onClick(() => void this.openPanel(target.simplexKey!, true)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Promote to note")
          .setIcon("up-right-from-square")
          .onClick(() => void this.promoteSimplex(target.simplexKey!)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Dissolve simplex")
          .setIcon("trash")
          .onClick(() => void this.dissolveSimplex(target.simplexKey!)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Relax to encounter")
          .setIcon("diamond")
          .onClick(() => void this.relaxSimplex(target.simplexKey!)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Show in formal view")
          .setIcon("sigma")
          .onClick(async () => {
            this.settings.formalMode = true;
            await this.saveSettings();
            this.controller.selectSimplex(target.simplexKey!);
            this.renderer.render();
          }),
      );
    }
    if (target.hyperedgeKey) {
      const hyperedge = this.model.getHyperedge(target.hyperedgeKey);
      menu.addItem((item) =>
        item
          .setTitle("Open encounter")
          .setIcon("info")
          .onClick(() => void this.openPanel({ kind: "hyperedge", key: target.hyperedgeKey! }, true)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Promote to simplex")
          .setIcon("triangle")
          .onClick(() => this.promoteEncounter(target.hyperedgeKey!)),
      );
      if (hyperedge?.persistence === "recurring") {
        menu.addItem((item) =>
          item
            .setTitle("Crystallize concept")
            .setIcon("sparkles")
            .onClick(() => void this.crystallizeEncounter(target.hyperedgeKey!)),
        );
      }
      menu.addItem((item) =>
        item
          .setTitle("Dissolve encounter")
          .setIcon("trash")
          .onClick(() => void this.dissolveHyperedge(target.hyperedgeKey!)),
      );
    }
    menu.showAtMouseEvent(event);
  }

  private async openNodeNote(nodeId: string): Promise<void> {
    const direct = this.app.vault.getAbstractFileByPath(nodeId);
    const file = direct instanceof TFile ? direct : resolveNodeId(nodeId, nodeId, this.app);
    if (!(file instanceof TFile)) {
      new Notice("This node is not backed by a note yet.");
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  private createSimplexFromNode(nodeId: string): void {
    const neighbors = this.model.getNeighbors(nodeId);
    const nodes = [nodeId, ...neighbors].slice(0, Math.max(2, this.settings.commandSimplexSize));
    if (nodes.length < 2) {
      new Notice("Need at least one connected neighbor to form a simplex.");
      return;
    }
    this.openCreateSimplexModal(nodes, nodeId);
  }

  private createEncounterFromNode(nodeId: string): void {
    const nodes = [nodeId, ...this.model.getNeighbors(nodeId)];
    if (nodes.length < 2) {
      new Notice("Need at least one connected neighbor to record an encounter.");
      return;
    }
    this.openCreateRelationModal(nodes, nodeId, "hyperedge");
  }

  private async dissolveSimplex(simplexKey: string): Promise<void> {
    const simplex = this.model.getSimplex(simplexKey);
    if (!simplex || simplex.autoGenerated) return;
    // Log interaction
    this.controller.logDissolve(simplexKey, simplex.nodes);
    const shouldWriteCentral =
      simplex.sourcePath === this.settings.centralFile ||
      (!simplex.sourcePath && this.settings.persistenceMode === "central-file");
    if (shouldWriteCentral) {
      const file = await ensureCentralFile(this.app, this.settings.centralFile);
      const content = await removeSimplexFromManagedFile(this.app, file, simplexKey);
      await this.app.vault.modify(file, content);
      this.index.recordWrite(file.path, content);
    } else {
      const sourcePath = simplex.sourcePath ?? "";
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof TFile)) return;
      const content = await removeSimplexFromManagedFile(this.app, file, simplexKey);
      await this.app.vault.modify(file, content);
      this.index.recordWrite(file.path, content);
    }
    this.model.removeSimplex(simplexKey);
    this.controller.clearFocus();
    this.panelView?.setSelection(null);
    logger.info("plugin", "Dissolved simplex", {
      simplexKey,
      persistenceMode: this.settings.persistenceMode,
    });
  }

  private async openPanel(selection: RelationSelection | string | null, active: boolean): Promise<void> {
    const right = this.app.workspace.getRightLeaf(false);
    if (!right) return;
    const normalized: RelationSelection | null =
      typeof selection === "string" ? { kind: "simplex", key: selection } : selection;
    await right.setViewState({ type: VIEW_TYPE_SIMPLICIAL_PANEL, active });
    this.panelView?.setSelection(normalized);
    logger.info("plugin", "Opened metadata panel", {
      kind: normalized?.kind ?? null,
      relationKey: normalized?.key ?? null,
      active,
    });
  }

  private resolveDraftNode(value: string, sourcePath: string): string {
    return this.app.metadataCache.getFirstLinkpathDest(value, sourcePath)?.path ?? value.trim();
  }

  scheduleFullScan(reason: string, delayMs: number): void {
    if (this.rescanTimer !== null) window.clearTimeout(this.rescanTimer);
    this.rescanTimer = window.setTimeout(async () => {
      this.rescanTimer = null;
      logger.info("plugin", "Running full scan", { reason });
      await this.index.fullScan();
      this.syncEncounterState();
      this.rebuildSubsetScorer();
      this.renderer.render();
      logger.info("plugin", "Full scan complete", {
        reason,
        indexedNodeCount: this.model.nodes.size,
        simplexCount: this.model.simplices.size,
      });
    }, delayMs);
  }
}
