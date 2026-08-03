import type { App, TFile } from "obsidian";
import type { RelationKey, RelationKind } from "./types.js";

export function normalizeNodeToken(nodeId: string): string {
  return nodeId.toLowerCase().trim();
}

export function normalizeKey(nodes: string[]): string {
  return [...nodes].map(normalizeNodeToken).sort().join("|");
}

const KIND_PREFIX: Record<RelationKind, string> = { simplex: "s", hyperedge: "h" };

/**
 * Kind-aware key. `normalizeKey({A,B,C})` is identical whether the relation is a
 * simplex or a hyperedge, and both are legitimately allowed to coexist, so every
 * map that holds both kinds must key on this instead.
 *
 * Simplex-only maps (`model.simplices` and everything persisted before v0.4.0)
 * keep using the bare `normalizeKey` — see the note on `RelationKey`.
 */
export function relationKey(kind: RelationKind, nodes: string[]): RelationKey {
  return `${KIND_PREFIX[kind]}:${normalizeKey(nodes)}`;
}

export function parseRelationKey(key: RelationKey): { kind: RelationKind; nodeKey: string } | null {
  const separator = key.indexOf(":");
  if (separator !== 1) return null;
  const prefix = key.slice(0, separator);
  if (prefix !== "s" && prefix !== "h") return null;
  return { kind: prefix === "s" ? "simplex" : "hyperedge", nodeKey: key.slice(separator + 1) };
}

export function isHyperedgeKey(key: string): boolean {
  return parseRelationKey(key)?.kind === "hyperedge";
}

export function normalizeNodes<T extends string>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => normalizeNodeToken(a).localeCompare(normalizeNodeToken(b)));
}

export function uniqueNodes<T extends string>(nodes: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const node of normalizeNodes(nodes)) {
    const token = normalizeNodeToken(node);
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(node);
  }
  return out;
}

let aliasIndex: Map<string, TFile> | null = null;
let aliasIndexGeneration = -1;
let vaultGeneration = 0;

/**
 * Drop the cached alias index. Called by the vault index whenever notes change, so
 * alias resolution never serves a stale answer.
 */
export function invalidateAliasIndex(): void {
  vaultGeneration++;
}

/**
 * Alias → file, built once per vault generation.
 *
 * This is the only place the plugin enumerates the vault for resolution purposes.
 * It used to run per unresolved token, walking every markdown file and reading its
 * metadata cache each time; a note with twenty unresolvable relation tokens meant
 * twenty full passes.
 */
function getAliasIndex(app: App): Map<string, TFile> {
  if (aliasIndex && aliasIndexGeneration === vaultGeneration) return aliasIndex;
  const index = new Map<string, TFile>();
  for (const file of app.vault.getMarkdownFiles()) {
    const aliases = app.metadataCache.getFileCache(file)?.frontmatter?.aliases as string[] | string | undefined;
    const aliasList = Array.isArray(aliases) ? aliases : typeof aliases === "string" ? [aliases] : [];
    aliasList.forEach((alias) => {
      const token = normalizeNodeToken(String(alias));
      if (token && !index.has(token)) index.set(token, file);
    });
  }
  aliasIndex = index;
  aliasIndexGeneration = vaultGeneration;
  return index;
}

export function resolveNodeId(rawId: string, sourcePath: string, app: App): TFile | null {
  const trimmed = rawId.trim();
  if (!trimmed) return null;
  const direct = app.metadataCache.getFirstLinkpathDest(trimmed, sourcePath);
  if (direct) return direct;
  return getAliasIndex(app).get(normalizeNodeToken(trimmed)) ?? null;
}
