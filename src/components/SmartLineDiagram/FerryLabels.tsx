import { useTranslation } from "react-i18next";
import { getNextFerryDeparture } from "@/lib/scheduleUtils";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { FONT_FAMILY, TOKEN } from "./tokens";

interface FerryLabelsProps {
  /** Ferry-glyph center, in viewBox units (pre-zoom). */
  x: number;
  y: number;
  now: Date;
  screenScale: number;
  tx: number;
  ty: number;
  scale: number;
  /** When true (a trip is selected that doesn't ride the ferry), dim "San
   *  Francisco" to match the muted track. */
  muted?: boolean;
  /** Count down to the next ferry leaving San Francisco rather than Larkspur —
   *  for a trip that starts there. */
  inbound?: boolean;
  /** Makes "San Francisco" tappable, like a station label. */
  onClick?: () => void;
}

/**
 * "San Francisco" + next-ferry ETA badge for the ferry terminus. Renders
 * OUTSIDE the zoomable group so the text stays at a constant CSS pixel
 * size; vertical offsets scale with screenScale (and cancel out the gap
 * the zoomed glyph leaves below itself).
 */
export function FerryLabels({
  x,
  y,
  now,
  screenScale,
  tx,
  ty,
  scale,
  muted = false,
  inbound = false,
  onClick,
}: FerryLabelsProps) {
  const { t } = useTranslation();
  const ferry = getNextFerryDeparture(now, inbound);
  const nowMinutes = minutesOfDay(now);
  const minsUntil = ferry
    ? Math.max(0, parseTimeToMinutes(ferry.depart) - nowMinutes)
    : null;
  const etaLabel =
    minsUntil != null
      ? t("mapDiagram.nextFerryBadge", { minutes: minsUntil })
      : t("mapDiagram.noMoreFerries");

  const nameSize = TOKEN.ferryNameSize / screenScale;
  const etaSize = TOKEN.ferryEtaSize / screenScale;
  // Glyph radius scales with zoom; gap + font are constant CSS px.
  const ferryR = TOKEN.terminalR + 2;
  const cx = x * scale + tx;
  const cy = y * scale + ty;
  const nameY =
    cy + ferryR * scale + (TOKEN.ferryNameGapPx + TOKEN.ferryNameSize) / screenScale;
  const etaY =
    nameY + (TOKEN.ferryEtaGapPx + TOKEN.ferryEtaSize) / screenScale;

  return (
    <g pointerEvents="none">
      <text
        x={cx}
        y={nameY}
        textAnchor="middle"
        fontSize={nameSize}
        fontWeight={TOKEN.ferryNameWeight}
        fill={muted ? TOKEN.mutedTrack : undefined}
        className={muted ? undefined : "fill-foreground"}
        pointerEvents={onClick ? "auto" : "none"}
        style={{ fontFamily: FONT_FAMILY, cursor: onClick ? "pointer" : "default" }}
        onClick={
          onClick
            ? (e) => {
                e.stopPropagation();
                onClick();
              }
            : undefined
        }
      >
        {t("mapDiagram.sanFrancisco")}
      </text>
      <text
        x={cx}
        y={etaY}
        textAnchor="middle"
        fontSize={etaSize}
        fontWeight={TOKEN.ferryEtaWeight}
        fill={muted ? TOKEN.mutedTrack : undefined}
        className={muted ? undefined : "fill-muted-foreground"}
        letterSpacing={TOKEN.ferryEtaTracking}
        style={{ fontFamily: FONT_FAMILY }}
      >
        {etaLabel}
      </text>
    </g>
  );
}
