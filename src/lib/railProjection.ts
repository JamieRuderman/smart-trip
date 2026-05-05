/**
 * Project a GPS lat/lng onto the SMART rail polyline.
 *
 * The rail isn't straight — between Petaluma Downtown and Novato San Marin
 * it bows ~1 km west of the chord. Earlier code projected onto a chord
 * between the train's adjacent stations, which both required a correct
 * `nextStation` from the feed *and* could miss the actual track by far
 * enough to fail the residual check. Snapping to the polyline directly
 * avoids both problems and gives a fractional station index that matches
 * what the geographic map shows.
 */
import stations, { STATION_COORDINATES } from "@/data/stations";
import { SMART_RAIL_COORDINATES } from "@/data/generated/railGeometry.generated";

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_KM) / 180;
// Equirectangular projection scaled by cos(meanLat). Error <15 m at SMART
// corridor scale, plenty good for a "which segment is closest" snap.
const LAT_REF_RAD = 38.25 * (Math.PI / 180); // corridor mid-latitude
const KM_PER_DEG_LNG = Math.cos(LAT_REF_RAD) * KM_PER_DEG_LAT;

const [LNG0, LAT0] = SMART_RAIL_COORDINATES[0];

/** Rail polyline points in km space, relative to the south terminus. */
const RAIL_KM: { x: number; y: number }[] = SMART_RAIL_COORDINATES.map(
  ([lng, lat]) => ({
    x: (lng - LNG0) * KM_PER_DEG_LNG,
    y: (lat - LAT0) * KM_PER_DEG_LAT,
  }),
);

/** Cumulative arc length (km) from RAIL_KM[0] (Larkspur, south end). */
const RAIL_CUM_KM: number[] = (() => {
  const out: number[] = [0];
  for (let i = 1; i < RAIL_KM.length; i++) {
    const dx = RAIL_KM[i].x - RAIL_KM[i - 1].x;
    const dy = RAIL_KM[i].y - RAIL_KM[i - 1].y;
    out.push(out[i - 1] + Math.hypot(dx, dy));
  }
  return out;
})();

export interface RailSnap {
  /** Arc length from the south terminus (Larkspur) in km. */
  arcKm: number;
  /** Perpendicular distance from the input point to the polyline, km. */
  residualKm: number;
}

/** Snap (lat, lng) to the closest point on the rail polyline. */
export function snapToRail(lat: number, lng: number): RailSnap | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const px = (lng - LNG0) * KM_PER_DEG_LNG;
  const py = (lat - LAT0) * KM_PER_DEG_LAT;

  let bestArc = 0;
  let bestResidual2 = Infinity;
  for (let i = 0; i < RAIL_KM.length - 1; i++) {
    const a = RAIL_KM[i];
    const b = RAIL_KM[i + 1];
    const ax = b.x - a.x;
    const ay = b.y - a.y;
    const segLen2 = ax * ax + ay * ay;
    if (segLen2 <= 0) continue;
    const bx = px - a.x;
    const by = py - a.y;
    const tRaw = (ax * bx + ay * by) / segLen2;
    const t = Math.max(0, Math.min(1, tRaw));
    const ex = px - (a.x + ax * t);
    const ey = py - (a.y + ay * t);
    const r2 = ex * ex + ey * ey;
    if (r2 < bestResidual2) {
      bestResidual2 = r2;
      bestArc = RAIL_CUM_KM[i] + Math.sqrt(segLen2) * t;
    }
  }
  if (!Number.isFinite(bestArc)) return null;
  return { arcKm: bestArc, residualKm: Math.sqrt(bestResidual2) };
}

/**
 * Each station's arc-from-Larkspur in km, in the canonical N→S station
 * order. Values DECREASE as the index increases (Windsor highest, Larkspur
 * ≈0). Computed once at module load by snapping each station to the rail.
 */
export const STATION_RAIL_ARC_KM: readonly number[] = stations.map((station) => {
  const c = STATION_COORDINATES[station];
  const snap = snapToRail(c.lat, c.lng);
  return snap?.arcKm ?? 0;
});

/**
 * Map a rail arc-from-south distance to a fractional station index in the
 * N→S station list. Returns 0 for points north of Windsor and N-1 for
 * points south of Larkspur (clamped to the corridor).
 */
export function railArcToStationIndex(arcKm: number): number {
  // STATION_RAIL_ARC_KM is monotonically decreasing across N→S indices.
  // station[i] (north) has higher arc, station[i+1] (south) has lower.
  if (arcKm >= STATION_RAIL_ARC_KM[0]) return 0;
  const lastIdx = STATION_RAIL_ARC_KM.length - 1;
  if (arcKm <= STATION_RAIL_ARC_KM[lastIdx]) return lastIdx;
  for (let i = 0; i < lastIdx; i++) {
    const aHigh = STATION_RAIL_ARC_KM[i];
    const aLow = STATION_RAIL_ARC_KM[i + 1];
    if (arcKm <= aHigh && arcKm >= aLow) {
      const span = aHigh - aLow;
      if (span <= 0) return i;
      return i + (aHigh - arcKm) / span;
    }
  }
  return 0;
}
