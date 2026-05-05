import stations, { STATION_COORDINATES } from "@/data/stations";
import { KM_PER_DEG_LAT } from "@/lib/trainGpsProgress";

/**
 * Perpendicular distance (km) from a point to the SMART corridor,
 * approximated as the polyline through the station list. Cheap enough to
 * call once per tick.
 */
export function distanceToCorridorKm(lat: number, lng: number): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const kxKm = cosLat * KM_PER_DEG_LAT;
  const kyKm = KM_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = STATION_COORDINATES[stations[i]];
    const b = STATION_COORDINATES[stations[i + 1]];
    const ax = (a.lng - lng) * kxKm;
    const ay = (a.lat - lat) * kyKm;
    const bx = (b.lng - lng) * kxKm;
    const by = (b.lat - lat) * kyKm;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    }
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < best) best = d;
  }
  return best;
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
