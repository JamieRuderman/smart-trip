import { useTranslation } from "react-i18next";
import { getNextFerryDeparture } from "@/lib/scheduleUtils";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { FONT_FAMILY, TOKEN } from "./tokens";

interface FerryTerminusProps {
  x: number;
  y: number;
  now: Date;
  screenScale: number;
}

export function FerryTerminus({ x, y, now, screenScale }: FerryTerminusProps) {
  const { t } = useTranslation();
  const ferry = getNextFerryDeparture(now);
  const nowMinutes = minutesOfDay(now);
  const minsUntil = ferry
    ? Math.max(0, parseTimeToMinutes(ferry.depart) - nowMinutes)
    : null;
  // Falls back to a "no more ferries today" badge once the last boat is out
  // so the label never goes blank.
  const etaLabel =
    minsUntil != null
      ? t("mapDiagram.nextFerryBadge", { minutes: minsUntil })
      : t("mapDiagram.noMoreFerries");

  const nameSize = TOKEN.ferryNameSize / screenScale;
  const etaSize = TOKEN.ferryEtaSize / screenScale;
  // Glyph + label vertical offsets scale with screenScale so the gap between
  // the ferry circle and "San Francisco" stays consistent in CSS px regardless
  // of how the SVG fits its container.
  const ferryR = TOKEN.terminalR + 2;
  const nameY =
    ferryR + (TOKEN.ferryNameGapPx + TOKEN.ferryNameSize) / screenScale;
  const etaY =
    nameY + (TOKEN.ferryEtaGapPx + TOKEN.ferryEtaSize) / screenScale;

  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        r={ferryR}
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
      <text
        y={nameY}
        textAnchor="middle"
        fontSize={nameSize}
        fontWeight={TOKEN.ferryNameWeight}
        className="fill-foreground"
        style={{ fontFamily: FONT_FAMILY }}
      >
        {t("mapDiagram.sanFrancisco")}
      </text>
      <text
        y={etaY}
        textAnchor="middle"
        fontSize={etaSize}
        fontWeight={TOKEN.ferryEtaWeight}
        className="fill-muted-foreground"
        letterSpacing={TOKEN.ferryEtaTracking}
        style={{ fontFamily: FONT_FAMILY }}
      >
        {etaLabel}
      </text>
    </g>
  );
}
