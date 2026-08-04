import type { Simplex, MissingFaceBoundary, NodeID } from "../core/types";
import type { EncounterDiagnostics } from "../core/diagnostics";
import type { InferenceContext, NoteProfile } from "./inference/types";

export interface SimplexExplanation {
  headline: string;
  tension: string;
  prompt: string;
  signals: string[];
}

/**
 * One plain-language line per diagnostic. The register is deliberate: these are
 * readings offered to a person, not metrics reported to an operator, and each one
 * should be a sentence someone would actually say about their own notes.
 */
export interface EncounterReadings {
  headline: string;
  closure: string | null;
  independence: string | null;
  persistence: string;
  overlap: string | null;
}

function shortName(nodeId: NodeID): string {
  return nodeId.split("/").pop()?.replace(/\.md$/, "") ?? nodeId;
}

function readClosure(diagnostics: EncounterDiagnostics): string | null {
  const closure = diagnostics.closure;
  if (!closure) return null;
  if (closure.unbounded) {
    return "Too large to enumerate what it implies. The closure deficit here is unmeasured, not zero.";
  }
  if (closure.missingCount === 0) {
    return "Every relation this encounter implies already exists in the complex. Promoting it would assert nothing new.";
  }
  const order = diagnostics.nodes.length;
  const deficit = closure.deficit ?? 0;
  if (deficit >= 0.8) {
    return `This cluster looks visually coherent, but its meaning exists only at order ${order} — ${closure.missingCount} of the ${closure.impliedFaceCount} relations it implies are absent.`;
  }
  if (deficit >= 0.4) {
    return `${closure.missingCount} of the ${closure.impliedFaceCount} implied relations are absent. Part of this group is already understood; part of it is not.`;
  }
  return `Most of what this encounter implies already exists — ${closure.missingCount} implied relation${closure.missingCount === 1 ? " is" : "s are"} still absent.`;
}

function readIndependence(diagnostics: EncounterDiagnostics): string | null {
  const independence = diagnostics.independence;
  if (!independence) return null;
  if (independence.unbounded) return "Too large to test its subgroups against the vault.";
  if (independence.independence === null) {
    return "A two-note encounter has no proper subgroup, so there is nothing for it to be irreducible to.";
  }
  const subset = independence.strongestSubset?.map(shortName).join(" · ");
  if (independence.independence >= 0.75) {
    return independence.fullSetScore >= 0.3
      ? "The group is evidenced by the vault; no subgroup inside it is. That is what irreducible looks like."
      : "Neither the group nor any subgroup inside it is evidenced by the vault. This encounter rests on your assertion alone — which is a reason to keep it, not to promote it.";
  }
  if (independence.independence >= 0.4) {
    return `Some of this group stands on its own${subset ? ` — ${subset} most of all` : ""}, but not all of it.`;
  }
  return `${subset ?? "A subgroup"} is already well evidenced without the rest. This may be a simplex you have not asserted yet.`;
}

function readPersistence(diagnostics: EncounterDiagnostics, threshold: number): string {
  const count = Math.max(1, diagnostics.occurrences.length);
  const times = `${count}×`;
  if (diagnostics.persistence !== "recurring") {
    return `Encountered ${times}. Recurring at ${threshold} — repetition is evidence, never proof.`;
  }
  if (diagnostics.vitality >= count * 0.7) {
    return `Recurring and still warm: ${times}, most of it recent.`;
  }
  if (diagnostics.vitality < 1) {
    return `Recurring, but cooled: ${times}, none of it lately.`;
  }
  return `Recurring: ${times}, some of it a while ago.`;
}

function readOverlap(diagnostics: EncounterDiagnostics): string | null {
  const peak = diagnostics.peakOverlap;
  if (!peak || peak.pressure < 0.4) return null;
  return `${shortName(peak.nodeId)} sits in ${peak.incidentEncounters} encounters that barely overlap each other. It may be carrying contexts that do not belong together.`;
}

/**
 * HG-15. The four hypergraph measures, each as one line a reader can act on.
 */
