import tsparser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

// The plugin ships `recommended` as a flat-config *array*; the obsidianmd rules
// live in a later entry, so reading only `recommended[0]` silently enables none
// of them. Collect every obsidianmd/* rule across the whole array instead —
// these are the rules the community-plugin review bot reports against.
const obsidianmdRecommendedRules = Object.fromEntries(
  obsidianmd.configs.recommended
    .flatMap((config) => Object.entries(config.rules ?? {}))
    .filter(([name]) => name.startsWith("obsidianmd/")),
);

export default defineConfig([
  {
    ignores: ["tests/**", "tests-dist/**", "node_modules/**", "**/*.mjs", "**/*.js"],
  },
  {
    files: ["**/*.ts"],
    plugins: { obsidianmd, "@typescript-eslint": tseslint.plugin },
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    rules: {
      ...obsidianmdRecommendedRules,
      "obsidianmd/sample-names": "off",
      "obsidianmd/prefer-file-manager-trash-file": "error",
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
]);
