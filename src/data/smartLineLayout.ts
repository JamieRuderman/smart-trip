/**
 * Diagram-space layout for the SMART corridor. Positions are abstract SVG
 * coordinates (not lat/lng) in a ~900×1460 drawing space; the rendering
 * component crops into this. Stations are listed N → S to match stations.ts.
 */

import type { Station } from "@/types/smartSchedule";

export interface DiagramStation {
  station: Station;
  x: number;
  y: number;
}

export const DIAGRAM_STATIONS: DiagramStation[] = [
  { station: "Windsor",               x: 178, y:   80 },
  { station: "Sonoma County Airport", x: 227, y:  160 },
  { station: "Santa Rosa North",      x: 283, y:  250 },
  { station: "Santa Rosa Downtown",   x: 300, y:  293 },
  { station: "Rohnert Park",          x: 300, y:  449 },
  { station: "Cotati",                x: 302, y:  491 },
  { station: "Petaluma North",        x: 360, y:  611 },
  { station: "Petaluma Downtown",     x: 360, y:  676 },
  { station: "Novato San Marin",      x: 470, y:  880 },
  { station: "Novato Downtown",       x: 470, y:  920 },
  { station: "Novato Hamilton",       x: 470, y: 1020 },
  { station: "Marin Civic Center",    x: 470, y: 1120 },
  { station: "San Rafael",            x: 501, y: 1193 },
  { station: "Larkspur",              x: 560, y: 1260 },
];

/**
 * Main route path, drawn Larkspur → Windsor (south → north). Station points
 * are snapped to this path at render time, so redrawing in Figma and pasting
 * the new `d` here reshapes the line without touching component code.
 */
export const ROUTE_PATH_D =
  "M560 1260L496.76 1189.73C478.92 1169.91 470 1146.67 470 1120V1080V990V930V895" +
  "C470 871.667 463.663 850.207 450.99 830.62L379.01 719.38" +
  "C366.337 699.793 359.446 678.333 359.446 655" +
  "C359.446 645.265 359.446 636.188 359.446 619.292" +
  "C359.446 602.396 349.008 581.685 341.99 569.99L318.01 532.01" +
  "C306.003 512.003 300 490.333 300 467V430V358L300 310.836" +
  "C300 287.503 293.663 266.043 280.99 246.456L174.123 78.0837";

export interface FerryWaypoint {
  id: "FERRY_LRK" | "FERRY_BEND" | "FERRY_SF";
  x: number;
  y: number;
}

/** Larkspur → east → south to SF Ferry Building. SF is not a SMART stop.
 *  Kept compact so the "San Francisco" label doesn't clip off the right edge
 *  on narrow viewports (iPhone 12 Pro: ~390 css px). */
export const FERRY_WAYPOINTS: FerryWaypoint[] = [
  { id: "FERRY_LRK",  x: 560, y: 1260 },
  { id: "FERRY_BEND", x: 640, y: 1260 },
  { id: "FERRY_SF",   x: 640, y: 1340 },
];

/** Brand line color — pulls from Tailwind's smart-train-green token so the
 *  SVG line stays in sync with the rest of the app's theme. */
export const BRAND_LINE_COLOR = "hsl(var(--smart-train-green))";

/** Fare-zone track colors, sourced from the Tailwind `zone.*` palette in
 *  tailwind.config.ts. Any tweak to a zone's hue happens in the CSS custom
 *  property, not here. */
export const ZONE_TRACK_COLORS: Record<number, string> = {
  1: "hsl(var(--zone-1))",
  2: "hsl(var(--smart-train-green))",
  3: "hsl(var(--smart-gold))",
  4: "hsl(var(--zone-4))",
  5: "hsl(var(--zone-5))",
};
