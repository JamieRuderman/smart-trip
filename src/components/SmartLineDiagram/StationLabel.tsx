import type { Station } from "@/types/smartSchedule";
import { FONT_FAMILY, MULTILINE_LABELS, TOKEN } from "./tokens";

interface StationLabelProps {
  station: Station;
  x: number;
  y: number;
  isTerminal: boolean;
  /** screenScale = svgWidth / viewBoxWidth. Font size is divided by this so
   *  the label renders at a constant CSS pixel size. */
  screenScale: number;
}

export function StationLabel({
  station,
  x,
  y,
  isTerminal,
  screenScale,
}: StationLabelProps) {
  const baseSize = isTerminal ? TOKEN.terminalSize : TOKEN.labelSize;
  const fontSize = baseSize / screenScale;
  const fontWeight = isTerminal ? TOKEN.terminalWeight : TOKEN.labelWeight;
  const wrapped = MULTILINE_LABELS[station];

  return (
    <text
      x={x}
      y={y}
      textAnchor="end"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={fontWeight}
      className="fill-foreground"
      style={{ fontFamily: FONT_FAMILY }}
    >
      {wrapped ? (
        <>
          <tspan x={x} dy={-fontSize * 0.55}>
            {wrapped[0]}
          </tspan>
          <tspan x={x} dy={fontSize * 1.1}>
            {wrapped[1]}
          </tspan>
        </>
      ) : (
        station
      )}
    </text>
  );
}
