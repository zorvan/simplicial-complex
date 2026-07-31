# Contributing to Simplicial Complex for Obsidian

Thank you for your interest in contributing! This plugin is in active early development. We welcome issues and pull requests.

---

## Quick Start

```bash
git clone https://github.com/zorvan/simplicial-complex
cd simplicial-complex
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/simplicial-complex/` in your vault, then reload Obsidian.

---

## Before You Contribute

### Read the Spec

**[`SPEC.md`](./SPEC.md)** is the authoritative source for architectural decisions and constraints. Pay special attention to **§9 (Critical Implementation Constraints)** — these are non-negotiable and PRs violating them will be rejected.

### Key Principles

1. **Model purity**: `core/` must remain free of Obsidian API dependencies
2. **Renderer as projection**: No business logic in rendering code
3. **Vault as source of truth**: Simplex definitions live in vault files
4. **No silent failures**: Log errors and surface them to users
5. **Canonical keys**: Always sorted, always lowercased

---

## Development Workflow

### Build

```bash
npm run build        # Production build
npm run build:dev    # Development build with sourcemaps
```

### Type Check

```bash
npm run check
```

### Lint & Format

```bash
npm run lint         # Check for issues
npm run lint:fix     # Auto-fix what's possible
npm run format       # Format all TypeScript
npm run format:check # Verify formatting
```

### Test

```bash
npm test             # Compile and run tests
```

### Run CI locally

Before pushing, run everything `.github/workflows/ci.yml` runs:

```bash
npm run verify
```

This executes the same four jobs in the same order — Lint & Format, Type Check, Build, Test — plus a release preflight that checks `manifest.json`, `package.json` and `versions.json` agree on the version. It takes seconds, needs no Docker, and exits non-zero if any job fails.

For true workflow-level fidelity — the actual runner image, action versions and step wiring — use [`act`](https://github.com/nektos/act):

```bash
npm run ci:act:list  # list the jobs act sees
npm run ci:act       # run ci.yml in a container
```

`act` needs Docker and network access (it runs `npm ci` inside the container), so it is slower and heavier. `npm run verify` is the one to run habitually; reach for `act` when you have changed a workflow file itself.

`release.yml` is not runnable locally in any meaningful way — it needs a real tag, `GITHUB_TOKEN`, and Sigstore attestation. The parts that _are_ checkable locally (build output present, version consistency) are covered by `npm run verify`.

> **Keep them in step.** `scripts/verify.mjs` mirrors `ci.yml` by hand. If you add a job to the workflow, add it there too, or the script stops being the thing it claims to be.

---

## Where Contributions Are Most Useful

### High Priority

1. **Parser edge cases** — Special characters in note titles, nested frontmatter, aliases, wikilink resolution
2. **Rendering performance** — Offscreen canvas caching, frame budget profiling, Barnes-Hut tuning
3. **Test coverage** — Layout engine, persistence round-trips, vault indexing
4. **Error handling** — Graceful degradation when file I/O fails

### Medium Priority

1. **Settings validation** — Runtime validation, migration scripts
2. **Accessibility** — Keyboard navigation, screen reader support
3. **Documentation** — Tutorial content, example vaults
4. **UI polish** — Filter sliders, legend improvements, HUD elements

### Research / Experimental

1. **Betti numbers** — Persistent homology computation
2. **ML embeddings** — Semantic similarity via vector models
3. **Graph neural networks** — Structure prediction
4. **Field-based layout** — Region-generating fields vs. current force model

---

## Pull Request Guidelines

### Before Submitting

- [ ] Code passes `npm run check` (no type errors)
- [ ] Code passes `npm run lint` (no ESLint errors)
- [ ] Code passes `npm run format:check` (Prettier compliant)
- [ ] Tests pass (`npm test`)
- [ ] New functionality includes tests
- [ ] Commit messages are clear and follow project style

### Commit Message Style

- Prefer clear, concise messages over verbose explanations
- Focus on "why" over "what" when possible
- Examples:
  - ✅ `Fix rename tracking for pinned nodes`
  - ✅ `Add viewport culling to renderer`
  - ❌ `update stuff`
  - ❌ `fix bug in thing`

### PR Description

Include:

- What this changes does
- Why this change is needed (link to issue if applicable)
- Screenshots for visual changes
- Any breaking changes or migration steps

---

## Reporting Issues

### Bug Reports

Include:

- Obsidian version
- Plugin version
- Steps to reproduce
- Expected vs actual behavior
- Vault file example (minimal, if possible)
- Screenshots/console logs if relevant

### Feature Requests

Include:

- What problem this solves
- How it fits the simplicial model (vs. tags/groups/links)
- Any mathematical/topological basis (if applicable)

---

## Design Philosophy

### Why Both Simplicial Complexes and Hypergraphs?

_Revised in v0.4.0. Earlier versions modelled only simplicial complexes._

Simplicial complexes are the mathematically better-behaved object: they carry built-in hierarchy (every face of a simplex is also in the complex), support rigorous topological analysis (Betti numbers, persistent homology), and render elegantly as organic regions rather than geometric clutter. All of that still holds.

But it answered the wrong question. Downward closure is a _claim_, and generating faces makes it on the user's behalf. When three notes appeared together during one insight, that says nothing about whether any two of them mean something apart. Emergence that cannot be reduced to proper subgroups belongs first to the hypergraph; simplicial structure is what a relation becomes once its coherence is supported across its faces.

So both layers exist, kept structurally separate, with explicit user-driven transformations between them.

**The invariant every contributor must preserve:** a hyperedge never passes through `generateFaces()`, never enters `model.simplices`, and never contributes to boundary or Betti computation. `tests/hypergraph.test.ts` asserts this after every public mutation; if you add a mutation, add it there too.

### Why Organic Blobs and Not Crisp Triangles?

The primary use case is cognitive — building and navigating a personal knowledge base. Soft blobs are easier to perceive as "fields of meaning" than precise geometry. The formal geometric view (crisp triangles, wireframe tetrahedra) is available via toggle for when topological analysis becomes the focus.

### Why Not Store Simplices in a Database?

The vault is the source of truth. Simplex definitions stored in frontmatter are human-readable, version-controllable, and survive plugin reinstalls and Obsidian Sync without conflict. The plugin reads from the vault; it does not own the data.

---

## Code of Conduct

- Be respectful and constructive
- Focus on the technical merits of contributions
- When in doubt, ask before making large changes
- Review the SPEC before submitting PRs

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
