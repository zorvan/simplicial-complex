/**
 * The shared explanation record.
 *
 * Ranked persistent gaps (plan §6.8) and the dense-vault discovery cards are the same
 * object: a claim, its evidence, its provenance, its uncertainty, and one suggested
 * action. §13.3 says whichever plan reaches the contract first owns the definition and
 * the other conforms without forking it. This release reaches it first, so this file is
 * the definition — the discovery inbox must import it rather than declare its own.
 */
export type DiscoveryKind =
  | "persistent-gap"
  | "missing-face"
  | "context-disagreement"
  | "encounter-recurrence"
  | "structural-bridge";

export type DiscoveryAction = "inspect" | "compare" | "refine" | "write" | "dismiss";

export interface DiscoveryExplanation {
  /** What is being claimed, in language that does not overstate the mathematics. */
  claim: string;
  kind: DiscoveryKind;
  /** Vault paths a reader can open to check the claim. */
  evidencePaths: string[];
  contextIds: string[];
  /** Relations the user actually asserted. */
  authoredInputs: string[];
  /** Relations the plugin inferred. Kept separate so a claim resting on guesses looks like one. */
  inferredInputs: string[];
  /**
   * The score, decomposed. Never collapse these into a single "significance" number:
   * the point is that a reader can see which term carried the ranking.
   */
  scoreComponents: Record<string, number>;
  /** Plain-language limits on the claim. Empty means none were recorded, not that none exist. */
  uncertainty: string[];
  /** Points into the result that produced this, e.g. a persistence interval id. */
  witnessRef?: string;
  suggestedAction: DiscoveryAction;
}

/** Sum of the decomposed components. Presentation only; the components remain the record. */
export function discoveryScore(explanation: DiscoveryExplanation): number {
  return Object.values(explanation.scoreComponents).reduce((total, value) => total + value, 0);
}
