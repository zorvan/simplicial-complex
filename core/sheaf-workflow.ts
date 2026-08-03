import type { NodeID } from "./types.js";
import type { SheafRole } from "./sheaf.js";

export interface RoleChange {
  contextId: string;
  nodeId: NodeID;
  role: SheafRole;
}

/** UI-independent state machine used by Contextuality Lab's multi-change scratch workflow. */
export class SheafScratch {
  private changes = new Map<string, RoleChange>();

  set(change: RoleChange): void {
    this.changes.set(`${change.contextId}\u0000${change.nodeId}`, change);
  }

  list(): RoleChange[] {
    return [...this.changes.values()];
  }

  discard(): void {
    this.changes.clear();
  }

  accept(sections: Record<string, Record<NodeID, SheafRole>>): RoleChange[] {
    const accepted = this.list();
    accepted.forEach(({ contextId, nodeId, role }) => {
      sections[contextId] ??= {};
      sections[contextId][nodeId] = role;
    });
    this.discard();
    return accepted;
  }
}
