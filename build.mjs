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
  // Since Prettier 3.0 `--ignore-path` defaults to `.gitignore`, and this intermediate
  // is git-ignored on purpose — so the default would make Prettier skip the one file
  // this function exists to format. Point it at `.prettierignore` instead (absent here;
  // a missing ignore path is not an error) so only a deliberate Prettier ignore counts.
  const ignorePath = ["--ignore-path", ".prettierignore"];
  const run = (args) =>
    spawnSync(process.execPath, [prettier, ...ignorePath, ...args, file], { stdio: "ignore" }).status === 0;
  // `--check` exits 0 for a file Prettier skipped just as it does for a file that is
  // already formatted, so the loop below cannot distinguish "settled" from "never
  // looked at" — which is exactly how an unformatted bundle can reach a release. Ask
  // outright whether this file is in scope, and refuse to publish if it is not.
  const info = spawnSync(process.execPath, [prettier, ...ignorePath, "--file-info", file], { encoding: "utf8" });
  if (info.status !== 0 || JSON.parse(info.stdout).ignored) {
    console.error(`[simplicial-complex] Prettier would skip ${file}; the published bundle would be unformatted`);
    process.exit(1);
  }
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

/**
 * Bundle the topology worker into a string.
 *
 * Obsidian's community-plugin installer downloads only `manifest.json`, `main.js` and
 * `styles.css`. A sibling `workers/topology.js` would never exist in an installed vault,
 * so the worker is compiled separately, inlined as a string constant, and started from a
 * `Blob` URL at runtime. This emits no second file by design.
 */
async function buildWorkerSource() {
  const result = await esbuild.build({
    entryPoints: ["core/topology/worker-entry.ts"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: production,
    legalComments: "none",
    treeShaking: true,
    logLevel: "warning",
    define: {
      "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
    },
  });
  const source = result.outputFiles[0].text;
  // A worker that silently bundled to nothing would fail only at runtime, in an
  // installed vault, on a machine that is not this one.
  if (!source.includes("persistence-result")) {
    console.error("[simplicial-complex] worker bundle is missing its response protocol");
    process.exit(1);
  }
  console.log(`[simplicial-complex] topology worker inlined (${(source.length / 1024).toFixed(1)} KB)`);
  return source;
}

const workerSource = await buildWorkerSource();

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
    __TOPOLOGY_WORKER_SOURCE__: JSON.stringify(workerSource),
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
