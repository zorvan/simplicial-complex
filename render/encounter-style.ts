/**
 * How an encounter looks, as a pure function of what is known about it.
 *
 * Kept free of canvas and of Obsidian globals so the mapping from diagnostic to
 * appearance can be asserted directly: "high closure deficit reads as more
 * unresolved" is a claim about this function, not about a drawing routine.
 */

/** One full breath. Slow enough to read as breathing rather than blinking. */
export const PULSE_PERIOD_MS = 2600;

export interface EncounterStyleInput {
  /** The user's `hyperedgeOpacity` setting. */
  opacity: number;
  focused: boolean;
  /**
   * Closure deficit in `[0,1]`, or `null` when the encounter is too large to
   * enumerate. Unmeasured is not the same as resolved and not the same as
   * unresolved, so it renders as neither.
   */
  deficit: number | null;
  /** Eligible to crystallize: recurring, and not already crystallized. */
  emergent: boolean;
  /** 0…1 breath position. Callers pass 0 when motion is off — this never decides that. */
  pulse: number;
}

export interface EncounterStyle {
  /** `[dash, gap]`. A wider gap reads as less resolved: the enclosure is more open. */
  dash: [number, number];
  strokeAlpha: number;
  fillAlpha: number;
  lineWidth: number;
  memberRadius: number;
  /** The inset second contour that marks an encounter ready to precipitate a concept. */
  showEmergenceContour: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Position within the current breath, shared by every member of an encounter.
 *
 * Deriving it from wall-clock time alone is what makes the pulse *in phase*: the
 * members are not each animating, they are being animated together. That is the
 * whole assertion — temporary alignment of attention, not permanent connection.
 */
export function pulsePhase(now: number, periodMs = PULSE_PERIOD_MS): number {
  return (1 - Math.cos((now / periodMs) * Math.PI * 2)) / 2;
}

export function encounterStyle(input: EncounterStyleInput): EncounterStyle {
  const base = clamp01(input.opacity) * (input.focused ? 1 : 0.35);
  // An unmeasured deficit sits deliberately at the midpoint: it must not borrow the
  // settled look of a filled-in neighbourhood it was never checked against.
  const resolution = input.deficit === null ? 0.5 : 1 - clamp01(input.deficit);
  const pulse = clamp01(input.pulse);

  return {
    dash: [9, 4 + 11 * (1 - resolution)],
    strokeAlpha: clamp01(base * 1.5 * (0.85 + 0.3 * pulse)),
    // A low-deficit encounter sits on a neighbourhood the complex already fills in,
    // so it is allowed to look more settled. A high-deficit one stays nearly hollow.
    fillAlpha: clamp01(base * (0.05 + 0.14 * resolution)),
    lineWidth: (input.focused ? 2 : 1.4) * (1 + 0.25 * pulse),
    memberRadius: (input.focused ? 3.4 : 2.6) * (1 + 0.35 * pulse),
    showEmergenceContour: input.emergent,
  };
}

/**
 * Node radius while its encounter is focused. Returns the unpulsed radius when
 * `pulse` is 0, so a reduced-motion reader sees the same shape held still.
 */
export function pulsedNodeRadius(baseRadius: number, pulse: number): number {
  return baseRadius * (1 + 0.45 * clamp01(pulse));
}
