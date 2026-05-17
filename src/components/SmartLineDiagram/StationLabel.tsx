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
  /** Which side of the dot the label sits on. Defaults to "right"; Larkspur
   *  stays on "left" so its label doesn't collide with the ferry path. */
  labelSide?: "left" | "right";
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
  labelSide = "right",
}: StationLabelProps) {
  const baseSize = isTerminal ? TOKEN.terminalSize : TOKEN.labelSize;
  const fontSize = baseSize / screenScale;
  const fontWeight = isTerminal ? TOKEN.terminalWeight : TOKEN.labelWeight;
  const wrapped = MULTILINE_LABELS[station];
  const r = isTerminal ? TOKEN.terminalR : TOKEN.stationR;

  // Apply the affine the matching dot would receive, then back off to whichever
  // side of the (now potentially-zoomed) dot the label sits on. Multiplying the
  // gap by `scale` keeps the label's distance proportional to the rendered dot.
  const offset = (r + TOKEN.labelGap) * scale;
  const labelX = x * scale + tx + (labelSide === "left" ? -offset : offset);
  const labelY = y * scale + ty;

  return (
    <text
      x={labelX}
      y={labelY}
      textAnchor={labelSide === "left" ? "end" : "start"}
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
