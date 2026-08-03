import type { App } from "obsidian";
import { parseYaml } from "obsidian";
import { resolveNodeId } from "../core/normalize.js";
import type { ParsedFileResult } from "../core/types.js";
import { parseRelations, type ParserDeps } from "./parser-core.js";

/** Obsidian adapter around the vault-independent parser in `parser-core.ts`. */
export function parseSimplices(content: string, sourcePath: string, app: App): ParsedFileResult {
  const deps: ParserDeps = {
    canonicalize: (rawId) => resolveNodeId(rawId, sourcePath, app)?.path ?? rawId.trim(),
    parseYaml: (source) => (parseYaml(source) as Record<string, unknown> | null) ?? null,
  };
  return parseRelations(content, sourcePath, deps);
}
