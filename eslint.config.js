import tsparser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import publisher from "./scripts/eslint-publisher-rules.mjs";

// The plugin ships `recommended` as a flat-config *array*; the obsidianmd rules
// live in a later entry, so reading only `recommended[0]` silently enables none
// of them. Collect every obsidianmd/* rule across the whole array instead —
// these are the rules the community-plugin review bot reports against.
const obsidianmdRecommendedRules = Object.fromEntries(
  obsidianmd.configs.recommended
    .flatMap((config) => Object.entries(config.rules ?? {}))
    .filter(([name]) => name.startsWith("obsidianmd/")),
);

// `recommended` leaves out the two locale rules; they live in `recommendedWithLocalesEn`,
// already scoped to the English locale filenames they apply to. There are no locale files
// yet, so these entries are inert — they exist so adding one cannot quietly skip the check.
const obsidianmdLocaleConfigs = obsidianmd.configs.recommendedWithLocalesEn.filter((config) =>
  Object.keys(config.rules ?? {}).some((name) => name.startsWith("obsidianmd/ui/sentence-case-")),
);

export default defineConfig([
  {
    ignores: ["tests/**", "tests-dist/**", "node_modules/**", "**/*.mjs", "**/*.js"],
  },
  {
    files: ["**/*.ts"],
    plugins: { obsidianmd, publisher, "@typescript-eslint": tseslint.plugin },
    // A directive that no longer suppresses anything is a suppression waiting to be
    // inherited by unrelated code, so it fails here rather than lingering.
    linterOptions: { reportUnusedDisableDirectives: "error" },
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    rules: {
      ...obsidianmdRecommendedRules,
      "obsidianmd/sample-names": "off",
      "obsidianmd/prefer-file-manager-trash-file": "error",
      // The review bot's two checks on the suppressions themselves. See
      // scripts/eslint-publisher-rules.mjs for why they are local rules.
      "publisher/no-obsidian-rule-suppression": "error",
      "publisher/require-directive-description": "error",
      "@typescript-eslint/no-duplicate-type-constituents": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='createElement']",
          message: "Use Obsidian's createEl/createDiv/createSpan helpers instead of document.createElement.",
        },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  ...obsidianmdLocaleConfigs,
]);
