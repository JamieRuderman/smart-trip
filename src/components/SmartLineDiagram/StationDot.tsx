import type { Station } from "@/types/smartSchedule";
import { stationTrackColor } from "@/lib/stationUtils";
import { BRAND_LINE_COLOR } from "@/data/smartLineLayout";
import { TOKEN } from "./tokens";

interface StationDotProps {
  station: Station;
  x: number;
  y: number;
  isTerminal: boolean;
  colorTrackByZone: boolean;
  /** When true, render in the muted track color instead of the zone color
   *  — used for stations outside the selected from→to range. */
  muted?: boolean;
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
  muted = false,
  onClick,
}: StationDotProps) {
  const r = isTerminal ? TOKEN.terminalR : TOKEN.stationR;
  const stroke = muted
    ? TOKEN.mutedTrack
    : colorTrackByZone
      ? stationTrackColor(station)
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
