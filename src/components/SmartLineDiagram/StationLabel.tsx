import type { Station } from "@/types/smartSchedule";
import { FONT_FAMILY, MULTILINE_LABELS, TOKEN } from "./tokens";

interface StationLabelProps {
  station: Station;
  /** Dot center, in viewBox units (pre-zoom). */
  x: number;
  y: number;
  isTerminal: boolean;
  /** screenScale = svgWidth / viewBoxWidth. */
  screenScale: number;
  /** Pan-zoom transform applied to the matching dot. The label sits in the
   *  outer (non-zoomed) group, so we apply the affine ourselves. */
  tx: number;
  ty: number;
  scale: number;
  /** Optional click handler — when provided, the label becomes tappable
   *  (same affordance as the dot itself). Pan/zoom drags are still
   *  suppressed via the document-capture handler in `usePanZoom`. */
  onClick?: (station: Station) => void;
}

/**
 * Station name label. Renders OUTSIDE the zoomable group so the font size
 * stays at a constant CSS pixel target. Position is hand-affined from the
 * dot's pre-zoom (x, y) so the label tracks the dot through pan/zoom.
 */
export function StationLabel({
  station,
  x,
  y,
  isTerminal,
  screenScale,
  tx,
  ty,
  scale,
  onClick,
}: StationLabelProps) {
  const baseSize = isTerminal ? TOKEN.terminalSize : TOKEN.labelSize;
  const fontSize = baseSize / screenScale;
  const fontWeight = isTerminal ? TOKEN.terminalWeight : TOKEN.labelWeight;
  const wrapped = MULTILINE_LABELS[station];
  const r = isTerminal ? TOKEN.terminalR : TOKEN.stationR;

  // Apply the affine the matching dot would receive, then back off to the
  // left of the (now potentially-zoomed) dot. Multiplying the gap by `scale`
  // keeps the label's distance proportional to the rendered dot.
  const labelX = x * scale + tx - (r + TOKEN.labelGap) * scale;
  const labelY = y * scale + ty;

  return (
    <text
      x={labelX}
      y={labelY}
      textAnchor="end"
      dominantBaseline="central"
      pointerEvents={onClick ? "auto" : "none"}
      fontSize={fontSize}
      fontWeight={fontWeight}
      className="fill-foreground"
      style={{ fontFamily: FONT_FAMILY, cursor: onClick ? "pointer" : "default" }}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick(station);
            }
          : undefined
      }
    >
      {wrapped ? (
        <>
          <tspan x={labelX} dy={-fontSize * 0.55}>
            {wrapped[0]}
          </tspan>
          <tspan x={labelX} dy={fontSize * 1.1}>
            {wrapped[1]}
          </tspan>
        </>
      ) : (
        station
      )}
    </text>
  );
}
