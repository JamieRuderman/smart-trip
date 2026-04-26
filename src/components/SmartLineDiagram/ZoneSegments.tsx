import { memo } from "react";
import stations from "@/data/stations";
import { stationZoneMap } from "@/lib/stationUtils";
import { BRAND_LINE_COLOR, ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import { TOKEN } from "./tokens";

interface ZoneSegmentsProps {
  pathD: string;
  totalLength: number;
  stationArcs: number[];
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
}: ZoneSegmentsProps) {
  const L = totalLength;
  // arc-from-north → path-param (path drawn S→N; path s = L − arc-from-N).
  const ps = stationArcs.map((a) => L - a);

  const segs: React.ReactElement[] = [];
  for (let i = 0; i < stations.length; i++) {
    const here = ps[i];
    const nMid = i === 0 ? L : (ps[i - 1] + here) / 2;
    const sMid = i === stations.length - 1 ? 0 : (here + ps[i + 1]) / 2;
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
