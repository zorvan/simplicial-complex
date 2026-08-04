import { App, Notice, PluginSettingTab, Setting, SliderComponent } from "obsidian";
import type SimplicialPlugin from "../main";
import { ensureCentralFile } from "../data/persistence";
import type { PluginSettings } from "../core/types";

// Structural subset of Obsidian 1.13's SettingDefinitionItem. Keeping this local
// lets the same bundle compile against the latest public (1.12) typings while
// older Obsidian versions continue to use display().
interface SearchableSettingSection {
  name: string;
  aliases: string[];
  render: (setting: Setting) => void;
}

export class SimplicialSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: SimplicialPlugin,
  ) {
    super(app, plugin);
  }

  /** Obsidian 1.13+ settings/search; display() remains the pre-1.13 fallback. */
  getSettingDefinitions(): SearchableSettingSection[] {
    return [
      this.settingSection("Storage", ["Persistence mode", "Central file"], (el) => this.renderPersistenceSettings(el)),
      this.settingSection(
        "Hypergraph",
        [
          "Hypergraph layer",
          "Show encounters",
          "Discover possible encounters",
          "Encounter suggestion confidence",
          "Encounter opacity",
          "Pulse focused encounters",
          "Recurrence threshold",
          "Crystallize folder",
          "Record relation history",
          "History file",
        ],
        (el) => this.renderHypergraphSettings(el),
      ),
      this.settingSection("Dynamics", ["Enable dynamics lab", "Attention half-life (minutes)"], (el) =>
        this.renderDynamicsSettings(el),
      ),
      this.settingSection("Contextuality", ["Contextuality lab"], (el) => this.renderSheafSettings(el)),
      this.settingSection(
        "Layout",
        [
          "Max rendered dimension",
          "Noise amount",
          "Repulsion strength",
          "Cohesion strength",
          "Gravity strength",
          "Damping",
          "Boundary padding",
          "Sleep threshold",
          "Dark mode",
        ],
        (el) => this.renderLayoutSettings(el),
      ),
      this.settingSection(
        "Inference",
        [
          "Higher-order inference output",
          "Link graph baseline",
          "Enable inferred edges",
          "Inference threshold",
          "Show suggestions",
          "Suggestion threshold",
        ],
        (el) => this.renderInferenceSettings(el),
      ),
      this.settingSection(
        "Commands and display",
        [
          "Command simplex size",
          "Formal mode",
          "Sparse edge length",
          "Sparse gravity boost",
          "Label density",
          "Filtration metric",
          "Filtration threshold",
          "Open metadata panel after create",
          "Metadata hover delay",
        ],
        (el) => this.renderCommandUiSettings(el),
      ),
      this.settingSection(
        "Topology and explanations",
        [
          "Show missing-face opportunities",
          "Display betti on canvas",
          "Max betti dimension",
          "Show filtration slider",
          "Enable explanation panel",
        ],
        (el) => this.renderBettiSettings(el),
      ),
      this.settingSection(
        "Inference engine",
        [
          "Inference engine (v2)",
          "Inference mode",
          "Emergent inference",
          "Domain source",
          "Content cluster count",
          "Link strength threshold",
        ],
        (el) => this.renderEmergentSettings(el),
      ),
      this.settingSection(
        "Legacy inference weights",
        [
          "Link weight",
          "Mutual link bonus",
          "Shared tag weight",
          "Title overlap weight",
          "Content overlap weight",
          "Same folder weight",
          "Top folder weight",
        ],
        (el) => this.renderLegacySettings(el),
      ),
    ];
  }

  private settingSection(
    name: string,
    aliases: string[],
    render: (containerEl: HTMLElement) => void,
  ): SearchableSettingSection {
    return {
      name,
      aliases,
      render: (setting) => {
        setting.settingEl.empty();
        setting.settingEl.addClass("simplicial-settings-section");
        setting.settingEl.createEl("h3", { text: name });
        render(setting.settingEl);
        this.refreshSettingVisibility();
      },
    };
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderDisplaySection(containerEl, "Storage", (section) => this.renderPersistenceSettings(section));
    this.renderDisplaySection(containerEl, "Hypergraph", (section) => this.renderHypergraphSettings(section));
    this.renderDisplaySection(containerEl, "Dynamics", (section) => this.renderDynamicsSettings(section));
    this.renderDisplaySection(containerEl, "Contextuality", (section) => this.renderSheafSettings(section));
    this.renderDisplaySection(containerEl, "Layout", (section) => this.renderLayoutSettings(section));
    this.renderDisplaySection(containerEl, "Inference", (section) => this.renderInferenceSettings(section));
    this.renderDisplaySection(containerEl, "Commands and display", (section) => this.renderCommandUiSettings(section));
    this.renderDisplaySection(containerEl, "Topology and explanations", (section) => this.renderBettiSettings(section));
    this.renderDisplaySection(containerEl, "Inference engine", (section) => this.renderEmergentSettings(section));
    this.renderDisplaySection(containerEl, "Legacy inference weights", (section) => this.renderLegacySettings(section));

    this.refreshSettingVisibility();
  }

  private renderDisplaySection(containerEl: HTMLElement, name: string, render: (sectionEl: HTMLElement) => void): void {
    const sectionEl = containerEl.createDiv({ cls: "simplicial-settings-section" });
    sectionEl.createEl("h3", { text: name });
    render(sectionEl);
  }

  private renderPersistenceSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Persistence mode")
      .setDesc("Choose where confirmed simplices are stored.")
      .addDropdown((dropdown) => {
        dropdown.addOption("source-note", "Source note");
        dropdown.addOption("central-file", "Central file");
        dropdown.setValue(this.plugin.settings.persistenceMode);
        dropdown.onChange(async (value) => {
          const mode = value as PluginSettings["persistenceMode"];
          this.plugin.settings.persistenceMode = mode;
          if (mode === "central-file") {
            await ensureCentralFile(this.app, this.plugin.settings.centralFile);
          }
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Central file").addText((text) => {
      text.setValue(this.plugin.settings.centralFile);
      text.onChange(async (value) => {
        this.plugin.settings.centralFile = value || "_simplicial.md";
        if (this.plugin.settings.persistenceMode === "central-file") {
          await ensureCentralFile(this.app, this.plugin.settings.centralFile);
        }
        await this.plugin.saveSettings();
      });
    });
  }

  private renderLayoutSettings(containerEl: HTMLElement): void {
    {
      const setting = new Setting(containerEl)
        .setName("Max rendered dimension")
        .setDesc("Highest simplex dimension to draw. A 10-node simplex has dimension 9.");
      this.addNumberSlider(setting, this.plugin.settings.maxRenderedDim, 1, 12, 1, async (value) => {
        this.plugin.settings.maxRenderedDim = value;
        await this.plugin.saveSettings();
        this.plugin.renderer.render();
      });
    }

    {
      const setting = new Setting(containerEl).setName("Noise amount");
      this.addNumberSlider(setting, this.plugin.settings.noiseAmount, 0, 0.5, 0.01, async (value) => {
        this.plugin.settings.noiseAmount = value;
        this.plugin.engine.configure({ noiseAmount: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Repulsion strength")
        .setDesc("Higher values push nodes apart more strongly.");
      this.addNumberSlider(setting, this.plugin.settings.repulsionStrength, 200, 6000, 100, async (value) => {
        this.plugin.settings.repulsionStrength = value;
        this.plugin.engine.configure({ repulsionStrength: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Cohesion strength")
        .setDesc("Higher values pull connected simplices together more strongly.");
      this.addNumberSlider(setting, this.plugin.settings.cohesionStrength, 0.001, 0.03, 0.001, async (value) => {
        this.plugin.settings.cohesionStrength = value;
        this.plugin.engine.configure({ cohesionStrength: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Gravity strength")
        .setDesc("Higher values keep nodes toward the center instead of drifting to the edges.");
      this.addNumberSlider(setting, this.plugin.settings.gravityStrength, 0.0001, 0.01, 0.0001, async (value) => {
        this.plugin.settings.gravityStrength = value;
        this.plugin.engine.configure({ gravityStrength: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Damping")
        .setDesc("Higher values make motion settle more slowly and glide more.");
      this.addNumberSlider(setting, this.plugin.settings.dampingFactor, 0.5, 0.99, 0.01, async (value) => {
        this.plugin.settings.dampingFactor = value;
        this.plugin.engine.configure({ dampingFactor: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Boundary padding")
        .setDesc("Minimum distance nodes keep from the canvas edges.");
      this.addNumberSlider(setting, this.plugin.settings.boundaryPadding, 0, 200, 5, async (value) => {
        this.plugin.settings.boundaryPadding = value;
        this.plugin.engine.configure({ boundaryPadding: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl).setName("Sleep threshold");
      this.addNumberSlider(setting, this.plugin.settings.sleepThreshold, 0.001, 0.1, 0.001, async (value) => {
        this.plugin.settings.sleepThreshold = value;
        this.plugin.engine.configure({ sleepThreshold: value });
        await this.plugin.saveSettings();
      });
    }

    new Setting(containerEl).setName("Dark mode").addDropdown((dropdown) => {
      dropdown.addOption("auto", "Auto");
      dropdown.addOption("force-light", "Force light");
      dropdown.addOption("force-dark", "Force dark");
      dropdown.setValue(this.plugin.settings.darkMode);
      dropdown.onChange(async (value) => {
        this.plugin.settings.darkMode = value as PluginSettings["darkMode"];
        await this.plugin.saveSettings();
      });
    });
  }

  private renderHypergraphSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Show encounters")
      .setDesc(
        "Render hyperedges (◇) as transient enclosures. An encounter records that notes came together as one irreducible whole, without asserting any pair within it.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showHyperedges);
        toggle.onChange(async (value) => {
          this.plugin.settings.showHyperedges = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    new Setting(containerEl)
      .setName("Discover possible encounters")
      .setDesc(
        "Propose in-memory ◇ candidates from coherent fields and cross-field junctions. Suggestions are never written to notes or history until you confirm them.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableEncounterSuggestions);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableEncounterSuggestions = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleFullScan("encounter-suggestions-changed", 0);
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Encounter suggestion confidence")
        .setDesc("Minimum structural/evidence score for showing a possible encounter.");
      this.addNumberSlider(
        setting,
        this.plugin.settings.encounterSuggestionThreshold,
        0.4,
        0.95,
        0.01,
        async (value) => {
          this.plugin.settings.encounterSuggestionThreshold = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleFullScan("encounter-suggestion-threshold", 0);
        },
      );
    }

    {
      const setting = new Setting(containerEl)
        .setName("Encounter opacity")
        .setDesc("How present encounter enclosures are against the simplicial fields.");
      this.addNumberSlider(setting, this.plugin.settings.hyperedgeOpacity, 0.1, 1, 0.05, async (value) => {
        this.plugin.settings.hyperedgeOpacity = value;
        await this.plugin.saveSettings();
        this.plugin.renderer.render();
      });
    }

    new Setting(containerEl)
      .setName("Pulse focused encounters")
      .setDesc(
        "Breathe the participants of a focused encounter in phase — a temporary alignment of attention, not a permanent connection. Turned off automatically when your system asks for reduced motion.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableHyperedgePulse);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableHyperedgePulse = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Recurrence threshold")
        .setDesc(
          "How many recorded encounters over the same notes mark a configuration as recurring. Recurrence enables crystallization; it never promotes anything on its own.",
        );
      this.addNumberSlider(setting, this.plugin.settings.encounterRecurrenceThreshold, 2, 10, 1, async (value) => {
        this.plugin.settings.encounterRecurrenceThreshold = value;
        await this.plugin.saveSettings();
      });
    }

    new Setting(containerEl)
      .setName("Crystallize folder")
      .setDesc("Where notes created by 'crystallize concept' are placed. Leave empty for the vault root.")
      .addText((text) => {
        text.setPlaceholder("Concepts");
        text.setValue(this.plugin.settings.crystallizeFolder);
        text.onChange(async (value) => {
          this.plugin.settings.crystallizeFolder = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Record relation history")
      .setDesc(
        "Keep an append-only log of how relations came to be — encountered, promoted, relaxed, crystallized, dissolved. Turning this off stops new entries; it never deletes existing ones.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableRelationHistory);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableRelationHistory = value;
          await this.plugin.saveSettings();
          new Notice(value ? "History resumes on next reload." : "History paused. Existing entries are kept.");
        });
      });

    new Setting(containerEl)
      .setName("History file")
      .setDesc("Vault path of the append-only relation history.")
      .addText((text) => {
        text.setPlaceholder("_simplicial-history.md");
        text.setValue(this.plugin.settings.historyFile);
        text.onChange(async (value) => {
          this.plugin.settings.historyFile = value.trim() || "_simplicial-history.md";
          this.plugin.historyStore.setPath(this.plugin.settings.historyFile);
          await this.plugin.saveSettings();
        });
      });
  }

  private renderDynamicsSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Enable dynamics lab")
      .setDesc(
        "Adds a view that runs your vault under three models of how attention spreads — pairwise, simplicial and hypergraph — and reports where they disagree. Experimental. Requires a reload.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableDynamicsLab);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableDynamicsLab = value;
          await this.plugin.saveSettings();
          new Notice(value ? "Dynamics lab appears after a reload." : "Dynamics lab removed after a reload.");
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Attention half-life (minutes)")
        .setDesc(
          "How long a note stays visibly in play after you leave it. Attention is never written to a note — it exists only while the plugin is running.",
        );
      this.addNumberSlider(setting, this.plugin.settings.activationDecayHalfLifeMinutes, 1, 240, 1, async (value) => {
        this.plugin.settings.activationDecayHalfLifeMinutes = value;
        await this.plugin.saveSettings();
      });
    }
  }

  private renderSheafSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Contextuality lab")
      .setDesc(
        "Define overlapping contexts, assign local roles, and detect gluing obstructions. Contexts live in plugin settings and never alter note content.",
      )
      .addButton((button) => {
        button.setButtonText("Open lab");
        button.onClick(() => void this.plugin.activateSheafView());
      });
  }

  private renderInferenceSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Higher-order inference output")
      .setDesc(
        "Keep inferred groups of three or more as encounter suggestions until you promote them. Pairwise links remain simplices.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("simplex", "Simplex (compatible default)");
        dropdown.addOption("hyperedge", "Encounter suggestion (safer)");
        dropdown.setValue(this.plugin.settings.inferenceEmits);
        dropdown.onChange(async (value) => {
          this.plugin.settings.inferenceEmits = value as "simplex" | "hyperedge";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Link graph baseline")
      .setDesc("Always show note-to-note vault links as 1-simplices, even without higher-order structure.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.linkGraphBaseline);
        toggle.onChange(async (value) => {
          this.plugin.settings.linkGraphBaseline = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Enable inferred edges")
      .setDesc("Use tags, links, titles, content, and folders to infer lightweight edges.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableInferredEdges);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableInferredEdges = value;
          await this.plugin.saveSettings();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Inference threshold")
        .setDesc("Minimum combined signal needed before an inferred edge is created.");
      this.addNumberSlider(setting, this.plugin.settings.inferenceThreshold, 0.05, 0.6, 0.01, async (value) => {
        this.plugin.settings.inferenceThreshold = value;
        await this.plugin.saveSettings();
      });
    }

    new Setting(containerEl)
      .setName("Show suggestions")
      .setDesc("Render closure and soft-cluster suggestions directly on the canvas.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showSuggestions);
        toggle.onChange(async (value) => {
          this.plugin.settings.showSuggestions = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Suggestion threshold")
        .setDesc("Confidence level required before a suggestion is surfaced in the UI.");
      this.addNumberSlider(setting, this.plugin.settings.suggestionThreshold, 0.2, 0.95, 0.01, async (value) => {
        this.plugin.settings.suggestionThreshold = value;
        await this.plugin.saveSettings();
      });
    }
  }

  private renderCommandUiSettings(containerEl: HTMLElement): void {
    {
      const setting = new Setting(containerEl)
        .setName("Command simplex size")
        .setDesc("How many nodes the create-from-open-note command tries to include.");
      this.addNumberSlider(setting, this.plugin.settings.commandSimplexSize, 2, 6, 1, async (value) => {
        this.plugin.settings.commandSimplexSize = value;
        await this.plugin.saveSettings();
      });
    }

    new Setting(containerEl)
      .setName("Formal mode")
      .setDesc("Locked on in v0.4.5. Computation-intensive Ambient rendering is temporarily unavailable.")
      .addToggle((toggle) => {
        toggle.setValue(true);
        toggle.setDisabled(true);
      });

    {
      const setting = new Setting(containerEl)
        .setName("Sparse edge length")
        .setDesc("Preferred spacing for sparse link-only graphs.");
      this.addNumberSlider(setting, this.plugin.settings.sparseEdgeLength, 60, 280, 5, async (value) => {
        this.plugin.settings.sparseEdgeLength = value;
        this.plugin.engine.configure({ sparseEdgeLength: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Sparse gravity boost")
        .setDesc("Extra centering force when the graph is mostly pairwise and sparse.");
      this.addNumberSlider(setting, this.plugin.settings.sparseGravityBoost, 1, 4, 0.1, async (value) => {
        this.plugin.settings.sparseGravityBoost = value;
        this.plugin.engine.configure({ sparseGravityBoost: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Label density")
        .setDesc("Controls how many non-focused labels are allowed before decluttering hides the rest.");
      this.addNumberSlider(setting, this.plugin.settings.labelDensity, 0.1, 1, 0.05, async (value) => {
        this.plugin.settings.labelDensity = value;
        await this.plugin.saveSettings();
        this.plugin.renderer.render();
      });
    }

    new Setting(containerEl)
      .setName("Filtration metric")
      .setDesc("Choose which simplex strength field the live filtration slider uses.")
      .addDropdown((dropdown) => {
        dropdown.addOption("weight", "Weight");
        dropdown.addOption("confidence", "Confidence");
        dropdown.addOption("decayed-weight", "Decayed weight");
        dropdown.setValue(this.plugin.settings.renderFilterMetric);
        dropdown.onChange(async (value) => {
          this.plugin.settings.renderFilterMetric = value as PluginSettings["renderFilterMetric"];
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Filtration threshold")
        .setDesc("Hide simplices below this threshold in the active filtration metric.");
      this.addNumberSlider(setting, this.plugin.settings.renderFilterThreshold, 0, 1, 0.01, async (value) => {
        this.plugin.settings.renderFilterThreshold = value;
        await this.plugin.saveSettings();
        this.plugin.renderer.render();
      });
    }

    new Setting(containerEl)
      .setName("Open metadata panel after create")
      .setDesc("Show the metadata panel immediately after the command creates a simplex.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.commandAutoOpenPanel);
        toggle.onChange(async (value) => {
          this.plugin.settings.commandAutoOpenPanel = value;
          await this.plugin.saveSettings();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Metadata hover delay")
        .setDesc("Delay before hover-driven metadata UI should appear.");
      this.addNumberSlider(setting, this.plugin.settings.metadataHoverDelayMs, 250, 2000, 50, async (value) => {
        this.plugin.settings.metadataHoverDelayMs = value;
        await this.plugin.saveSettings();
      });
    }
  }

  private renderBettiSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Show missing-face opportunities")
      .setDesc("Temporarily unavailable in v0.4.5 because the interactive missing-face scan is computation intensive.")
      .addToggle((toggle) => {
        toggle.setValue(false);
        toggle.setDisabled(true);
      });

    new Setting(containerEl)
      .setName("Display betti on canvas")
      .setDesc("Show actual homology ranks over F₂ in the top-left HUD.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.bettiDisplayOnCanvas);
        toggle.onChange(async (value) => {
          this.plugin.settings.bettiDisplayOnCanvas = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
          new Notice(value ? "Betti HUD will appear in top-left of graph" : "Betti HUD hidden");
        });
      });

    new Setting(containerEl)
      .setName("Max betti dimension")
      .setDesc("Choose the highest homology dimension reported for the analyzed skeleton.")
      .addDropdown((dropdown) => {
        dropdown.addOption("1", "Through β₁");
        dropdown.addOption("2", "Through β₂");
        dropdown.setValue(String(this.plugin.settings.maxBettiDim));
        dropdown.onChange(async (value) => {
          this.plugin.settings.maxBettiDim = Number(value) as 1 | 2;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    new Setting(containerEl)
      .setName("Show filtration slider")
      .setDesc("Enable the slider UI with simplex-appearance markers. Persistence births and deaths arrive in v0.5.0.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showFiltrationSlider);
        toggle.onChange(async (value) => {
          this.plugin.settings.showFiltrationSlider = value;
          await this.plugin.saveSettings();
          this.plugin.simplicialView?.refreshSettings();
          new Notice(value ? "Filtration slider enabled" : "Filtration slider hidden");
        });
      });

    new Setting(containerEl)
      .setName("Enable explanation panel")
      .setDesc("Show human-readable explanations for inferred simplices in the metadata panel.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableExplanationPanel);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableExplanationPanel = value;
          await this.plugin.saveSettings();
          this.plugin.panelView?.setSettings(this.plugin.settings);
          new Notice(value ? "Explanation cards enabled" : "Explanation cards disabled");
        });
      });
  }

  private renderEmergentSettings(containerEl: HTMLElement): void {
    // V2 Settings Section - Inference Architecture
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The plugin has two inference systems: emergent (graph-based with semantic clustering) and legacy (rule-based). Choose which to use.",
    });

    new Setting(containerEl)
      .setName("Inference mode")
      .setDesc("Emergent = semantic graph analysis | legacy = rule-based heuristics | hybrid = both")
      .addDropdown((dropdown) => {
        dropdown.addOption("emergent", "Emergent (semantic graph)");
        dropdown.addOption("taxonomic", "Legacy (rule-based)");
        dropdown.addOption("hybrid", "Hybrid (both systems)");
        dropdown.setValue(this.plugin.settings.inferenceMode);
        dropdown.onChange(async (value) => {
          this.plugin.settings.inferenceMode = value as PluginSettings["inferenceMode"];
          await this.plugin.saveSettings();
          new Notice(`Inference mode: ${value}. Rescanning vault...`);
          this.plugin.scheduleFullScan("inference-mode-changed", 100);
          this.refreshSettingVisibility();
        });
      });

    // Emergent-mode settings (shown first as primary option)
    const emergentSettingsDiv = containerEl.createDiv({ cls: "emergent-settings" });

    new Setting(emergentSettingsDiv).setName("Emergent inference").setHeading();

    new Setting(emergentSettingsDiv)
      .setName("Domain source")
      .setDesc("How note domains are determined for coloring and edge strength.")
      .addDropdown((dropdown) => {
        dropdown.addOption("folder", "Folder structure");
        dropdown.addOption("content-cluster", "Content clustering (tf-idf)");
        dropdown.addOption("hybrid", "Hybrid (folder + content)");
        dropdown.setValue(this.plugin.settings.domainSource);
        dropdown.onChange(async (value) => {
          this.plugin.settings.domainSource = value as PluginSettings["domainSource"];
          await this.plugin.saveSettings();
          new Notice(`Domain source: ${value}. Rescanning...`);
          this.plugin.scheduleFullScan("domain-source-changed", 100);
        });
      });

    {
      const setting = new Setting(emergentSettingsDiv)
        .setName("Content cluster count")
        .setDesc("Number of semantic clusters (used when domain source is content-cluster or hybrid).");
      this.addNumberSlider(setting, this.plugin.settings.contentClusterCount, 2, 12, 1, async (value) => {
        this.plugin.settings.contentClusterCount = value;
        await this.plugin.saveSettings();
        if (this.plugin.settings.domainSource !== "folder") {
          new Notice(`Cluster count: ${value}. Rescanning...`);
          this.plugin.scheduleFullScan("cluster-count-changed", 100);
        }
      });
    }

    {
      const setting = new Setting(emergentSettingsDiv)
        .setName("Link strength threshold")
        .setDesc(
          "Minimum edge strength for emergent mode to create a visible link (0.0 = all edges, 1.0 = only strongest).",
        );
      this.addNumberSlider(setting, this.plugin.settings.linkStrengthThreshold, 0, 1, 0.01, async (value) => {
        this.plugin.settings.linkStrengthThreshold = value;
        await this.plugin.saveSettings();
        new Notice(`Link threshold: ${value.toFixed(2)}. Rescanning...`);
        this.plugin.scheduleFullScan("link-threshold-changed", 100);
      });
    }

    // Store reference to emergent settings div for visibility toggling
    (this as unknown as Record<string, HTMLElement>)["_emergentSettingsDiv"] = emergentSettingsDiv;
  }

  private renderLegacySettings(containerEl: HTMLElement): void {
    // Legacy inference weights (only apply when inference mode is taxonomic or hybrid)
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "These weights only apply when using legacy or hybrid inference mode. They control rule-based edge detection.",
    });

    this.addWeightSlider(
      containerEl,
      "Link weight",
      "Strength added by a resolved outbound link.",
      "linkWeight",
      "enableLinkInference",
      0,
      0.6,
      0.01,
    );
    this.addWeightSlider(
      containerEl,
      "Mutual link bonus",
      "Extra weight when both notes link each other.",
      "mutualLinkBonus",
      "enableMutualLinkBonus",
      0,
      0.6,
      0.01,
    );
    this.addWeightSlider(
      containerEl,
      "Shared tag weight",
      "Weight contributed by each shared tag.",
      "sharedTagWeight",
      "enableSharedTags",
      0,
      0.2,
      0.01,
    );
    this.addWeightSlider(
      containerEl,
      "Title overlap weight",
      "Maximum title-token overlap contribution.",
      "titleOverlapWeight",
      "enableTitleOverlap",
      0,
      0.3,
      0.01,
    );
    this.addWeightSlider(
      containerEl,
      "Content overlap weight",
      "Maximum body-text overlap contribution.",
      "contentOverlapWeight",
      "enableContentOverlap",
      0,
      0.3,
      0.01,
    );
    this.addWeightSlider(
      containerEl,
      "Same folder weight",
      "Boost when two notes share the same folder (Legacy mode only).",
      "sameFolderWeight",
      "enableSameFolderInference",
      0,
      0.2,
      0.01,
    );
    this.addWeightSlider(
      containerEl,
      "Top folder weight",
      "Boost when two notes share the same top-level folder (Legacy mode only).",
      "sameTopFolderWeight",
      "enableSameTopFolderInference",
      0,
      0.2,
      0.01,
    );
  }

  private refreshSettingVisibility(): void {
    const emergentDiv = (this as unknown as Record<string, HTMLElement>)["_emergentSettingsDiv"];
    if (!emergentDiv) return;
    const isEmergentMode =
      this.plugin.settings.inferenceMode === "emergent" || this.plugin.settings.inferenceMode === "hybrid";
    emergentDiv.style.display = isEmergentMode ? "block" : "none";
  }

  private addNumberSlider(
    setting: Setting,
    initialValue: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => Promise<void>,
  ): void {
    setting.addSlider((slider) => {
      const valueEl = setting.controlEl.createSpan({ cls: "simplicial-setting-value" });
      const format = (value: number): string => {
        const decimals = step >= 1 ? 0 : (`${step}`.split(".")[1]?.length ?? 0);
        return value
          .toFixed(decimals)
          .replace(/\.0+$/, "")
          .replace(/(\.\d*?)0+$/, "$1");
      };

      valueEl.setText(format(initialValue));
      slider.setLimits(min, max, step);
      slider.setValue(initialValue);
      slider.onChange(async (value) => {
        valueEl.setText(format(value));
        await onChange(value);
      });
    });
  }

  private addWeightSlider(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    key: keyof Pick<
      PluginSettings,
      | "linkWeight"
      | "mutualLinkBonus"
      | "sharedTagWeight"
      | "titleOverlapWeight"
      | "contentOverlapWeight"
      | "sameFolderWeight"
      | "sameTopFolderWeight"
    >,
    enabledKey: keyof Pick<
      PluginSettings,
      | "enableLinkInference"
      | "enableMutualLinkBonus"
      | "enableSharedTags"
      | "enableTitleOverlap"
      | "enableContentOverlap"
      | "enableSameFolderInference"
      | "enableSameTopFolderInference"
    >,
    min: number,
    max: number,
    step: number,
  ): void {
    const setting = new Setting(containerEl).setName(name).setDesc(desc);
    let sliderRef: SliderComponent | null = null;
    const format = (value: number): string => {
      const decimals = step >= 1 ? 0 : (`${step}`.split(".")[1]?.length ?? 0);
      return value
        .toFixed(decimals)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*?)0+$/, "$1");
    };

    setting.addToggle((toggle) => {
      toggle.setTooltip("Enable or disable this inference signal");
      toggle.setValue(this.plugin.settings[enabledKey]);
      toggle.onChange(async (value) => {
        this.plugin.settings[enabledKey] = value;
        sliderRef?.setDisabled(!value);
        await this.plugin.saveSettings();
      });
    });

    setting.addSlider((slider) => {
      sliderRef = slider;
      const valueEl = setting.controlEl.createSpan({ cls: "simplicial-setting-value" });
      valueEl.setText(format(this.plugin.settings[key]));
      slider.setLimits(min, max, step);
      slider.setValue(this.plugin.settings[key]);
      slider.setDisabled(!this.plugin.settings[enabledKey]);
      slider.onChange(async (value) => {
        valueEl.setText(format(value));
        this.plugin.settings[key] = value;
        await this.plugin.saveSettings();
      });
    });
  }
}
