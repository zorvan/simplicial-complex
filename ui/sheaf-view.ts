import { ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import {
  allRelationKeys,
  analyzeSheaf,
  contextSupport,
  SHEAF_ROLES,
  suggestRoleRefinements,
  type ContextSource,
} from "../core/sheaf";
import { SimplicialModel } from "../core/model";
import { VIEW_TYPE_SIMPLICIAL_SHEAF, type PluginSettings, type RelationKey } from "../core/types";
import {
  buildGlobalRoles,
  buildSheafData,
  appendSheafAudit,
  compareReadings,
  deriveContext,
  readStoredSheaf,
  suggestDerivedContexts,
  suggestContextRoles,
  suggestRelationContexts,
  uniqueContextId,
  writeStoredSheaf,
  type StoredSheaf,
} from "../data/sheaf-store";
import { renderExternalAgentHelp } from "./external-agent-help";

const SOURCES: ContextSource[] = ["manual", "folder", "tag", "query", "moc"];

/** HG-26…HG-29: explicit cover editor, local readings, and obstruction report. */
export class SheafView extends ItemView {
  private scratch = new Map<string, (typeof SHEAF_ROLES)[number]>();
  private showDerivedSeeds = false;
  private compareNodeId: string | null = null;
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

  /** Reveal every non-destructive context and mapping proposal on the next visit. */
  revealDiscoverySuggestions(): void {
    this.showDerivedSeeds = true;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("div", { cls: "simplicial-panel-title", text: "Contextuality lab" });
    contentEl.createEl("div", {
      cls: "simplicial-explanation-tension",
      text: "Use this after you have overlapping groups. A context is one viewpoint (for example a project, folder, or theme). Give the same note a role in each viewpoint; the lab then shows whether those local readings agree when combined.",
    });
    const guide = contentEl.createEl("details", { cls: "simplicial-sheaf-guide" });
    guide.createEl("summary", { text: "What should I expect to see?" });
    guide.createEl("p", {
      text: "Start by adding suggested context seeds. In each context, assign roles only where they make sense. The report will show either a compatible shared reading, a direct local disagreement, or contextuality: every overlap looks compatible on its own, but all viewpoints cannot be combined at once. Suggestions are hypotheses and never change your notes automatically.",
    });
    guide.createEl("p", {
      text: "Role vocabulary: action = something being done; project = organized work; research = investigation; idea = a concept or proposal; creative = an expressive work; reference = supporting material. Every role is local to one context and can be corrected.",
    });

    const stored = readStoredSheaf(this.settings);
    renderExternalAgentHelp(contentEl, this.app);
    this.renderSuggestions(contentEl, stored);
    this.renderCreator(contentEl, stored);
    this.renderReport(contentEl, stored);
    stored.contexts.forEach((context) => this.renderContext(contentEl, stored, context.id));
    this.renderAudit(contentEl, stored);
  }

  private renderSuggestions(container: HTMLElement, stored: StoredSheaf): void {
    const suggestions = suggestRelationContexts(this.app, this.model, stored.contexts);
    const section = container.createDiv({ cls: "simplicial-sheaf-suggestions" });
    section.createEl("div", { cls: "simplicial-panel-section-label", text: "Suggested starting cover" });
    section.createEl("div", {
      cls: "simplicial-measure-reading",
      text: suggestions.length
        ? "Each worksheet includes a deterministic first draft from authored overlap and note metadata. Add it, then rename it and correct any local role that does not fit."
        : "No new overlapping authored relations are available as context seeds.",
    });
    suggestions.forEach(({ context, reason, initialRoles }) => {
      new Setting(section)
        .setName(context.name)
        .setDesc(`${reason} Starter roles: ${this.roleSummary(initialRoles)}.`)
        .addButton((button) => {
          button.setButtonText("Add worksheet");
          button.onClick(
            () =>
              void (async () => {
                stored.contexts.push(context);
                stored.sections[context.id] = { ...initialRoles };
                appendSheafAudit(stored, {
                  action: "context-added",
                  contextId: context.id,
                  after: context.name,
                  reason,
                });
                await this.persist(stored);
              })(),
          );
        });
    });
    new Setting(section)
      .setName("Folder and tag seeds")
      .setDesc("Optional filing-system hints, ranked by overlap. They are never added automatically.")
      .addButton((button) => {
        button.setButtonText(this.showDerivedSeeds ? "Hide" : "Discover");
        button.onClick(() => {
          this.showDerivedSeeds = !this.showDerivedSeeds;
          this.render();
        });
      });
    if (this.showDerivedSeeds) {
      suggestDerivedContexts(this.app, this.model, stored.contexts).forEach(({ context, reason, initialRoles }) => {
        new Setting(section)
          .setName(`${context.source}: ${context.name}`)
          .setDesc(`${reason} Starter roles: ${this.roleSummary(initialRoles)}.`)
          .addButton((button) => {
            button.setButtonText("Add worksheet");
            button.onClick(async () => {
              stored.contexts.push(context);
              stored.sections[context.id] = { ...initialRoles };
              appendSheafAudit(stored, { action: "context-added", contextId: context.id, after: context.name, reason });
              await this.persist(stored);
            });
          });
      });
    }
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
      SOURCES.forEach((candidate) => {
        dropdown.addOption(candidate, candidate === "moc" ? "MOC note" : candidate);
      });
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
        appendSheafAudit(stored, {
          action: "context-added",
          contextId: id,
          after: name,
          reason: "Explicitly accepted in Contextuality Lab.",
        });
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
      text: `Global baseline dimension ${report.gluing.globalBaselineDimension} · obstruction rank ${report.gluing.obstructionRank} · contextual fraction ${report.fraction.value.toFixed(2)}${report.fraction.exact ? "" : " lower bound"}`,
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
    this.renderRefinements(card, stored, data);
  }

  private renderRefinements(
    container: HTMLElement,
    stored: StoredSheaf,
    data: ReturnType<typeof buildSheafData>,
  ): void {
    const suggestions = suggestRoleRefinements(this.model, data);
    if (suggestions.length === 0) return;
    container.createEl("div", { cls: "simplicial-panel-section-label", text: "Try a local refinement" });
    container.createEl("div", {
      cls: "simplicial-measure-reading",
      text: "These are counterfactual improvements, not claims about meaning. Apply one only if the proposed local reading is accurate.",
    });
    suggestions.forEach((suggestion, index) => {
      const context = stored.contexts.find((candidate) => candidate.id === suggestion.contextId);
      const setting = new Setting(container)
        .setName(
          `${index === 0 ? "Most consequential · " : ""}${shortName(suggestion.nodeId)} in ${context?.name ?? suggestion.contextId}`,
        )
        .setDesc(
          `${suggestion.from} → ${suggestion.to}; obstruction rank ${suggestion.before.obstructionRank} → ${suggestion.after.obstructionRank}; contextual fraction ${suggestion.before.contextualFraction.toFixed(2)} → ${suggestion.after.contextualFraction.toFixed(2)}${suggestion.before.contextualityDetected && !suggestion.after.contextualityDetected ? "; converts a global-reconciliation candidate into a directly inspectable local disagreement" : ""}.`,
        );
      setting.addButton((button) => {
        button.setButtonText("Try in scratch");
        button.onClick(() => {
          this.scratch.set(`${suggestion.contextId}\u0000${suggestion.nodeId}`, suggestion.to);
          this.render();
        });
      });
    });
    if (this.scratch.size > 0) this.renderScratch(container, stored);
  }

  private renderScratch(container: HTMLElement, stored: StoredSheaf): void {
    const section = container.createDiv({ cls: "simplicial-sheaf-scratch" });
    section.createEl("div", { cls: "simplicial-panel-section-label", text: `Scratch changes (${this.scratch.size})` });
    const preview: StoredSheaf = {
      contexts: stored.contexts,
      sections: Object.fromEntries(Object.entries(stored.sections).map(([id, roles]) => [id, { ...roles }])),
      audit: stored.audit,
    };
    this.scratch.forEach((role, composite) => {
      const [contextId, nodeId] = composite.split("\u0000");
      preview.sections[contextId] ??= {};
      preview.sections[contextId][nodeId] = role;
    });
    const report = analyzeSheaf(
      this.model,
      buildSheafData(this.model, preview, buildGlobalRoles(this.app, this.model)),
    );
    section.createEl("div", {
      cls: "simplicial-measure-reading",
      text: `Temporary simultaneous readings: obstruction rank ${report.gluing.obstructionRank}, contextual fraction ${report.fraction.value.toFixed(2)}. Accept all to persist and audit them, or discard without changing plugin data.`,
    });
    new Setting(section)
      .addButton((button) =>
        button
          .setButtonText("Accept all")
          .setCta()
          .onClick(async () => {
            this.scratch.forEach((role, composite) => {
              const [contextId, nodeId] = composite.split("\u0000");
              stored.sections[contextId] ??= {};
              const before = stored.sections[contextId][nodeId];
              stored.sections[contextId][nodeId] = role;
              appendSheafAudit(stored, {
                action: "role-refined",
                contextId,
                nodeId,
                before,
                after: role,
                reason: "Accepted after simultaneous scratch comparison.",
              });
            });
            this.scratch.clear();
            await this.persist(stored);
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("Discard scratch")
          .setWarning()
          .onClick(() => {
            this.scratch.clear();
            this.render();
          }),
      );
  }

  private renderContext(container: HTMLElement, stored: StoredSheaf, contextId: string): void {
    const context = stored.contexts.find((candidate) => candidate.id === contextId);
    if (!context) return;
    const card = container.createDiv({ cls: "simplicial-sheaf-context" });
    const heading = card.createDiv({ cls: "simplicial-sheaf-context-head" });
    heading.createEl("strong", { text: context.name });
    heading.createEl("span", { text: `${context.source}${context.definition ? ` · ${context.definition}` : ""}` });
    const support = contextSupport(this.model, context);
    if (Object.keys(stored.sections[context.id] ?? {}).length === 0 && support.length > 0) {
      new Setting(card)
        .setName("This worksheet has no local readings yet")
        .setDesc("Create an editable first draft from note tags and paths. This is a starting point, not a conclusion.")
        .addButton((button) => {
          button.setButtonText("Prepare starter worksheet").setCta();
          button.onClick(async () => {
            const roles = suggestContextRoles(this.app, this.model, context);
            const oldName = context.name;
            if (/^inferred relation$/i.test(context.name)) {
              context.name = support.map(shortName).join(" · ");
              context.definition = `Overlapping relation among ${context.name}. Deterministic draft; rename and refine it.`;
              appendSheafAudit(stored, {
                action: "context-refined",
                contextId: context.id,
                before: oldName,
                after: context.name,
                reason: "Accepted a descriptive participant-based starter name.",
              });
            }
            stored.sections[context.id] = { ...roles };
            Object.entries(roles).forEach(([nodeId, role]) =>
              appendSheafAudit(stored, {
                action: "role-refined",
                contextId: context.id,
                nodeId,
                after: role,
                reason: "Accepted deterministic starter role from note metadata; remains editable.",
              }),
            );
            await this.persist(stored);
          });
        });
    }
    const overlaps = stored.contexts
      .filter((other) => other.id !== context.id)
      .map((other) => ({ other, nodes: support.filter((node) => contextSupport(this.model, other).includes(node)) }))
      .filter((entry) => entry.nodes.length > 0);
    overlaps.forEach(({ other, nodes }) => {
      card.createEl("div", {
        cls: "simplicial-context-overlap",
        text: `Intersection with ${other.name}: ${nodes.map(shortName).join(" · ")}`,
      });
      card.createEl("div", {
        cls: "simplicial-measure-reading",
        text: `Useful because ${nodes.length} shared note${nodes.length === 1 ? " carries" : "s carry"} readings that can be tested for agreement.`,
      });
    });

    const data = buildSheafData(this.model, stored, buildGlobalRoles(this.app, this.model));
    const section = data.sections.get(context.id);
    support.forEach((nodeId) => {
      const row = new Setting(card)
        .setName(shortName(nodeId))
        .setDesc("Role inside this context only—not the note's permanent identity.");
      row.addDropdown((dropdown) => {
        SHEAF_ROLES.forEach((role) => {
          dropdown.addOption(role, role);
        });
        dropdown.setValue(section?.get(nodeId) ?? "reference");
        dropdown.onChange(
          (value) =>
            void (async () => {
              stored.sections[context.id] ??= {};
              const before = stored.sections[context.id][nodeId];
              stored.sections[context.id][nodeId] = value as (typeof SHEAF_ROLES)[number];
              appendSheafAudit(stored, {
                action: "role-refined",
                contextId: context.id,
                nodeId,
                before,
                after: value,
                reason: "Explicit role selection.",
              });
              await this.persist(stored);
            })(),
        );
      });
      row.addButton((button) =>
        button.setButtonText("Compare readings").onClick(() => {
          this.compareNodeId = nodeId;
          this.render();
        }),
      );
    });
    if (this.compareNodeId && support.includes(this.compareNodeId)) {
      const globalRoles = buildGlobalRoles(this.app, this.model);
      const comparison = card.createDiv({ cls: "simplicial-sheaf-comparison" });
      comparison.createEl("div", {
        cls: "simplicial-panel-section-label",
        text: `Readings of ${shortName(this.compareNodeId)}`,
      });
      compareReadings(this.model, stored, globalRoles, this.compareNodeId).forEach((reading) => {
        comparison.createEl("div", { text: `${reading.contextName}: ${reading.role} · ${reading.provenance}` });
      });
    }
    this.renderContextRestructuring(card, stored, context.id);
    new Setting(card).addButton((button) => {
      button.setButtonText("Delete context").setWarning();
      button.onClick(async () => {
        appendSheafAudit(stored, {
          action: "context-deleted",
          contextId: context.id,
          before: context.name,
          reason: "Explicitly deleted in Contextuality Lab.",
        });
        stored.contexts = stored.contexts.filter((candidate) => candidate.id !== context.id);
        delete stored.sections[context.id];
        await this.persist(stored);
      });
    });
  }

  private renderContextRestructuring(container: HTMLElement, stored: StoredSheaf, contextId: string): void {
    const context = stored.contexts.find((candidate) => candidate.id === contextId);
    if (!context) return;
    if (context.relations.length > 1) {
      new Setting(container)
        .setName("Split suggestion")
        .setDesc("Review one relation as its own context; the current context remains unchanged until accepted.")
        .addButton((button) => {
          button.setButtonText("Accept split seed").onClick(async () => {
            const relation = context.relations[context.relations.length - 1];
            const id = uniqueContextId(`${context.name} split`, stored.contexts);
            stored.contexts.push({
              ...context,
              id,
              name: `${context.name} split`,
              source: "manual",
              definition: "Accepted split suggestion",
              relations: [relation],
            });
            stored.sections[id] = { ...(stored.sections[context.id] ?? {}) };
            appendSheafAudit(stored, {
              action: "context-refined",
              contextId: id,
              before: context.id,
              after: id,
              reason: "Accepted context split seed.",
            });
            await this.persist(stored);
          });
        });
    }
    const merge = stored.contexts.find(
      (other) =>
        other.id !== context.id &&
        contextSupport(this.model, other).some((node) => contextSupport(this.model, context).includes(node)),
    );
    if (merge) {
      new Setting(container)
        .setName(`Merge suggestion: ${merge.name}`)
        .setDesc("The contexts overlap. Accepting creates a new combined context and preserves both originals.")
        .addButton((button) => {
          button.setButtonText("Accept merge seed").onClick(async () => {
            const id = uniqueContextId(`${context.name} + ${merge.name}`, stored.contexts);
            stored.contexts.push({
              id,
              name: `${context.name} + ${merge.name}`,
              source: "manual",
              definition: "Accepted merge suggestion",
              relations: [...new Set([...context.relations, ...merge.relations])].sort(),
            });
            stored.sections[id] = { ...(stored.sections[merge.id] ?? {}), ...(stored.sections[context.id] ?? {}) };
            appendSheafAudit(stored, {
              action: "context-refined",
              contextId: id,
              before: `${context.id},${merge.id}`,
              after: id,
              reason: "Accepted context merge seed.",
            });
            await this.persist(stored);
          });
        });
    }
  }

  private async persist(stored: StoredSheaf): Promise<void> {
    writeStoredSheaf(this.settings, stored);
    await this.onChanged();
    this.render();
  }

  private renderAudit(container: HTMLElement, stored: StoredSheaf): void {
    const section = container.createDiv({ cls: "simplicial-sheaf-audit" });
    section.createEl("div", { cls: "simplicial-panel-section-label", text: "Accepted refinement audit trail" });
    const events = stored.audit.slice(-20).reverse();
    if (events.length === 0)
      section.createEl("div", { cls: "simplicial-measure-reading", text: "No accepted refinements yet." });
    events.forEach((event) =>
      section.createEl("div", {
        cls: "simplicial-measure-reading",
        text: `${new Date(event.at).toLocaleString()} · ${event.action} · ${event.nodeId ? `${shortName(event.nodeId)} · ` : ""}${event.before ?? "∅"} → ${event.after ?? "∅"} · ${event.reason}`,
      }),
    );
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

  private roleSummary(roles: Record<string, (typeof SHEAF_ROLES)[number]>): string {
    const entries = Object.entries(roles);
    if (entries.length === 0) return "none available";
    const preview = entries.slice(0, 4).map(([nodeId, role]) => `${shortName(nodeId)} → ${role}`);
    return `${preview.join("; ")}${entries.length > preview.length ? `; +${entries.length - preview.length} more` : ""}`;
  }
}

function shortName(nodeId: string): string {
  return nodeId.split("/").pop()?.replace(/\.md$/, "") ?? nodeId;
}
