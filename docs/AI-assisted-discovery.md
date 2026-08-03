# AI-assisted discovery

Simplicial Complex does not connect to an AI service or send vault content anywhere. You can independently give a trusted, file-capable agent access to selected vault material and use the static prompts bundled with the plugin to prepare proposals.

The agent is a reader, not an oracle: it may compare notes, propose encounters and local contextual readings, cite evidence, and formulate precise questions. It must not silently change what the vault claims.

## Workflow

1. Choose which folders the external tool may read; exclude private material.
2. Open **Record encounter** or the **Contextuality Lab** and copy the appropriate prompt.
3. Ask for a read-only first pass.
4. Check every cited path, uncertainty, and user-only question.
5. Record accepted encounters through the plugin. Enter accepted context worksheets in the Contextuality Lab.
6. If you later permit edits, inspect the exact diff first.

## Invariants

- A proposal is not a vault fact.
- Semantic similarity does not prove that an encounter occurred.
- An encounter never generates faces and is never promoted automatically.
- A context-relative role is not a note's absolute identity.
- Ordinary disagreement between contexts is not contextuality.
- Relation history is append-only and must not be edited by an agent.
- Every proposal must cite supporting vault paths.

The complete, current prompts are available inside the plugin through **Open complete guide**, which avoids the documentation and the installed plugin drifting apart.
