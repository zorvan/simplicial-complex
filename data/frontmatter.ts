import { normalizeKey } from "../core/normalize.js";

export type ManagedArrayKey = "simplices" | "hyperedges";

export interface YamlCodec {
  parse(_source: string): Record<string, unknown> | null;
  stringify(_value: Record<string, unknown>): string;
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string, yaml: YamlCodec): string {
  const serialized = yaml.stringify(frontmatter).trimEnd();
  return `---\n${serialized}\n---\n${body.replace(/^\n*/, "")}`;
}

export function parseManagedFrontmatter(
  content: string,
  yaml: YamlCodec,
): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: content };
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  try {
    return { frontmatter: yaml.parse(match[1]) ?? {}, body };
  } catch {
    return { frontmatter: {}, body };
  }
}

/**
 * Replace (or remove) one entry in a managed frontmatter array, matching on the
 * node-set key. Every other key in the frontmatter is left untouched — notes carry
 * user data the plugin has no business rewriting.
 *
 * The array key is only introduced when there is something to store, so writing a
 * hyperedge does not stamp an empty `simplices: []` onto a note that never had one.
 */
export function updateManagedArray(
  frontmatter: Record<string, unknown>,
  arrayKey: ManagedArrayKey,
  nodeKey: string,
  nextEntry?: Record<string, unknown>,
): Record<string, unknown> {
  const hadKey = Object.prototype.hasOwnProperty.call(frontmatter, arrayKey);
  const existing = Array.isArray(frontmatter[arrayKey]) ? [...(frontmatter[arrayKey] as unknown[])] : [];
  const filtered = existing.filter((entry) => {
    const nodes =
      entry && typeof entry === "object" && Array.isArray((entry as Record<string, unknown>).nodes)
        ? ((entry as Record<string, unknown>).nodes as unknown[]).map(String)
        : [];
    return normalizeKey(nodes) !== nodeKey;
  });
  if (nextEntry) filtered.push(nextEntry);
  if (filtered.length > 0 || hadKey) frontmatter[arrayKey] = filtered;
  return frontmatter;
}
