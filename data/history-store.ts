import { TFile, type App } from "obsidian";
import { logger } from "../core/logger.js";
import { deserializeEvent, serializeEvent, type RelationEvent, type RelationHistory } from "../core/history.js";

const HEADER = [
  "---",
  "managedBy: simplicial-complex",
  "---",
  "",
  "<!-- Append-only relation history. One JSON event per line, oldest first.",
  "     Corrections are new events, never edits: this file is only ever appended to. -->",
  "",
].join("\n");

/**
 * Durable side of HG-30. Events are appended a line at a time and the file is never
 * rewritten in place — deleting a relation must not delete its history.
 */
export class HistoryStore {
  private queue: RelationEvent[] = [];
  private flushing: Promise<void> | null = null;

  constructor(
    private app: App,
    private historyFile: string,
  ) {}

  setPath(historyFile: string): void {
    this.historyFile = historyFile;
  }

  get path(): string {
    return this.historyFile;
  }

  async load(history: RelationHistory): Promise<number> {
    const file = this.app.vault.getAbstractFileByPath(this.historyFile);
    if (!(file instanceof TFile)) return 0;
    const content = await this.app.vault.read(file);
    const events = content
      .split("\n")
      .map((line) => deserializeEvent(line))
      .filter((event): event is RelationEvent => event !== null);
    history.load(events);
    logger.info("history", "Loaded relation history", { path: this.historyFile, eventCount: events.length });
    return events.length;
  }

  /** Queue an event; writes are coalesced so a burst of transformations is one append. */
  record(event: RelationEvent): void {
    this.queue.push(event);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        while (this.queue.length > 0) {
          const batch = this.queue.splice(0, this.queue.length);
          const lines = batch.map((event) => serializeEvent(event)).join("\n");
          await this.appendLines(lines);
        }
      } catch (error) {
        logger.error("history", "Failed to append relation history", {
          path: this.historyFile,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private async appendLines(lines: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(this.historyFile);
    if (existing instanceof TFile) {
      await this.app.vault.append(existing, `${lines}\n`);
      return;
    }
    await this.app.vault.create(this.historyFile, `${HEADER}${lines}\n`);
    logger.info("history", "Created relation history file", { path: this.historyFile });
  }
}
