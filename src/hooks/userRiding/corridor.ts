import { snapToRail, type RailSnap } from "@/lib/railProjection";

/**
 * Perpendicular distance (km) from a point to the SMART rail polyline.
 * Pass `snap` when one is already available (e.g. cached for the tick)
 * to skip the projection.
 */
export function distanceToCorridorKm(
  lat: number,
  lng: number,
  snap?: RailSnap | null,
): number {
  const s = snap ?? snapToRail(lat, lng);
  return s?.residualKm ?? Infinity;
}

/**
 * Classify a heading (0-360°) as the SMART direction the user is travelling.
 * Returns 1 (north) or 0 (south) to match GTFS-RT directionId, or null for
 * east/west headings (curves, GPS jitter). Wider window (±60°) than a strict
 * cardinal split so curves don't toggle the classification.
 */
export function classifyHeading(heading: number): 0 | 1 | null {
  const h = ((heading % 360) + 360) % 360;
  if (h <= 60 || h >= 300) return 1;
  if (h >= 120 && h <= 240) return 0;
  return null;
}
