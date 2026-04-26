import type { Station } from "@/types/smartSchedule";
import { stationZoneMap } from "@/lib/stationUtils";
import { BRAND_LINE_COLOR, ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import { TOKEN } from "./tokens";
import { StationLabel } from "./StationLabel";

interface StationMarkerProps {
  station: Station;
  x: number;
  y: number;
  isTerminal: boolean;
  colorTrackByZone: boolean;
  screenScale: number;
  onClick?: (station: Station) => void;
}

export function StationMarker({
  station,
  x,
  y,
  isTerminal,
  colorTrackByZone,
  screenScale,
  onClick,
}: StationMarkerProps) {
  const r = isTerminal ? TOKEN.terminalR : TOKEN.stationR;
  // Labels pin to the left of their dot; the right margin is reserved for
  // zone headings when `colorTrackByZone` is on.
  const labelX = x - (r + TOKEN.labelGap);
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
      <StationLabel
        station={station}
        x={labelX}
        y={y}
        isTerminal={isTerminal}
        screenScale={screenScale}
      />
    </g>
  );
}
