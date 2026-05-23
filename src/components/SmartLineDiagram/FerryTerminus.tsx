import { TOKEN } from "./tokens";

interface FerryTerminusProps {
  x: number;
  y: number;
  /** When true (Larkspur is outside the selected range), render in the same
   *  muted track color as Larkspur's dot. */
  muted?: boolean;
}

/**
 * The ferry terminus glyph (circle + wave glyph). Lives inside the zoomable
 * group so it scales with pan/zoom; the matching `FerryLabels` (San
 * Francisco / next-ferry ETA) lives in the constant-size label layer.
 */
export function FerryTerminus({ x, y, muted = false }: FerryTerminusProps) {
  const stroke = muted ? TOKEN.mutedTrack : TOKEN.detailStroke;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        r={TOKEN.terminalR + 2}
        fill={TOKEN.stationFill}
        stroke={stroke}
        strokeWidth={TOKEN.stationStroke}
      />
      {/* Wave glyph spans y∈[-4, 8] in local coords; shift up by 2 so it
          centers visually on the circle origin. */}
      <g transform="translate(0, -2)">
        <path
          d="M -7 0 Q -3.5 -4 0 0 T 7 0"
          stroke={stroke}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M -7 4 Q -3.5 0 0 4 T 7 4"
          stroke={stroke}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}
