import { parseYaml, stringifyYaml, TFile, type App } from "obsidian";
import { logger } from "../core/logger";
import { normalizeKey } from "../core/normalize";
import type { Hyperedge, PluginSettings, Simplex } from "../core/types";
import {
  parseManagedFrontmatter as parseManagedFrontmatterWith,
  serializeFrontmatter as serializeFrontmatterWith,
  updateManagedArray,
  type YamlCodec,
} from "./frontmatter";

const yamlCodec: YamlCodec = {
  parse: (source) => (parseYaml(source) as Record<string, unknown> | null) ?? null,
  stringify: (value) => stringifyYaml(value),
};

function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return serializeFrontmatterWith(frontmatter, body, yamlCodec);
}

function parseManagedFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  return parseManagedFrontmatterWith(content, yamlCodec);
}

function simplexToSerializable(simplex: Simplex): Record<string, unknown> {
  return {
    nodes: simplex.nodes,
    ...(simplex.label ? { label: simplex.label } : {}),
    ...(simplex.weight !== undefined ? { weight: simplex.weight } : {}),
  };
}

function hyperedgeToSerializable(hyperedge: Hyperedge): Record<string, unknown> {
  return {
    nodes: hyperedge.nodes,
    ...(hyperedge.label ? { label: hyperedge.label } : {}),
    ...(hyperedge.weight !== undefined ? { weight: hyperedge.weight } : {}),
    ...(hyperedge.mode ? { mode: hyperedge.mode } : {}),
    ...(hyperedge.occurredAt !== undefined ? { occurredAt: hyperedge.occurredAt } : {}),
    ...(hyperedge.persistence ? { persistence: hyperedge.persistence } : {}),
    ...(hyperedge.promotedTo ? { promotedTo: hyperedge.promotedTo } : {}),
    ...(hyperedge.crystallizedInto ? { crystallizedInto: hyperedge.crystallizedInto } : {}),
  };
}

function updateSimplexArray(
  frontmatter: Record<string, unknown>,
  simplexKey: string,
  nextEntry?: Record<string, unknown>,
): Record<string, unknown> {
  return updateManagedArray(frontmatter, "simplices", simplexKey, nextEntry);
}

function updateHyperedgeArray(
  frontmatter: Record<string, unknown>,
  nodeKey: string,
  nextEntry?: Record<string, unknown>,
): Record<string, unknown> {
  return updateManagedArray(frontmatter, "hyperedges", nodeKey, nextEntry);
}

export async function writeSimplexToSourceNote(app: App, file: TFile, simplex: Simplex): Promise<string> {
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  const key = normalizeKey(simplex.nodes);
  updateSimplexArray(frontmatter, key, simplexToSerializable(simplex));
  const simplexCount = Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0;
  logger.info("persistence", "Prepared source-note write", {
    mode: "source-note",
    file: file.path,
    simplexKey: key,
    simplexCount,
  });
  return serializeFrontmatter(frontmatter, body);
}

export async function writeHyperedgeToSourceNote(app: App, file: TFile, hyperedge: Hyperedge): Promise<string> {
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  const key = normalizeKey(hyperedge.nodes);
  updateHyperedgeArray(frontmatter, key, hyperedgeToSerializable(hyperedge));
  logger.info("persistence", "Prepared source-note hyperedge write", {
    mode: "source-note",
    file: file.path,
    nodeKey: key,
    hyperedgeCount: Array.isArray(frontmatter.hyperedges) ? frontmatter.hyperedges.length : 0,
  });
  return serializeFrontmatter(frontmatter, body);
}

export async function writeHyperedgeToCentralFile(
  app: App,
  centralFile: string,
  hyperedge: Hyperedge,
): Promise<{ file: TFile; content: string }> {
  const file = await ensureCentralFile(app, centralFile);
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  const key = normalizeKey(hyperedge.nodes);
  frontmatter.managedBy = "simplicial-complex";
  updateHyperedgeArray(frontmatter, key, hyperedgeToSerializable(hyperedge));
  const nextContent = serializeFrontmatter(frontmatter, body || "<!-- managed by Simplicial Complex plugin -->\n");
  logger.info("persistence", "Prepared central-file hyperedge write", {
    mode: "central-file",
    file: file.path,
    nodeKey: key,
    hyperedgeCount: Array.isArray(frontmatter.hyperedges) ? frontmatter.hyperedges.length : 0,
  });
  return { file, content: nextContent };
}

export async function removeHyperedgeFromManagedFile(app: App, file: TFile, nodeKey: string): Promise<string> {
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  updateHyperedgeArray(frontmatter, nodeKey);
  logger.info("persistence", "Prepared hyperedge removal", {
    file: file.path,
    nodeKey,
    remainingHyperedgeCount: Array.isArray(frontmatter.hyperedges) ? frontmatter.hyperedges.length : 0,
  });
  return serializeFrontmatter(frontmatter, body);
}

export async function ensureCentralFile(app: App, centralFile: string): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(centralFile);
  if (existing instanceof TFile) return existing;
  const initial = [
    "---",
    "managedBy: simplicial-complex",
    "simplices: []",
    "hyperedges: []",
    "---",
    "",
    "<!-- managed by Simplicial Complex plugin -->",
    "",
  ].join("\n");
  const file = await app.vault.create(centralFile, initial);
  logger.info("persistence", "Created central file", { path: centralFile });
  return file;
}

