import tsparser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

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
      ...obsidianmd.configs.recommended[0].rules,
      "obsidianmd/sample-names": "off",
      "obsidianmd/prefer-file-manager-trash-file": "error",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }],
    },
  },
]);
