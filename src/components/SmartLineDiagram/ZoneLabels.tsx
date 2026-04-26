import { useTranslation } from "react-i18next";
import { ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import { FONT_FAMILY, TOKEN, ZONE_LABEL_POSITIONS } from "./tokens";

export function ZoneLabels({ screenScale }: { screenScale: number }) {
  const { t } = useTranslation();
  const fontSize = TOKEN.zoneLabelSize / screenScale;
  return (
    <g>
      {ZONE_LABEL_POSITIONS.map(({ zone, x, y }) => (
        <text
          key={zone}
          x={x}
          y={y}
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
