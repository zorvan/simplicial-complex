import { ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { allRelationKeys, analyzeSheaf, contextSupport, SHEAF_ROLES, type ContextSource } from "../core/sheaf";
import { SimplicialModel } from "../core/model";
import { VIEW_TYPE_SIMPLICIAL_SHEAF, type PluginSettings, type RelationKey } from "../core/types";
import {
  buildGlobalRoles,
  buildSheafData,
  deriveContext,
  readStoredSheaf,
  uniqueContextId,
  writeStoredSheaf,
  type StoredSheaf,
} from "../data/sheaf-store";

const SOURCES: ContextSource[] = ["manual", "folder", "tag", "query", "moc"];

/** HG-26…HG-29: explicit cover editor, local readings, and obstruction report. */
export class SheafView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private model: SimplicialModel,
    private settings: PluginSettings,
    private onChanged: () => Promise<void>,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SIMPLICIAL_SHEAF;
  }

  getDisplayText(): string {
    return "Contextuality lab";
  }

  getIcon(): string {
    return "combine";
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("div", { cls: "simplicial-panel-title", text: "Contextuality lab" });
    contentEl.createEl("div", {
      cls: "simplicial-explanation-tension",
      text: "Contexts may each make sense locally yet fail to admit one shared reading. This is a gluing obstruction, not a missing topological filler.",
    });

    const stored = readStoredSheaf(this.settings);
    this.renderCreator(contentEl, stored);
    this.renderReport(contentEl, stored);
    stored.contexts.forEach((context) => this.renderContext(contentEl, stored, context.id));
  }

  private renderCreator(container: HTMLElement, stored: StoredSheaf): void {
    const section = container.createDiv({ cls: "simplicial-sheaf-create" });
    section.createEl("div", { cls: "simplicial-panel-section-label", text: "Define context" });
    let name = "";
    let source: ContextSource = "manual";
    let definition = "";
    const selected = new Set<RelationKey>();

    new Setting(section).setName("Name").addText((text) => text.onChange((value) => (name = value.trim())));
    new Setting(section).setName("Source").addDropdown((dropdown) => {
      SOURCES.forEach((candidate) => dropdown.addOption(candidate, candidate === "moc" ? "MOC note" : candidate));
      dropdown.setValue(source);
      dropdown.onChange((value) => (source = value as ContextSource));
    });
    new Setting(section)
      .setName("Definition")
      .setDesc("Folder path/tag for a derived seed, or a query/MOC description for an explicit selection.")
      .addText((text) => text.onChange((value) => (definition = value.trim())));

    const relations = allRelationKeys(this.model);
    const list = section.createDiv({ cls: "simplicial-sheaf-relations" });
    relations.forEach((key) => {
      new Setting(list).setName(this.relationLabel(key)).addToggle((toggle) => {
        toggle.onChange((value) => (value ? selected.add(key) : selected.delete(key)));
      });
    });

    new Setting(section).addButton((button) => {
      button.setButtonText("Add context").setCta();
      button.onClick(async () => {
        if (!name) {
          new Notice("Give the context a name first.");
          return;
        }
        const derived =
          (source === "folder" || source === "tag") && definition
            ? deriveContext(this.app, this.model, source, definition, stored.contexts)
            : null;
        const relationKeys = selected.size > 0 ? [...selected] : (derived?.relations ?? []);
        if (relationKeys.length === 0) {
          new Notice("Select at least one relation, or use a folder/tag that matches one.");
          return;
        }
        const id = uniqueContextId(name, stored.contexts);
        stored.contexts.push({ id, name, source, definition, relations: [...new Set(relationKeys)].sort() });
        stored.sections[id] = {};
        await this.persist(stored);
      });
    });
  }

  private renderReport(container: HTMLElement, stored: StoredSheaf): void {
    const data = buildSheafData(this.model, stored, buildGlobalRoles(this.app, this.model));
    const report = analyzeSheaf(this.model, data);
    const card = container.createDiv({ cls: "simplicial-sheaf-report" });
    card.createEl("div", { cls: "simplicial-panel-section-label", text: "Gluing report" });
    card.createEl("div", {
      cls: "simplicial-panel-value",
      text: `H⁰ ${report.gluing.h0} · H¹ ${report.gluing.h1} · contextual fraction ${report.fraction.value.toFixed(2)}${report.fraction.exact ? "" : " lower bound"}`,
    });
    if (report.obstructions.length === 0) {
      card.createEl("div", { cls: "simplicial-measure-reading", text: "No gluing obstruction detected." });
    } else {
      report.obstructions.forEach((obstruction) => {
        const names = obstruction.contexts.map(
          (id) => stored.contexts.find((context) => context.id === id)?.name ?? id,
        );
        card.createEl("div", {
          cls: "simplicial-obstruction-reading",
          text: report.gluing.contextualityDetected
            ? `${obstruction.nodes.map(shortName).join(" · ")} are pairwise compatible, but cannot be read together across ${names.join(" ↔ ")}.`
            : `${obstruction.nodes.map(shortName).join(" · ")} cannot be reconciled across ${names.join(" ↔ ")}; local disagreements are listed separately below.`,
        });
      });
    }
    report.gluing.pairwiseDisagreements.forEach((disagreement) => {
      card.createEl("div", {
        cls: "simplicial-measure-reading",
        text: `Local disagreement between ${disagreement.a} and ${disagreement.b}: ${disagreement.disagreeingNodes.map(shortName).join(" · ")}. This is not contextuality.`,
      });
    });
  }

  private renderContext(container: HTMLElement, stored: StoredSheaf, contextId: string): void {
    const context = stored.contexts.find((candidate) => candidate.id === contextId);
    if (!context) return;
    const card = container.createDiv({ cls: "simplicial-sheaf-context" });
    const heading = card.createDiv({ cls: "simplicial-sheaf-context-head" });
    heading.createEl("strong", { text: context.name });
    heading.createEl("span", { text: `${context.source}${context.definition ? ` · ${context.definition}` : ""}` });
    const support = contextSupport(this.model, context);
    const overlaps = stored.contexts
      .filter((other) => other.id !== context.id)
      .map((other) => ({ other, nodes: support.filter((node) => contextSupport(this.model, other).includes(node)) }))
      .filter((entry) => entry.nodes.length > 0);
    overlaps.forEach(({ other, nodes }) => {
      card.createEl("div", {
        cls: "simplicial-context-overlap",
        text: `Intersection with ${other.name}: ${nodes.map(shortName).join(" · ")}`,
      });
    });

    const data = buildSheafData(this.model, stored, buildGlobalRoles(this.app, this.model));
    const section = data.sections.get(context.id);
    support.forEach((nodeId) => {
      new Setting(card).setName(shortName(nodeId)).addDropdown((dropdown) => {
        SHEAF_ROLES.forEach((role) => dropdown.addOption(role, role));
        dropdown.setValue(section?.get(nodeId) ?? "reference");
        dropdown.onChange(async (value) => {
          stored.sections[context.id] ??= {};
          stored.sections[context.id][nodeId] = value as (typeof SHEAF_ROLES)[number];
          await this.persist(stored);
        });
      });
    });
    new Setting(card).addButton((button) => {
      button.setButtonText("Delete context").setWarning();
      button.onClick(async () => {
        stored.contexts = stored.contexts.filter((candidate) => candidate.id !== context.id);
        delete stored.sections[context.id];
        await this.persist(stored);
      });
    });
  }

  private async persist(stored: StoredSheaf): Promise<void> {
    writeStoredSheaf(this.settings, stored);
    await this.onChanged();
    this.render();
  }

  private relationLabel(key: RelationKey): string {
    if (key.startsWith("h:")) {
      const relation = this.model.getHyperedge(key);
      return `◇ ${relation?.label?.trim() || relation?.nodes.map(shortName).join(" · ") || key}`;
    }
    const bare = key.startsWith("s:") ? key.slice(2) : key;
    const relation = this.model.getSimplex(bare);
    return `△ ${relation?.label?.trim() || relation?.nodes.map(shortName).join(" · ") || key}`;
  }
}

function shortName(nodeId: string): string {
  return nodeId.split("/").pop()?.replace(/\.md$/, "") ?? nodeId;
}
