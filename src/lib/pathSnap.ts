/**
 * Path-snapping helpers for SmartLineDiagram.
 * Requires a mounted <path> element (uses getTotalLength / getPointAtLength).
 */

export interface SnappedPoint {
  x: number;
  y: number;
  /** Arc-length offset from path start. */
  s: number;
}

/** Find the point on `pathEl` closest to (tx, ty). */
export function snapToPath(
  pathEl: SVGPathElement,
  tx: number,
  ty: number,
  samples = 400,
): SnappedPoint {
  const L = pathEl.getTotalLength();
  let bestX = tx, bestY = ty, bestS = 0, bestD = Infinity;

  for (let i = 0; i <= samples; i++) {
    const s = (L * i) / samples;
    const p = pathEl.getPointAtLength(s);
    const d = (p.x - tx) ** 2 + (p.y - ty) ** 2;
    if (d < bestD) { bestD = d; bestX = p.x; bestY = p.y; bestS = s; }
  }

  let step = L / samples;
  for (let pass = 0; pass < 6; pass++) {
    step /= 2;
    for (const ds of [-step, step]) {
      const s = Math.max(0, Math.min(L, bestS + ds));
      const p = pathEl.getPointAtLength(s);
      const d = (p.x - tx) ** 2 + (p.y - ty) ** 2;
      if (d < bestD) { bestD = d; bestX = p.x; bestY = p.y; bestS = s; }
    }
  }

  return { x: bestX, y: bestY, s: bestS };
}

export interface PathPosition {
  x: number;
  y: number;
  /** Degrees; 0 = pointing up in screen space. */
  bearing: number;
}

/**
 * Convert a fractional station index (e.g. 3.4 = 40% of the way from
 * station 3 → 4) to (x, y, bearing) on the path.
 *
 * @param stationArcs  Arc-length offset from the NORTH end of the path for
 *                     each station, N → S. (Prototype path is drawn S → N;
 *                     SmartLineDiagram converts once when building this.)
 * @param direction    "S" (southbound) or "N" (northbound). Bearing is
 *                     flipped for northbound so the arrow points forward.
 */
export function positionOnPath(
  progress: number,
  pathEl: SVGPathElement,
  stationArcs: number[],
  direction: "S" | "N" = "S",
): PathPosition {
  if (stationArcs.length < 2) return { x: 0, y: 0, bearing: 0 };

  const L = pathEl.getTotalLength();
  const last = stationArcs.length - 1;
  const p = Math.max(0, Math.min(last, progress));
  const i = Math.floor(p);
  const t = p - i;

  const arcFromNorth =
    stationArcs[i] + (stationArcs[Math.min(last, i + 1)] - stationArcs[i]) * t;
  const pathS = Math.max(0, Math.min(L, L - arcFromNorth));
  const pt = pathEl.getPointAtLength(pathS);

  const delta = direction === "S" ? -2 : 2;
  const pt2 = pathEl.getPointAtLength(Math.max(0, Math.min(L, pathS + delta)));

  const bearing =
    (Math.atan2(pt2.x - pt.x, -(pt2.y - pt.y)) * 180) / Math.PI;

  return { x: pt.x, y: pt.y, bearing };
}