export async function writeSimplexToCentralFile(
  app: App,
  centralFile: string,
  simplex: Simplex,
): Promise<{ file: TFile; content: string }> {
  const file = await ensureCentralFile(app, centralFile);
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  const key = normalizeKey(simplex.nodes);
  frontmatter.managedBy = "simplicial-complex";
  updateSimplexArray(frontmatter, key, simplexToSerializable(simplex));
  const simplexCount = Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0;
  const nextContent = serializeFrontmatter(frontmatter, body || "<!-- managed by Simplicial Complex plugin -->\n");
  logger.info("persistence", "Prepared central-file write", {
    mode: "central-file",
    file: file.path,
    simplexKey: key,
    simplexCount,
  });
  return { file, content: nextContent };
}

export async function removeSimplexFromManagedFile(app: App, file: TFile, simplexKey: string): Promise<string> {
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  updateSimplexArray(frontmatter, simplexKey);
  logger.info("persistence", "Prepared simplex removal", {
    file: file.path,
    simplexKey,
    remainingSimplexCount: Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0,
  });
  return serializeFrontmatter(frontmatter, body);
}

export async function readCentralFileState(
  app: App,
  centralFile: string,
): Promise<{
  exists: boolean;
  path: string;
  length: number;
}> {
  const file = app.vault.getAbstractFileByPath(centralFile);
  if (!(file instanceof TFile)) {
    logger.warn("persistence", "Central file does not exist", {
      mode: "central-file",
      path: centralFile,
    });
    return { exists: false, path: centralFile, length: 0 };
  }
  const content = await app.vault.read(file);
  logger.info("persistence", "Central file state", {
    mode: "central-file",
    path: centralFile,
    exists: true,
    length: content.length,
  });
  return { exists: true, path: file.path, length: content.length };
}

export function getDefaultSettings(): PluginSettings {
  return {
    domainSource: "hybrid",
    contentClusterCount: 8,
    enableBettiComputation: false,
    bettiDisplayOnCanvas: true,
    maxBettiDim: 2,
    showFiltrationSlider: true,
    enableExplanationPanel: true,
    enableInteractionReinforcement: true,
    reinforcementStrength: 0.05,
    persistenceMode: "source-note",
    centralFile: "_simplicial.md",
    showEdges: true,
    showClusters: true,
    showCores: true,
    maxRenderedDim: 12,
    noiseAmount: 0.12,
    sleepThreshold: 0.01,
    repulsionStrength: 2400,
    cohesionStrength: 0.005,
    gravityStrength: 0.0007,
    dampingFactor: 0.84,
    boundaryPadding: 50,
    darkMode: "auto",
    inferenceMode: "hybrid",
    inferenceEmits: "simplex",
    insightThreshold: 0.45,
    linkStrengthThreshold: 0.4,
    linkThresholdLowerBound: 0.0,
    linkThresholdUpperBound: 1.0,
    closureThreshold: 0.25,
    tagRarityThreshold: 0.05,
    decayHalfLifeDays: 90,
    decayMinimumWeight: 0.1,
    minDomainsForTriangle: 2,
    minDomainsForTetra: 2,
    minRolesForTetra: 2,
    roleDiversityWeight: 0.2,
    domainDiversityWeight: 0.25,
    actionBonus: 0.3,
    rareTagWeight: 0.15,
    commonTagPenalty: 0.12,
    linkGraphBaseline: true,
    enableInferredEdges: true,
    inferenceThreshold: 0.12,
    enableLinkInference: true,
    enableMutualLinkBonus: true,
    enableSharedTags: true,
    enableTitleOverlap: true,
    enableContentOverlap: true,
    enableSameFolderInference: true,
    enableSameTopFolderInference: true,
    linkWeight: 0.25,
    mutualLinkBonus: 0.25,
    sharedTagWeight: 0.08,
    titleOverlapWeight: 0.18,
    contentOverlapWeight: 0.16,
    sameFolderWeight: 0.08,
    sameTopFolderWeight: 0.04,
    showSuggestions: true,
    suggestionThreshold: 0.34,
    commandSimplexSize: 3,
    commandAutoOpenPanel: true,
    metadataHoverDelayMs: 1000,
    formalMode: true,
    sparseEdgeLength: 150,
    sparseGravityBoost: 1.8,
    labelDensity: 0.42,
    renderFilterMetric: "weight",
    renderFilterThreshold: 0.1,
    pinnedNodes: {},
    showHyperedges: true,
    hyperedgeOpacity: 0.55,
    enableHyperedgePulse: true,
    encounterRecurrenceThreshold: 3,
    crystallizeFolder: "",
    historyFile: "_simplicial-history.md",
    enableRelationHistory: true,
    enableDynamicsLab: false,
    activationDecayHalfLifeMinutes: 30,
    sheaf: { contexts: [], sections: {} },
    enableEncounterSuggestions: true,
    encounterSuggestionThreshold: 0.55,
    maxEncounterSuggestions: 20,
    discoveryNoticeShown: false,
  };
}
