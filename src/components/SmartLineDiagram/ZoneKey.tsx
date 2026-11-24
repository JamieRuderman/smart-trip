import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ZONE_TRACK_COLORS } from "@/data/smartLineLayout";

const ZONES = [1, 2, 3, 4, 5];

/** Fare-zone key for the zone-coloured track, floating over the map's corner:
 *  a short run of track in each zone's colour, north at the top. */
export function ZoneKey() {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute left-3 rounded-lg bg-background/90 px-2.5 py-2 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm"
      style={{ bottom: "calc(12px + var(--safe-area-bottom))" }}
    >
      <p className="mb-1">{t("mapDiagram.zones")}</p>
      <ul>
        {ZONES.map((zone, i) => (
          <li key={zone} className="flex h-4 items-center gap-2 tabular-nums">
            <span
              className={cn(
                "h-full w-1.5",
                i === 0 && "rounded-t-full",
                i === ZONES.length - 1 && "rounded-b-full",
              )}
              style={{ backgroundColor: ZONE_TRACK_COLORS[zone] }}
              aria-hidden="true"
            />
            {zone}
          </li>
        ))}
      </ul>
    </div>
  );
}
