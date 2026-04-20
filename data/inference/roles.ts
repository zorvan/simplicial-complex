import type { NoteRole } from "./types";
import type { TFile, CachedMetadata } from "obsidian";

export function extractRole(file: TFile, cache: CachedMetadata | null, content: string): NoteRole {
  const tags = (cache?.tags ?? []).map((t: { tag?: string }) => t.tag?.toLowerCase?.() ?? "");
  const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;

  if (/- \[ \]/.test(content)) return 'action';

  if (fm.status || tags.some((t) => ['#project', '#plan', '#initiative'].includes(t))) {
    return 'project';
  }
  if (tags.some((t) => ['#research', '#paper', '#study', '#analysis'].includes(t))) {
    return 'research';
  }
  if (tags.some((t) => ['#story', '#fiction', '#game', '#worldbuilding', '#writing'].includes(t))) {
    return 'creative';
  }
  if (tags.some((t) => ['#idea', '#concept', '#hypothesis', '#thought'].includes(t))) {
    return 'idea';
  }

  return 'reference';
}
