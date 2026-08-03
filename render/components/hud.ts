import { simpliciality } from "../../core/diagnostics";
import type { SimplicialModel } from "../../core/model";

export interface BettiNumbers {
  beta0: number;
  beta1: number;
  beta2: number;
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  isDark: boolean,
  accent: string | null = null,
): number {
  const padding = 10;
  const width = ctx.measureText(text).width + padding * 2;
  const height = 26;

  ctx.fillStyle = isDark ? "rgba(20, 24, 32, 0.85)" : "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();

  ctx.strokeStyle = accent ?? (isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.1)");
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = isDark ? "rgba(235, 240, 248, 0.9)" : "rgba(24, 28, 34, 0.85)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padding, y + height / 2);
  return height;
}

export function drawBettiHUD(ctx: CanvasRenderingContext2D, model: SimplicialModel, isDark: boolean): void {
  const analysis = model.getAnalysisSummary();
  if (!analysis.betti) return;

  const { b0, b1, b2 } = analysis.betti;
  const text = `β₀ ${b0}   β₁ ${b1}${b2 !== undefined ? `   β₂ ${b2}` : ""}`;

  ctx.save();
  ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  const height = drawChip(ctx, text, 14, 14, isDark);
  ctx.restore();
  void height;
}

/**
 * HG-15, vault level. Separate from the Betti chip on purpose: β numbers describe
 * the simplicial complex, and simpliciality describes how far the encounters stand
 * from it. Showing them as one figure would suggest they measure the same object.
 */
export function drawEncounterHUD(
  ctx: CanvasRenderingContext2D,
  model: SimplicialModel,
  isDark: boolean,
  /** Vertical offset, so this stacks under the Betti chip only when that one is drawn. */
  y = 14,
): void {
  const encounterCount = model.hyperedges.size;
  if (encounterCount === 0) return;

  const measure = simpliciality(model);
  const value = measure.value === null ? "–" : measure.value.toFixed(2);
  const recurring = model.getAnalysisSummary().recurringEncounterCount;
  const text = `◇ ${encounterCount}${recurring > 0 ? ` · ${recurring} recurring` : ""}   simpliciality ${value}`;

  ctx.save();
  ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  drawChip(ctx, text, 14, y, isDark, "rgba(127, 119, 221, 0.35)");
  ctx.restore();
}
