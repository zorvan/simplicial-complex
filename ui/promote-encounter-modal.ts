import { Modal, Setting, type App } from "obsidian";
import type { NodeID } from "../core/types";

function label(nodeId: NodeID): string {
  return nodeId.split("/").pop()?.replace(/\.md$/, "") ?? nodeId;
}

/**
 * Promotion asserts something the encounter never claimed, so the user sees the
 * exact list of relations they are about to assert before it happens.
 */
export class PromoteEncounterModal extends Modal {
  constructor(
    _app: App,
    private nodes: NodeID[],
    private faces: NodeID[][],
    private onConfirm: () => Promise<void>,
  ) {
    super(_app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Promote encounter to simplex" });
    contentEl.createEl("p", {
      text: `You are asserting that ${this.nodes.map(label).join(" · ")} is not only meaningful as a whole, but that its sub-relations are meaningful too.`,
    });

    if (this.faces.length === 0) {
      contentEl.createEl("p", {
        text: "Every implied face already exists in the complex, so nothing new will be asserted.",
      });
    } else {
      contentEl.createEl("p", {
        text: `${this.faces.length} new ${this.faces.length === 1 ? "relation" : "relations"} will be created:`,
      });
      const list = contentEl.createEl("ul", { cls: "simplicial-promote-faces" });
      this.faces.forEach((face) => {
        list.createEl("li", { text: face.map(label).join(" — ") });
      });
    }

    contentEl.createEl("p", {
      cls: "simplicial-promote-note",
      text: "The encounter is kept as provenance, so this can be undone with 'relax to encounter'.",
    });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Promote");
        button.setCta();
        button.onClick(async () => {
          await this.onConfirm();
          this.close();
        });
      })
      .addExtraButton((button) => {
        button.setIcon("cross");
        button.setTooltip("Cancel");
        button.onClick(() => this.close());
      });
  }
}
