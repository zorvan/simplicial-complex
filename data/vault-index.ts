/* global window -- Allow window for setTimeout/clearTimeout in Obsidian/Electron environment (ESLint browser globals) */
import { debounce, TFile, type App, type TAbstractFile } from "obsidian";
import { djb2Hash } from "../core/hash.js";
import { logger } from "../core/logger.js";
import { SimplicialModel } from "../core/model.js";
import { invalidateAliasIndex } from "../core/normalize.js";
import type { Hyperedge, PluginSettings } from "../core/types.js";
import { buildInferenceContext, inferSimplices, inferSimplicesLegacy, type InferenceContext } from "./inference.js";
import { runEmergentInferenceWithHoles } from "./inference/engine.js";
import { parseSimplices } from "./parser.js";

export class VaultIndex {
  private readonly fullScanChunkSize = 24;
  private readonly inferenceRebuildDelayMs = 40;
  private lastWrittenHash = new Map<string, number>();
  private fileSimplexKeys = new Map<string, Set<string>>();
  private inferenceContexts = new Map<string, InferenceContext>();
  private lastInferredSnapshot = "";
  private debouncedChange: (file: TFile) => void;
  private inferenceRebuildTimer: number | null = null;
  private inferenceRebuildPromise: Promise<void> | null = null;
  private resolveInferenceRebuild: (() => void) | null = null;

  constructor(
    private app: App,
    private model: SimplicialModel,
    private settings: PluginSettings,
    private onExternalChange?: () => void,
    /** Fires for every encounter read out of a note, so the event log can record recurrence. */
    private onEncounterParsed?: (_hyperedge: Hyperedge) => void,
  ) {
    this.debouncedChange = debounce(
      (file: TFile) => {
        void this.onFileChange(file);
      },
      100,
      true,
    );

    // Any note change can add, remove or move an alias, so the alias index is
    // dropped alongside the model update rather than being re-derived per lookup.
    this.app.vault.on("modify", (file) => {
      invalidateAliasIndex();
      if (file instanceof TFile) this.debouncedChange(file);
    });
    this.app.vault.on("create", (file) => {
      invalidateAliasIndex();
      if (file instanceof TFile) this.debouncedChange(file);
    });
    this.app.vault.on("delete", (file) => {
      invalidateAliasIndex();
      this.onFileDelete(file);
    });
    this.app.vault.on("rename", (file, oldPath) => {
      invalidateAliasIndex();
      if (file instanceof TFile) this.onFileRename(file, oldPath);
    });
  }

  /**
   * The per-note signal contexts the inference engine runs on. Exposed so the
   * hypergraph diagnostics can score encounter subgroups against exactly the same
   * evidence the simplicial layer is built from, rather than a second set of signals.
   */
  getInferenceContexts(): InferenceContext[] {
    return [...this.inferenceContexts.values()];
  }

  recordWrite(path: string, content: string): void {
    this.lastWrittenHash.set(path, djb2Hash(content));
    logger.debug("vault-index", "Recorded plugin write hash", {
      path,
      hash: this.lastWrittenHash.get(path),
    });
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.rebuildInferredSimplices();
  }

  /**
   * The relation history is machine-written, append-only and unbounded. Indexing it
   * would put a growing wall of JSON through the inference engine and add a node
   * nobody wrote. The central file is different — it holds real definitions.
   */
  private isPluginInternalFile(path: string): boolean {
    return path === this.settings.historyFile;
  }

  async fullScan(): Promise<void> {
    invalidateAliasIndex();
    const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isPluginInternalFile(file.path));
    logger.info("vault-index", "Starting full vault scan", {
      fileCount: files.length,
    });

