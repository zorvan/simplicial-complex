/* global window -- Allow window for setTimeout in Obsidian/Electron environment (ESLint browser globals) */
import { Modal, Notice, Setting, TextAreaComponent, type App } from "obsidian";
import type { RelationKind } from "../core/types";
import { renderExternalAgentHelp } from "./external-agent-help";

export interface RelationDraft {
  kind: RelationKind;
  nodes: string[];
  label?: string;
  weight: number;
  /** Encounters only: the user's own word for the sort of encounter this was. */
  mode?: string;
}

const KIND_COPY: Record<RelationKind, { title: string; blurb: string; cta: string }> = {
  simplex: {
    title: "Create simplex",
    blurb: "A simplex claims the group and every sub-relation within it is coherent. Its faces will be generated.",
    cta: "Create simplex",
  },
  hyperedge: {
    title: "Create encounter",
    blurb:
      "An encounter claims only that these notes came together as one irreducible whole. No faces are generated, and no pair is asserted to be meaningful on its own.",
    cta: "Create encounter",
  },
};

export class CreateSimplexModal extends Modal {
  private nodesInput = "";
  private labelInput = "";
  private modeInput = "";
  private weightInput = 1;
  private kind: RelationKind;

  constructor(
    _app: App,
    private initialNodes: string[],
    private persistenceLabel: string,
    private onSubmit: (_draft: RelationDraft) => Promise<void>,
    initialKind: RelationKind = "simplex",
  ) {
    super(_app);
    this.nodesInput = initialNodes.join(", ");
    this.kind = initialKind;
  }

  onOpen(): void {
    this.render();
    window.setTimeout(() => {
      const input = this.contentEl.querySelector("textarea");
      if (input instanceof HTMLTextAreaElement) input.focus();
    }, 0);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const copy = KIND_COPY[this.kind];
    contentEl.createEl("h3", { text: copy.title });
    contentEl.createEl("p", { text: copy.blurb });
    contentEl.createEl("p", {
      text: `Saves to ${this.persistenceLabel}. Use commas, spaces, or new lines to separate nodes.`,
    });

    new Setting(contentEl)
      .setName("Kind")
      .setDesc("Simplex: coherence inherited across subrelations. Encounter: irreducible group emergence.")
      .addDropdown((dropdown) => {
        dropdown.addOption("simplex", "Simplex (△)");
        dropdown.addOption("hyperedge", "Encounter (◇)");
        dropdown.setValue(this.kind);
        dropdown.onChange((value) => {
          this.kind = value === "hyperedge" ? "hyperedge" : "simplex";
          this.render();
        });
      });

    let textArea: TextAreaComponent | null = null;
    new Setting(contentEl)
      .setName("Nodes")
      .setDesc("These will be resolved as notes when possible; unknown values become virtual nodes.")
      .addTextArea((text) => {
        textArea = text;
        text.setValue(this.nodesInput);
        text.inputEl.rows = 6;
        text.onChange((value) => {
          this.nodesInput = value;
        });
      });

    new Setting(contentEl).setName("Label").addText((text) => {
      text.setPlaceholder("Unnamed");
      text.setValue(this.labelInput);
      text.onChange((value) => {
        this.labelInput = value;
      });
    });

    if (this.kind === "hyperedge") {
      new Setting(contentEl)
        .setName("Mode")
        .setDesc("What kind of encounter this was — free text, e.g. 'encounter', 'reading', 'argument'.")
        .addText((text) => {
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- Sample of the lowercase free-text value, not a label.
          text.setPlaceholder("encounter");
          text.setValue(this.modeInput);
          text.onChange((value) => {
            this.modeInput = value;
          });
        });

      renderExternalAgentHelp(contentEl, this.app, true);
    }

    new Setting(contentEl)
      .setName("Weight")
      .setDesc("0.1 to 1.0")
      .addSlider((slider) => {
        slider.setLimits(0.1, 1, 0.1);
        slider.setValue(this.weightInput);
        slider.onChange((value) => {
          this.weightInput = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(copy.cta);
        button.setCta();
        button.onClick(async () => {
          const nodes = this.parseNodes(this.nodesInput);
          const minimum = 2;
          if (nodes.length < minimum) {
            new Notice(
              this.kind === "hyperedge"
                ? "An encounter needs at least two participants."
                : "A simplex needs at least two nodes.",
            );
            textArea?.inputEl.focus();
            return;
          }
          await this.onSubmit({
            kind: this.kind,
            nodes,
            label: this.labelInput.trim() || undefined,
            weight: this.weightInput,
            ...(this.kind === "hyperedge" ? { mode: this.modeInput.trim() || "encounter" } : {}),
          });
          this.close();
        });
      })
      .addExtraButton((button) => {
        button.setIcon("cross");
        button.setTooltip("Cancel");
        button.onClick(() => this.close());
      });
  }

  private parseNodes(value: string): string[] {
    return value
      .split(/[\n,\s]+/g)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((node, index, all) => all.indexOf(node) === index);
  }
}