export function explainEncounter(diagnostics: EncounterDiagnostics, recurrenceThreshold: number): EncounterReadings {
  return {
    headline:
      "These notes came together as one irreducible whole. No pair among them is asserted to be meaningful on its own.",
    closure: readClosure(diagnostics),
    independence: readIndependence(diagnostics),
    persistence: readPersistence(diagnostics, recurrenceThreshold),
    overlap: readOverlap(diagnostics),
  };
}

/**
 * The vault-level reading behind the HUD figure. `null` when nothing is measurable.
 */
export function explainSimpliciality(value: number | null, encounterCount: number): string | null {
  if (value === null || encounterCount === 0) return null;
  if (value >= 0.9) {
    return "Nearly everything your encounters imply already exists as a relation. The hypergraph is barely saying anything the complex does not.";
  }
  if (value >= 0.5) {
    return "Your encounters sit on a partly filled-in neighbourhood: some of what they imply exists, much of it does not.";
  }
  return "Your encounters imply far more than the complex asserts. Most of this vault's higher-order meaning has not been decomposed — and may not decompose.";
}

/**
 * Generate a human-readable explanation of why a simplex was inferred
 * and what question it poses to the user.
 */
export function explainSimplex(
  simplex: Simplex,
  nodes: NoteProfile[],
  contexts: Map<string, InferenceContext>,
  holes: MissingFaceBoundary[],
): SimplexExplanation {
  const nodeIds = simplex.nodes;
  const nodeProfiles = nodeIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as NoteProfile[];

  // Check if this simplex fills a hole
  const filledHole = holes.find(
    (h) => h.missingSimplex.length === nodeIds.length && h.missingSimplex.every((n) => nodeIds.includes(n)),
  );

  if (simplex.inferred) {
    return explainInferredSimplex(simplex, nodeProfiles, contexts, filledHole);
  }

  if (simplex.autoGenerated) {
    return explainAutoFace(simplex);
  }

  return explainUserDefinedSimplex(simplex, nodeProfiles);
}

function explainInferredSimplex(
  simplex: Simplex,
  nodes: NoteProfile[],
  contexts: Map<string, InferenceContext>,
  filledHole: MissingFaceBoundary | undefined,
): SimplexExplanation {
  const dim = simplex.nodes.length - 1;
  const nodeNames = nodes.map((n) => n.id.replace(/\.md$/, ""));
  const signals = simplex.inferredSignals ?? [];

  // Check for hole-filling
  if (filledHole) {
    return {
      headline: `This ${dim === 1 ? "edge" : dim === 2 ? "triangle" : "tetrahedron"} fills a local missing face.`,
      tension: `Notes ${nodeNames.join(" · ")} bounded an absent simplex. This structure now completes that local motif.`,
      prompt: `Does this new connection reveal a synthesis you hadn't consciously noticed?`,
      signals: [
        filledHole.dimension === 1 ? "Fills a triangular missing face" : "Fills a tetrahedral missing face",
        ...signals,
      ],
    };
  }

  // Bridge pattern detection
  if (dim === 2 && nodes.length === 3) {
    const bridgeNode = detectBridgeNode(nodes, contexts);
    if (bridgeNode) {
      const otherNodes = nodeNames.filter((n) => n !== bridgeNode.replace(/\.md$/, ""));
      return {
        headline: "Three notes form a structural bridge through a common connection.",
        tension: `${otherNodes[0]} and ${otherNodes[1]} both connect to ${bridgeNode.replace(/\.md$/, "")}, but have no direct link between them.`,
        prompt: `What would a note directly relating "${otherNodes[0]}" and "${otherNodes[1]}" say?`,
        signals: ["Bridge pattern detected", ...signals],
      };
    }
  }

  // Cross-domain detection
  const domains = new Set(nodes.map((n) => n.domain));
  if (domains.size > 1) {
    return {
      headline: `Cross-domain ${dim === 1 ? "relation" : dim === 2 ? "triangle" : "synthesis"} spanning ${domains.size} conceptual areas.`,
      tension: `Connects: ${[...domains].join(" · ")}. These domains rarely intersect in your vault.`,
      prompt: `What insight emerges from seeing these domains together?`,
      signals: [`Cross-domain: ${[...domains].join(" + ")}`, ...signals],
    };
  }

  // Default inferred explanation
  return {
    headline: `${dim === 1 ? "An inferred relation" : dim === 2 ? "An inferred triangle" : "An inferred higher-order structure"} among ${nodes.length} notes.`,
    tension: `Based on ${signals.length > 0 ? signals.join(" · ") : "vault structure analysis"}.`,
    prompt: `Is this a meaningful connection worth confirming?`,
    signals: signals.length > 0 ? signals : ["Pattern-based inference"],
  };
}

