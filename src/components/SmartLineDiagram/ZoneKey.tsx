import { useTranslation } from "react-i18next";
import { ZONE_TRACK_COLORS } from "@/data/smartLineLayout";

const ZONES = [1, 2, 3, 4, 5];

/** Fare-zone key for the zone-coloured track, floating over the map's corner. */
export function ZoneKey() {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute left-3 flex items-center gap-2 rounded-lg bg-background/90 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm"
      style={{ bottom: "calc(12px + var(--safe-area-bottom))" }}
    >
      <span>{t("mapDiagram.zones")}</span>
      {ZONES.map((zone) => (
        <span key={zone} className="flex items-center gap-1 tabular-nums">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: ZONE_TRACK_COLORS[zone] }}
            aria-hidden="true"
          />
          {zone}
        </span>
      ))}
    </div>
  );
}
