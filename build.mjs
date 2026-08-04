import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { renameSync } from "node:fs";
import process from "node:process";

const production = process.argv[2] === "production";
const watch = process.argv.includes("--watch");
const bundleOutput = production && !watch ? ".main.build.js" : "main.js";

/**
 * Format the bundle until Prettier stops changing it.
 *
 * One pass is not enough. Prettier is not idempotent on the single enormous line
 * esbuild emits under `minify`: the first pass breaks it up, the second settles the
 * result, and `prettier --check` fails in between. The committed `main.js` only
 * looked clean because the extra pass had been run by hand, which meant CI's
 * format check was one build away from failing at any time.
 */
function prettifyBundle(file, maxPasses = 4) {
  // Invoked through node against the resolved binary rather than through a shell,
  // so this behaves the same on every platform and escapes nothing.
  const prettier = createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs");
  const run = (args) => spawnSync(process.execPath, [prettier, ...args, file], { stdio: "ignore" }).status === 0;
  for (let pass = 1; pass <= maxPasses; pass++) {
    run(["--write"]);
    if (run(["--check"])) {
      console.log(`[simplicial-complex] ${file} formatted in ${pass} pass${pass === 1 ? "" : "es"}`);
      return;
    }
  }
  console.error(`[simplicial-complex] ${file} did not reach a stable format in ${maxPasses} passes`);
  process.exit(1);
}

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: bundleOutput,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  sourcemap: production ? false : "inline",
  minify: production,
  legalComments: "none",
  treeShaking: true,
  logLevel: "info",
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/commands",
    "@codemirror/search",
    "@codemirror/language",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/lint",
    "@codemirror/panel",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
  },
});

if (watch) {
  await context.watch();
  console.log("[simplicial-complex] watching for changes...");
} else {
  await context.rebuild();
  await context.dispose();
  if (production) {
    prettifyBundle(bundleOutput);
    // Obsidian may be watching the installed development directory. Publishing
    // only the settled bundle prevents it from loading esbuild/Prettier's
    // intermediate files and orphaning the plugin's live workspace leaves.
    renameSync(bundleOutput, "main.js");
    console.log("[simplicial-complex] main.js published atomically");
  }
}
