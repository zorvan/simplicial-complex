import type { Obstruction } from "../../core/sheaf";

/**
 * HG-29: an obstruction is a failed seam, not an empty region.
 *
 * Holes are rendered as dashed closed orange outlines by `holes.ts`. These marks are
 * open crimson zig-zag seams drawn through existing notes: every local field exists,
 * but the readings cannot be joined into one global assignment.
 */
export function drawObstructionSeams(
  ctx: CanvasRenderingContext2D,
  obstructions: Obstruction[],
  nodeMap: Map<string, { px: number; py: number }>,
  isDark: boolean,
): void {
  if (obstructions.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  obstructions.forEach((obstruction, obstructionIndex) => {
    const points = obstruction.nodes.map((nodeId) => nodeMap.get(nodeId)).filter((point) => point !== undefined);
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].px, points[0].py);
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1];
      const to = points[index];
      const dx = to.px - from.px;
      const dy = to.py - from.py;
      const length = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / length;
      const ny = dx / length;
      const segments = Math.max(2, Math.min(8, Math.ceil(length / 45)));
      for (let segment = 1; segment <= segments; segment++) {
        const t = segment / segments;
        const offset = segment === segments ? 0 : (segment % 2 === 0 ? -1 : 1) * (5 + obstructionIndex * 1.5);
        ctx.lineTo(from.px + dx * t + nx * offset, from.py + dy * t + ny * offset);
      }
    }
    ctx.strokeStyle = isDark ? "rgba(255, 92, 118, 0.88)" : "rgba(184, 24, 62, 0.82)";
    ctx.lineWidth = Math.min(4, 1.8 + obstruction.magnitude * 0.18);
    ctx.setLineDash([]);
    ctx.stroke();
  });
  ctx.restore();
}
