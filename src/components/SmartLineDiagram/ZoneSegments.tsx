import { memo } from "react";
import stations from "@/data/stations";
import { stationIndexMap, stationZoneMap } from "@/lib/stationUtils";
import { BRAND_LINE_COLOR, ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import type { Station } from "@/types/smartSchedule";
import { TOKEN } from "./tokens";

interface ZoneSegmentsProps {
  pathD: string;
  totalLength: number;
  stationArcs: number[];
  /** When both are set, only segments between (inclusive) these stations are
   *  colored; segments outside that range are left to the muted base path. */
  fromStation?: Station | null;
  toStation?: Station | null;
}

/**
 * Renders the route path once per zone, using `stroke-dasharray` to mask
 * everything except that zone's segment. Memoized — input only changes when
 * the diagram remounts or stations are remeasured.
 */
export const ZoneSegments = memo(function ZoneSegments({
  pathD,
  totalLength,
  stationArcs,
  fromStation = null,
  toStation = null,
}: ZoneSegmentsProps) {
  const L = totalLength;
  // arc-from-north → path-param (path drawn S→N; path s = L − arc-from-N).
  const ps = stationArcs.map((a) => L - a);

  const hasRange = !!fromStation && !!toStation;
  const fromIdx = fromStation ? stationIndexMap[fromStation] : -1;
  const toIdx = toStation ? stationIndexMap[toStation] : -1;
  const minIdx = hasRange ? Math.min(fromIdx, toIdx) : -1;
  const maxIdx = hasRange ? Math.max(fromIdx, toIdx) : -1;

  const segs: React.ReactElement[] = [];
  for (let i = 0; i < stations.length; i++) {
    if (hasRange && (i < minIdx || i > maxIdx)) continue;
    const here = ps[i];
    let nMid = i === 0 ? L : (ps[i - 1] + here) / 2;
    let sMid = i === stations.length - 1 ? 0 : (here + ps[i + 1]) / 2;
    // At the selection's endpoints, clip the colored band to the station dot
    // itself — otherwise the color would extend halfway toward the next
    // (unselected) station. Mid-segment zone breaks elsewhere are unaffected.
    if (hasRange && i === minIdx) nMid = here;
    if (hasRange && i === maxIdx) sMid = here;
    const len = nMid - sMid;
    if (len <= 0) continue;
    const color =
      ZONE_TRACK_COLORS[stationZoneMap[stations[i]]] ?? BRAND_LINE_COLOR;
    segs.push(
      <path
        key={stations[i]}
        d={pathD}
        stroke={color}
        strokeWidth={TOKEN.lineW}
        strokeLinecap="butt"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`0 ${sMid} ${len} ${L}`}
      />,
    );
  }
  return <g>{segs}</g>;
});
