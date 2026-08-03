/**
 * Runs everything .github/workflows/ci.yml runs, natively and in the same order.
 *
 * This is the fast path — seconds, no Docker. For true workflow-level fidelity
 * (matrix, runner image, action versions) use `npm run ci:act`, which executes the
 * actual workflow file.
 *
 * Keep the JOBS list below in step with ci.yml. If a job is added there and not
 * here, this script stops being the thing it claims to be.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const JOBS = [
  { name: "Lint & Format", steps: ["npm run lint", "npm run format:check"] },
  { name: "Type Check", steps: ["npm run check"] },
  { name: "Build", steps: ["npm run build"], after: verifyBuildOutput },
  { name: "Test", steps: ["npm test"] },
  { name: "Release preflight", steps: [], after: verifyVersions },
];

/** The release workflow refuses to publish without these. */
function verifyBuildOutput() {
  const missing = ["main.js", "styles.css", "manifest.json"].filter((asset) => !existsSync(asset));
  if (missing.length > 0) throw new Error(`missing release asset(s): ${missing.join(", ")}`);
  return "main.js, styles.css and manifest.json present";
}

/**
 * release.yml fails if the tag disagrees with manifest.json. There is no tag
 * locally, so check the things that are knowable now: that manifest, package.json
 * and versions.json agree with each other.
 */
function verifyVersions() {
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const manifest = read("manifest.json").version;
  const pkg = read("package.json").version;
  if (manifest !== pkg) {
    throw new Error(`manifest.json is ${manifest} but package.json is ${pkg}`);
  }
  if (existsSync("versions.json")) {
    const versions = read("versions.json");
    if (!versions[manifest]) {
      throw new Error(`versions.json has no entry for ${manifest}`);
    }
  }
  return `version ${manifest} consistent across manifest, package.json and versions.json`;
}

function run(command) {
  const result = spawnSync(command, { stdio: "inherit", shell: true });
  return result.status === 0;
}

let failed = 0;
const summary = [];

for (const job of JOBS) {
  process.stdout.write(`\n[1m── ${job.name} ${"─".repeat(Math.max(0, 56 - job.name.length))}[0m\n`);
  let ok = true;
  for (const step of job.steps) {
    if (!run(step)) {
      ok = false;
      break;
    }
  }
  let note = "";
  if (ok && job.after) {
    try {
      note = job.after() ?? "";
    } catch (error) {
      ok = false;
      note = error instanceof Error ? error.message : String(error);
      process.stdout.write(`[31m${note}[0m\n`);
    }
  }
  if (ok && note) process.stdout.write(`${note}\n`);
  if (!ok) failed++;
  summary.push({ name: job.name, ok });
}

process.stdout.write(`\n[1m── Summary ${"─".repeat(46)}[0m\n`);
for (const { name, ok } of summary) {
  process.stdout.write(`  ${ok ? "[32mPASS[0m" : "[31mFAIL[0m"}  ${name}\n`);
}

if (failed > 0) {
  process.stdout.write(`\n[31m${failed} job(s) failed.[0m\n`);
  process.exit(1);
}
process.stdout.write("\n[32mAll CI jobs pass locally.[0m\n");
