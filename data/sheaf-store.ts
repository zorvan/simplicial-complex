import { TFile, type App } from "obsidian";
import { relationKey } from "../core/normalize.js";
import type { SimplicialModel } from "../core/model.js";
import { SHEAF_ROLES, contextSupport, type LocalSection, type SheafContext, type SheafData } from "../core/sheaf.js";
import type { SheafRole } from "../core/sheaf.js";
import type { NodeID, PluginSettings, RelationKey } from "../core/types.js";
import { extractRole } from "./inference/roles.js";
import type { NoteRole } from "./inference/types.js";

/**
 * `core/sheaf.ts` cannot import from `data/`, so it declares its own role alphabet.
 * This fails to compile the moment the two drift apart, which is the only guarantee
 * worth having: a sheaf built over a different alphabet than the one the inference
 * layer assigns would silently stop being about the same thing.
 */
type AssertSameRoles<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _rolesMatchInference: AssertSameRoles<SheafRole, NoteRole> = true;
void _rolesMatchInference;

/** Serializable form. Contexts live in plugin settings, never in a note. */
export interface StoredSheaf {
  contexts: SheafContext[];
  /** `contextId → nodeId → role`. Only divergences worth keeping; absent means backfill. */
  sections: Record<string, Record<NodeID, SheafRole>>;
}

export const EMPTY_SHEAF: StoredSheaf = { contexts: [], sections: {} };

function isRole(value: unknown): value is SheafRole {
  return typeof value === "string" && (SHEAF_ROLES as readonly string[]).includes(value);
}

export function readStoredSheaf(settings: PluginSettings): StoredSheaf {
  const stored = settings.sheaf;
  if (!stored || typeof stored !== "object") return EMPTY_SHEAF;
  const raw = stored as Partial<StoredSheaf>;
  const contexts = Array.isArray(raw.contexts) ? raw.contexts.filter(isStoredContext) : [];
  const sections: StoredSheaf["sections"] = {};
  Object.entries(raw.sections ?? {}).forEach(([contextId, roles]) => {
    if (!roles || typeof roles !== "object") return;
    const cleaned: Record<NodeID, SheafRole> = {};
    Object.entries(roles).forEach(([nodeId, role]) => {
      if (isRole(role)) cleaned[nodeId] = role;
    });
    sections[contextId] = cleaned;
  });
  return { contexts, sections };
}

/** Store only JSON-safe data in plugin settings; sheaf assignments never enter notes. */
export function writeStoredSheaf(settings: PluginSettings, stored: StoredSheaf): void {
  settings.sheaf = sanitizeStoredSheaf(stored);
}

function sanitizeStoredSheaf(stored: StoredSheaf): StoredSheaf {
  const contexts = stored.contexts.filter(isStoredContext).map((context) => ({
    ...context,
    relations: [...new Set(context.relations.filter((key): key is string => typeof key === "string"))].sort(),
  }));
  const sections: StoredSheaf["sections"] = {};
  contexts.forEach((context) => {
    const source = stored.sections[context.id] ?? {};
    sections[context.id] = Object.fromEntries(
      Object.entries(source).filter((entry): entry is [string, SheafRole] => isRole(entry[1])),
    );
  });
  return { contexts, sections };
}

function isStoredContext(value: unknown): value is SheafContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<SheafContext>;
  return (
    typeof context.id === "string" &&
    typeof context.name === "string" &&
    typeof context.definition === "string" &&
    ["folder", "tag", "query", "moc", "manual"].includes(context.source ?? "") &&
    Array.isArray(context.relations) &&
    context.relations.every((key) => typeof key === "string")
  );
}

/**
 * Turn stored contexts into a sheaf, filling any role the user has not overridden
 * from the vault-wide assignment.
 *
 * Backfill is what makes the degenerate case the *starting* case: a vault nobody
 * has diverged reports exactly what it reported before this layer existed.
 */
export function buildSheafData(
  model: SimplicialModel,
  stored: StoredSheaf,
  globalRoles: Map<NodeID, SheafRole>,
): SheafData {
  const sections = new Map<string, LocalSection>();
  stored.contexts.forEach((context) => {
    const overrides = stored.sections[context.id] ?? {};
    const section: LocalSection = new Map();
    contextSupport(model, context).forEach((nodeId) => {
      section.set(nodeId, overrides[nodeId] ?? globalRoles.get(nodeId) ?? "reference");
    });
    sections.set(context.id, section);
  });
  return { contexts: stored.contexts, sections };
}

/** The vault-wide role assignment the sheaf degenerates to. */
export function buildGlobalRoles(app: App, model: SimplicialModel): Map<NodeID, SheafRole> {
  const roles = new Map<NodeID, SheafRole>();
  model.nodes.forEach((_, nodeId) => {
    const file = app.vault.getAbstractFileByPath(nodeId);
    if (!(file instanceof TFile)) return;
    const cache = app.metadataCache.getFileCache(file);
    roles.set(nodeId, extractRole(file, cache, ""));
  });
  return roles;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "context"
  );
}

export function uniqueContextId(base: string, existing: SheafContext[]): string {
  const slug = slugify(base);
  const taken = new Set(existing.map((context) => context.id));
  if (!taken.has(slug)) return slug;
  let index = 2;
  while (taken.has(`${slug}-${index}`)) index++;
  return `${slug}-${index}`;
}

/**
 * Derive a context from a folder or tag.
 *
 * Offered as a *seed* the user then edits, never as the cover itself. A derived
 * cover mostly recovers the filing system, and the filing system is precisely the
 * thing this plugin exists to look past.
 */
export function deriveContext(
  app: App,
  model: SimplicialModel,
  source: "folder" | "tag",
  definition: string,
  existing: SheafContext[],
): SheafContext | null {
  const matches = (nodeId: NodeID): boolean => {
    if (source === "folder") return nodeId.startsWith(definition.replace(/\/*$/, "/"));
    const file = app.vault.getAbstractFileByPath(nodeId);
    if (!(file instanceof TFile)) return false;
    const cache = app.metadataCache.getFileCache(file);
    const tags = [
      ...(cache?.tags ?? []).map((entry) => entry.tag?.toLowerCase() ?? ""),
      ...toTagList(cache?.frontmatter?.tags),
    ];
    const wanted = definition.startsWith("#") ? definition.toLowerCase() : `#${definition.toLowerCase()}`;
    return tags.includes(wanted);
  };

  const relations: RelationKey[] = [];
  model.hyperedges.forEach((hyperedge, key) => {
    if (hyperedge.nodes.some(matches)) relations.push(key);
  });
  model.simplices.forEach((simplex) => {
    if (simplex.autoGenerated) return;
    if (simplex.nodes.some(matches)) relations.push(relationKey("simplex", simplex.nodes));
  });

  if (relations.length === 0) return null;
  return {
    id: uniqueContextId(definition, existing),
    name: definition,
    source,
    definition,
    relations: [...new Set(relations)].sort(),
  };
}

function toTagList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return list.map((tag) => `#${String(tag).replace(/^#/, "").toLowerCase()}`);
}