function explainAutoFace(simplex: Simplex): SimplexExplanation {
  const dim = simplex.nodes.length - 1;

  return {
    headline: `Auto-generated face of a ${dim + 1}-simplex.`,
    tension: `This ${dim === 1 ? "edge" : dim === 2 ? "triangle" : "tetrahedron"} is the boundary of a higher-dimensional simplex you defined.`,
    prompt: `Faces help visualize the structure but cannot be edited independently.`,
    signals: [`Face of ${simplex.parentKey || "parent simplex"}`],
  };
}

function explainUserDefinedSimplex(simplex: Simplex, nodes: NoteProfile[]): SimplexExplanation {
  const dim = simplex.nodes.length - 1;
  const nodeNamesList = nodes.map((n) => n.id.replace(/\.md$/, ""));

  return {
    headline: `Confirmed ${dim === 1 ? "relation" : dim === 2 ? "triangle" : dim === 3 ? "tetrahedron" : "simplex"} you defined.`,
    tension: `You explicitly marked ${nodeNamesList.join(" · ")} as forming a meaningful structure.`,
    prompt: simplex.label
      ? `Labeled as "${simplex.label}". Does this label still capture the relationship?`
      : `Consider adding a label to capture what binds these notes together.`,
    signals: simplex.label ? [`Label: ${simplex.label}`] : ["User-defined"],
  };
}

function detectBridgeNode(nodes: NoteProfile[], contexts: Map<string, InferenceContext>): NodeID | null {
  if (nodes.length !== 3) return null;

  for (const node of nodes) {
    const ctx = contexts.get(node.id);
    if (!ctx) continue;

    const otherNodes = nodes.filter((n) => n.id !== node.id);
    const connectsToBoth = otherNodes.every(
      (other) => ctx.outgoingLinks.has(other.id) || contexts.get(other.id)?.outgoingLinks.has(node.id),
    );

    if (connectsToBoth) {
      // Check if the other two don't directly connect
      const [a, b] = otherNodes;
      const aCtx = contexts.get(a.id);
      const bCtx = contexts.get(b.id);
      const aLinksB = aCtx?.outgoingLinks.has(b.id) ?? false;
      const bLinksA = bCtx?.outgoingLinks.has(a.id) ?? false;

      if (!aLinksB && !bLinksA) {
        return node.id;
      }
    }
  }

  return null;
}

/**
 * Explain a missing-face completion motif, not a homology class.
 */
export function explainHole(hole: MissingFaceBoundary, _contexts: Map<string, InferenceContext>): SimplexExplanation {
  const nodeNames = hole.boundaryNodes.map((id) => id.replace(/\.md$/, ""));

  if (hole.dimension === 1) {
    return {
      headline: "A triangular missing face — a local completion opportunity.",
      tension: `Notes ${nodeNames.join(" · ")} connect pairwise, but no synthesizing structure exists at the center.`,
      prompt: `What could synthesize all three notes?`,
      signals: ["Three boundary edges, no triangle"],
    };
  }

  return {
    headline: "A tetrahedral boundary missing its 3-simplex.",
    tension: `Four notes form a complete boundary of triangles, but the interior is empty.`,
    prompt: `What synthesis would complete this local structure?`,
    signals: ["Four triangular faces, no tetrahedron"],
  };
}
