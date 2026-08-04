import { test } from "node:test";
import { strict as assert } from "node:assert";

test("production TypeScript uses Obsidian element creation helpers", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const productionDirectories = ["core", "data", "interaction", "layout", "render", "settings", "ui"];
  const violations: string[] = [];

  async function inspect(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        await inspect(path);
      } else if (entry.name.endsWith(".ts")) {
        const source = await readFile(path, "utf8");
        if (/\.createElement\s*\(/u.test(source)) violations.push(path);
      }
    }
  }

  await Promise.all(productionDirectories.map(inspect));
  assert.deepEqual(violations, [], "Use createEl/createDiv/createSpan instead of createElement");
});

test("the settings tab exposes searchable declarative definitions", async () => {
  const { readFile } = await import("node:fs/promises");
  const settingTab = await readFile("settings/setting-tab.ts", "utf8");
  assert.match(settingTab, /\bgetSettingDefinitions\s*\(/u);
  assert.match(settingTab, /\baliases\b/u);

  const definitions = settingTab.slice(
    settingTab.indexOf("getSettingDefinitions()"),
    settingTab.indexOf("private settingSection("),
  );
  const imperativeNames = [...settingTab.matchAll(/\.setName\("([^"]+)"\)/gu)].map((match) => match[1]);
  const missingFromSearch = imperativeNames.filter((name) => !definitions.includes(JSON.stringify(name)));
  assert.deepEqual(missingFromSearch, [], "Every imperative setting name must be indexed by the 1.13 API");
});
