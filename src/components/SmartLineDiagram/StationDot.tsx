import type { Station } from "@/types/smartSchedule";
import { stationZoneMap } from "@/lib/stationUtils";
import { BRAND_LINE_COLOR, ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import { TOKEN } from "./tokens";

interface StationDotProps {
  station: Station;
  x: number;
  y: number;
  isTerminal: boolean;
  colorTrackByZone: boolean;
  onClick?: (station: Station) => void;
}

/**
 * The dot + invisible hit area for a station. Lives inside the zoomable
 * group so it scales with pan/zoom; the matching `StationLabel` lives in
 * the constant-size label layer.
 */
export function StationDot({
  station,
  x,
  y,
  isTerminal,
  colorTrackByZone,
  onClick,
}: StationDotProps) {
  const r = isTerminal ? TOKEN.terminalR : TOKEN.stationR;
  const stroke = colorTrackByZone
    ? ZONE_TRACK_COLORS[stationZoneMap[station]] ?? BRAND_LINE_COLOR
    : BRAND_LINE_COLOR;

  return (
    <g
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick(station);
            }
          : undefined
      }
    >
      <circle cx={x} cy={y} r={TOKEN.hitAreaR} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={TOKEN.stationFill}
        stroke={stroke}
        strokeWidth={TOKEN.stationStroke}
      />
      {isTerminal && (
        <circle cx={x} cy={y} r={r * TOKEN.terminalCoreRatio} fill={stroke} />
      )}
    </g>
  );
}
