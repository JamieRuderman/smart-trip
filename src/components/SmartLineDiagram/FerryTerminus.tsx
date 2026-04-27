import { TOKEN } from "./tokens";

interface FerryTerminusProps {
  x: number;
  y: number;
}

/**
 * The ferry terminus glyph (circle + wave glyph). Lives inside the zoomable
 * group so it scales with pan/zoom; the matching `FerryLabels` (San
 * Francisco / next-ferry ETA) lives in the constant-size label layer.
 */
export function FerryTerminus({ x, y }: FerryTerminusProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        r={TOKEN.terminalR + 2}
        fill={TOKEN.stationFill}
        stroke={TOKEN.detailStroke}
        strokeWidth={TOKEN.stationStroke}
      />
      <path
        d="M -7 0 Q -3.5 -4 0 0 T 7 0"
        stroke={TOKEN.detailStroke}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M -7 4 Q -3.5 0 0 4 T 7 4"
        stroke={TOKEN.detailStroke}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}
