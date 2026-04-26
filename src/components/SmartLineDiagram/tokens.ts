/**
 * Design tokens for the SmartLineDiagram.
 *
 * Geometry numbers are in viewBox units (the SVG's internal coordinate space,
 * 780×1390). Typography sizes are *target CSS pixels* — the renderer divides
 * each font size by the live screenScale so labels stay legible regardless of
 * how the SVG fits its container.
 *
 * Colors prefer `hsl(var(--token))` so the diagram inverts cleanly in dark
 * mode. Add new tokens to index.css + tailwind.config.ts before referencing
 * them here.
 */

import type { Station } from "@/types/smartSchedule";

export const FONT_FAMILY = "Inter, sans-serif";

export const TOKEN = {
  // Line + station geometry
  lineW: 18,
  stationStroke: 6,
  stationR: 11,
  terminalR: 16,
  hitAreaR: 32,
  terminalCoreRatio: 0.42, // inner-fill circle r = terminalR * this

  // Typography — target CSS px (divided by screenScale at render time).
  labelSize: 14,
  terminalSize: 17,
  zoneLabelSize: 18,
  ferryEtaSize: 11,
  ferryNameSize: 17,
  /** Train number text lives inside the marker group, which scales with zoom,
   *  so this stays in viewBox units (no screenScale division). */
  trainNumberSize: 15,
  labelWeight: 500,
  terminalWeight: 700,
  zoneLabelWeight: 700,
  trainNumberWeight: 900,
  ferryNameWeight: 800,
  ferryEtaWeight: 600,
  labelTracking: "0.01em",
  ferryEtaTracking: "0.06em",
  /** Gap (CSS px) between ferry circle bottom and "San Francisco" name top. */
  ferryNameGapPx: 10,
  /** Gap (CSS px) between name baseline and the next-ferry eta line top. */
  ferryEtaGapPx: 6,
  /** Y-offset from station center to text baseline. */
  labelBaseline: 5,
  /** Horizontal gap between the station dot and its label. */
  labelGap: 28,

  // Train marker
  trainPulseR: 30,
  trainPulseRMin: 24,
  trainPulseRMax: 34,
  trainPulseOpacity: 0.18,
  trainInnerR: 18,
  trainStroke: 6,
  /** Triangle pointing up; rotated to match the train's bearing. */
  trainArrow: "M 0 -33 L 8.5 -18 L -8.5 -18 Z",
  trainTextBaseline: 5.5,
  trainSelectedR: 40,
  trainSelectedStroke: 2.5,
  trainSelectedDash: "4 4",

  // User-location marker
  userPulseR: 30,
  userPulseRMin: 22,
  userPulseRMax: 36,
  userPulseOpacity: 0.3,
  userInnerR: 11,
  userInnerStroke: 4,

  // Theme-backed colors
  stationFill: "hsl(var(--background))",
  detailStroke: "hsl(var(--muted-foreground))",
  mutedTrack: "hsl(var(--border))",
  userLocation: "hsl(var(--user-location))",
} as const;

/** Pulse-animation timing shared by the user-location and train markers. */
export const ANIM = {
  pulseDur: "2s",
  userPulseR: `${TOKEN.userPulseRMin};${TOKEN.userPulseRMax};${TOKEN.userPulseRMin}`,
  userPulseOpacity: "0.4;0.08;0.4",
  trainPulseR: `${TOKEN.trainPulseRMin};${TOKEN.trainPulseRMax};${TOKEN.trainPulseRMin}`,
  trainPulseOpacity: "0.28;0.05;0.28",
} as const;

/** Train accent colors keyed off the same theme tokens used elsewhere. */
export const TRAIN_COLORS = {
  onTime: "hsl(var(--foreground))",
  delayed: "hsl(var(--smart-gold))",
  canceled: "hsl(var(--muted-foreground))",
} as const;

/** Re-render cadence for schedule-driven train motion. 1s keeps station-to-
 *  station segments (several minutes) visually smooth. */
export const MOTION_TICK_MS = 1000;

/** Labels too long for one line are split into two stacked tspans. */
export const MULTILINE_LABELS: Partial<Record<Station, [string, string]>> = {
  "Sonoma County Airport": ["Sonoma County", "Airport"],
};

/** Right-margin zone headings, colored per zone. Positioned at each zone's
 *  vertical midpoint; x values track the line's curve so each label reads as
 *  attached to its segment without crowding the station dots. */
export const ZONE_LABEL_POSITIONS: { zone: number; x: number; y: number }[] = [
  { zone: 1, x: 260, y: 120 },
  { zone: 2, x: 345, y: 280 },
  { zone: 3, x: 395, y: 560 },
  { zone: 4, x: 515, y: 950 },
  { zone: 5, x: 545, y: 1200 },
];
