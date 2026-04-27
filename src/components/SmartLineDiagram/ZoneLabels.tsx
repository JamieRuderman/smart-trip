import { useTranslation } from "react-i18next";
import { ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import { FONT_FAMILY, TOKEN, ZONE_LABEL_POSITIONS } from "./tokens";

interface ZoneLabelsProps {
  screenScale: number;
  tx: number;
  ty: number;
  scale: number;
}

/**
 * Right-margin zone headings. Renders OUTSIDE the zoomable group so the
 * font stays at a constant CSS pixel target; positions are hand-affined
 * from the static layout coords.
 */
export function ZoneLabels({ screenScale, tx, ty, scale }: ZoneLabelsProps) {
  const { t } = useTranslation();
  const fontSize = TOKEN.zoneLabelSize / screenScale;
  return (
    <g pointerEvents="none">
      {ZONE_LABEL_POSITIONS.map(({ zone, x, y }) => (
        <text
          key={zone}
          x={x * scale + tx}
          y={y * scale + ty}
          fontSize={fontSize}
          fontWeight={TOKEN.zoneLabelWeight}
          fill={ZONE_TRACK_COLORS[zone]}
          style={{ fontFamily: FONT_FAMILY }}
        >
          {t("mapDiagram.zoneLabel", { zone })}
        </text>
      ))}
    </g>
  );
}