    let chunk: Array<{ file: TFile; content: string }> = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      chunk.push({ file, content });
      if (chunk.length >= this.fullScanChunkSize) {
        this.flushFullScanChunk(chunk);
        chunk = [];
        await this.yieldToBrowser();
      }
    }
    if (chunk.length > 0) {
      this.flushFullScanChunk(chunk);
    }
    await this.scheduleInferenceRebuild(0);
    logger.info("vault-index", "Completed full vault scan", {
      fileCount: files.length,
      indexedNodeCount: this.model.nodes.size,
      simplexCount: this.model.simplices.size,
    });
  }

  private async onFileChange(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    if (this.isPluginInternalFile(file.path)) return;
    const content = await this.app.vault.read(file);
    const currentHash = djb2Hash(content);
    if (this.lastWrittenHash.get(file.path) === currentHash) {
      logger.debug("vault-index", "Suppressed self-triggered modify event", {
        path: file.path,
        hash: currentHash,
      });
      return;
    }
    logger.info("vault-index", "Processing changed file", {
      path: file.path,
      hash: currentHash,
    });
    this.processFile(file, content);
    await this.scheduleInferenceRebuild();
    this.onExternalChange?.();
  }

  private onFileDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    logger.info("vault-index", "File deleted", { path: file.path });
    this.inferenceContexts.delete(file.path);
    this.model.removeNode(file.path);
    this.model.replaceSourceRelations(file.path, [], []);
    void this.scheduleInferenceRebuild().then(() => this.onExternalChange?.());
  }

  private onFileRename(file: TFile, oldPath: string): void {
    logger.info("vault-index", "File renamed", {
      oldPath,
      newPath: file.path,
    });
    this.model.updateNodeId(oldPath, file.path);
    const oldKeys = this.fileSimplexKeys.get(oldPath);
    if (oldKeys) {
      this.fileSimplexKeys.set(file.path, oldKeys);
      this.fileSimplexKeys.delete(oldPath);
    }
    const context = this.inferenceContexts.get(oldPath);
    if (context) {
      this.inferenceContexts.set(file.path, { ...context, path: file.path });
      this.inferenceContexts.delete(oldPath);
    }
    void this.scheduleInferenceRebuild().then(() => this.onExternalChange?.());
  }

  private processFile(file: TFile, content: string): void {
    this.model.setNode(file.path, { isVirtual: false });
    const parsed = parseSimplices(content, file.path, this.app);
    this.model.replaceSourceRelations(file.path, parsed.simplices, parsed.hyperedges);
    this.fileSimplexKeys.set(file.path, new Set(parsed.simplices.map((simplex) => simplex.nodes.join("|"))));
    this.inferenceContexts.set(file.path, buildInferenceContext(this.app, file, content));
    parsed.hyperedges.forEach((hyperedge) => this.onEncounterParsed?.(hyperedge));
    logger.info("vault-index", "Indexed file", {
      path: file.path,
      parsedSimplexCount: parsed.simplices.length,
      parsedHyperedgeCount: parsed.hyperedges.length,
      parsedNodeCount: parsed.nodeIds.size,
      totalNodeCount: this.model.nodes.size,
      totalSimplexCount: this.model.simplices.size,
      totalHyperedgeCount: this.model.hyperedges.size,
    });
  }

  private flushFullScanChunk(chunk: Array<{ file: TFile; content: string }>): void {
    this.model.batch(() => {
      chunk.forEach(({ file, content }) => {
        this.processFile(file, content);
      });
    });
  }

  private async yieldToBrowser(): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  private scheduleInferenceRebuild(delayMs = this.inferenceRebuildDelayMs): Promise<void> {
    if (this.inferenceRebuildPromise === null) {
      this.inferenceRebuildPromise = new Promise<void>((resolve) => {
        this.resolveInferenceRebuild = resolve;
      });
    }
    if (this.inferenceRebuildTimer !== null) {
      window.clearTimeout(this.inferenceRebuildTimer);
    }
    this.inferenceRebuildTimer = window.setTimeout(() => {
      this.inferenceRebuildTimer = null;
      try {
        this.rebuildInferredSimplices();
      } finally {
        const resolve = this.resolveInferenceRebuild;
        this.resolveInferenceRebuild = null;
        this.inferenceRebuildPromise = null;
        resolve?.();
      }
    }, delayMs);
    return this.inferenceRebuildPromise;
  }

  private rebuildInferredSimplices(): void {
    let inferred: import("../core/types").Simplex[];

    // Use optimized path with cached Betti holes when enabled
    if (
      this.settings.enableBettiComputation &&
      (this.settings.inferenceMode === "emergent" || this.settings.inferenceMode === "hybrid")
    ) {
      const holes = this.model.getCachedBetti().holes;
      inferred = runEmergentInferenceWithHoles([...this.inferenceContexts.values()], this.settings, holes);

      // Add legacy inferences if in hybrid mode (only taxonomic/legacy, NOT emergent)
      if (this.settings.inferenceMode === "hybrid") {
        const legacy = inferSimplicesLegacy([...this.inferenceContexts.values()], this.settings);
        // Deduplicate by key
        const existingKeys = new Set(inferred.map((s) => s.nodes.sort().join("|")));
        const uniqueLegacy = legacy.filter((s) => !existingKeys.has(s.nodes.sort().join("|")));
        inferred.push(...uniqueLegacy);
      }
    } else {
      inferred = inferSimplices([...this.inferenceContexts.values()], this.settings);
    }

    const inferredEncounters: Hyperedge[] =
      this.settings.inferenceEmits === "hyperedge"
        ? inferred
            .filter((simplex) => simplex.nodes.length > 2)
            .map((simplex) => ({
              nodes: simplex.nodes,
              label: simplex.label,
              weight: simplex.weight,
              confidence: simplex.confidence,
              inferred: true,
              suggested: true,
            }))
        : [];
    const inferredSimplices =
      this.settings.inferenceEmits === "hyperedge" ? inferred.filter((simplex) => simplex.nodes.length <= 2) : inferred;
    this.model.replaceInferredSimplices(inferredSimplices);
    this.model.replaceInferredHyperedges(inferredEncounters);
    const snapshot = JSON.stringify({
      inferredSimplexCount: inferredSimplices.length,
      inferredEncounterCount: inferredEncounters.length,
      totalSimplexCount: this.model.simplices.size,
      totalNodeCount: this.model.nodes.size,
      enabled: this.settings.enableInferredEdges,
    });
    if (snapshot !== this.lastInferredSnapshot) {
      this.lastInferredSnapshot = snapshot;
      logger.debug("vault-index", "Updated inferred graph state", JSON.parse(snapshot) as Record<string, unknown>);
    }
  }

  destroy(): void {
    if (this.inferenceRebuildTimer !== null) {
      window.clearTimeout(this.inferenceRebuildTimer);
      this.inferenceRebuildTimer = null;
    }
    // Obsidian handles event cleanup via plugin registration scope.
  }
}
