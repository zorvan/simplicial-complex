/* global navigator -- Clipboard access is user-initiated in Obsidian/Electron. */
import { Modal, Notice, Setting, type App } from "obsidian";

const PRINCIPLES = `You are reading an Obsidian vault that uses the Simplicial Complex plugin.

Work read-only during this first pass. Do not edit any file.

SEMANTICS

A simplex means the group is coherent and its relevant sub-relations are also meaningful. It supports downward closure.

An encounter or hyperedge means something meaningful occurs through the participants together, without claiming that its proper subsets are independently meaningful. Never generate faces from an encounter.

A context is a local relational reading of notes. A note may have different roles in different contexts. A contextual role is not the note's absolute identity.

Contextuality means local readings are pairwise compatible but cannot all be reconciled into one global reading. Ordinary disagreement between two contexts is not contextuality.

HARD RULES

- Treat every result as a proposal, not a vault fact.
- Never create a universal classification of a note or person.
- Never infer that an encounter actually occurred merely from semantic similarity.
- Never promote an encounter to a simplex.
- Repetition is evidence, not proof of simplicial coherence.
- Never edit relation history.
- Cite vault paths supporting every proposal.
- Prefer uncertainty and a precise user question over an unsupported assertion.`;

const ENCOUNTER_TASK = `TASK — ENCOUNTER CANDIDATES

Find groups whose meaning may depend upon the whole configuration.

For each candidate:
1. Assign an ID such as E-01.
2. List the participating notes.
3. Describe what appears only through the whole.
4. Test whether the meaning survives in the important proper subsets.
5. Classify it as encounter, simplex, ordinary collection, or insufficient evidence.
6. Cite supporting vault paths.
7. State what only the user can confirm.
8. Provide ready-to-paste ◇ syntax, but do not insert it.

Return a ranked table followed by detailed evidence. Do not edit the vault until I explicitly select proposal IDs.`;

const CONTEXTUALITY_TASK = `TASK — CONTEXTUALITY CANDIDATES

Find overlapping argumentative, project, research, creative, or practical contexts.

For each candidate:
1. Assign an ID such as C-01.
2. Name and describe each context.
3. List the relations supporting it.
4. Identify only the notes shared across contexts.
5. Suggest local roles for shared notes using action, project, research, idea, creative, or reference.
6. Cite evidence for every context-relative role.
7. Distinguish ordinary local disagreement, compatible readings that glue, and a possible contextual obstruction.
8. Ask only questions whose answers could change the result.

Return a ranked table followed by detailed evidence. Do not edit the vault or Obsidian plugin settings. For selected proposals, produce a Contextuality Lab worksheet with context name, source, definition, included relations, local-role overrides, and unresolved user questions.`;

export const ENCOUNTER_AGENT_PROMPT = `${PRINCIPLES}\n\n${ENCOUNTER_TASK}`;
export const CONTEXTUALITY_AGENT_PROMPT = `${PRINCIPLES}\n\n${CONTEXTUALITY_TASK}`;
export const COMBINED_AGENT_PROMPT = `${PRINCIPLES}\n\n${ENCOUNTER_TASK}\n\n${CONTEXTUALITY_TASK}`;

async function copyPrompt(prompt: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(prompt);
    new Notice(`${label} copied. Paste it into an external agent you trust.`);
  } catch {
    new Notice("Could not access the clipboard. Open the complete guide and copy the prompt manually.");
  }
}

export function renderExternalAgentHelp(container: HTMLElement, app: App, compact = false): void {
  const card = container.createDiv({ cls: "simplicial-agent-help" });
  card.createEl("div", { cls: "simplicial-panel-section-label", text: "Use an external AI reader" });
  card.createEl("p", {
    text: "This plugin never sends your vault anywhere. If you independently give a file-capable agent access, these instructions help it propose structure for you to review.",
  });
  const actions = card.createDiv({ cls: "simplicial-agent-help-actions" });
  const addCopyButton = (label: string, prompt: string): void => {
    const button = actions.createEl("button", { text: label });
    button.addEventListener("click", () => void copyPrompt(prompt, label));
  };
  if (!compact) addCopyButton("Copy combined prompt", COMBINED_AGENT_PROMPT);
  addCopyButton("Copy encounter prompt", ENCOUNTER_AGENT_PROMPT);
  addCopyButton("Copy contextuality prompt", CONTEXTUALITY_AGENT_PROMPT);
  const guide = actions.createEl("button", { text: "Open complete guide" });
  guide.addEventListener("click", () => new ExternalAgentGuideModal(app).open());
}

class ExternalAgentGuideModal extends Modal {
  onOpen(): void {
    this.contentEl.addClass("simplicial-agent-guide");
    this.contentEl.createEl("h2", { text: "AI-assisted discovery" });
    this.contentEl.createEl("p", {
      text: "Optional and provider-neutral: the plugin does not invoke an agent, transmit notes, or accept proposals automatically. You choose the tool, its vault access, and every intervention.",
    });
    this.contentEl.createEl("h3", { text: "Safe workflow" });
    const steps = this.contentEl.createEl("ol");
    [
      "Choose which vault folders the external agent may read and exclude private material.",
      "Run the first pass read-only with one of the prompts below.",
      "Review citations, uncertainty, and the questions marked for you.",
      "Record confirmed encounters through the plugin; enter contextuality worksheets in the Contextuality Lab.",
      "If you later permit file edits, preview the exact diff and never allow relation-history edits.",
    ].forEach((step) => steps.createEl("li", { text: step }));
    this.addPrompt("Combined discovery prompt", COMBINED_AGENT_PROMPT);
    this.addPrompt("Encounter-only prompt", ENCOUNTER_AGENT_PROMPT);
    this.addPrompt("Contextuality-only prompt", CONTEXTUALITY_AGENT_PROMPT);
  }

  private addPrompt(title: string, prompt: string): void {
    const details = this.contentEl.createEl("details");
    details.createEl("summary", { text: title });
    const pre = details.createEl("pre");
    pre.createEl("code", { text: prompt });
    new Setting(details).addButton((button) => {
      button.setButtonText(`Copy ${title.toLowerCase()}`);
      button.onClick(() => void copyPrompt(prompt, title));
    });
  }
}
