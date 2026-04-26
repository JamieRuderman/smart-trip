import { useMemo } from "react";
import { X, ArrowUp, ArrowDown, Check, LogIn, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import stations from "@/data/stations";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { isWeekend } from "@/lib/utils";
import { stationIndexMap, stationZoneMap } from "@/lib/stationUtils";
import { ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import { cn } from "@/lib/utils";
import { DELAY_MINUTES_THRESHOLD } from "@/lib/realtimeConstants";
import { Button } from "@/components/ui/button";
import { AppSheet } from "@/components/ui/app-sheet";
import type { Station } from "@/types/smartSchedule";

const WINDSOR = stations[0];
const LARKSPUR = stations[stations.length - 1];
const ARRIVALS_WINDOW_MINUTES = 180;
const MAX_ARRIVALS = 6;

interface Arrival {
  tripNumber: number;
  terminus: Station;
  isSouthbound: boolean;
  etaMinutes: number;
  delayMinutes: number | null;
  isCanceled: boolean;
}

export interface StationInfoSheetProps {
  isOpen: boolean;
  onClose: () => void;
  station: Station;
  currentTime: Date;
  /** Currently-selected origin (for the active trip). */
  fromStation?: Station | null;
  /** Currently-selected destination (for the active trip). */
  toStation?: Station | null;
  /** Set the tapped station as the trip origin. */
  onSetFrom?: (station: Station) => void;
  /** Set the tapped station as the trip destination. */
  onSetTo?: (station: Station) => void;
}

/**
 * StationInfoSheet — station-detail content (zone badge, From/To buttons,
 * upcoming arrivals) rendered inside the shared {@link AppSheet} chrome,
 * so it presents identically to TripDetailSheet on both mobile (bottom
 * sheet w/ swipe-to-dismiss) and desktop (centered Dialog).
 */
export function StationInfoSheet({
  isOpen,
  onClose,
  station,
  currentTime,
  fromStation = null,
  toStation = null,
  onSetFrom,
  onSetTo,
}: StationInfoSheetProps) {
  const { t } = useTranslation();
  const scheduleType = isWeekend() ? "weekend" : "weekday";

  const southboundTrips = useMemo(
    () => getFilteredTrips(WINDSOR, LARKSPUR, scheduleType),
    [scheduleType],
  );
  const northboundTrips = useMemo(
    () => getFilteredTrips(LARKSPUR, WINDSOR, scheduleType),
    [scheduleType],
  );

  const sbStatus = useTripRealtimeStatusMap(WINDSOR, LARKSPUR, southboundTrips);
  const nbStatus = useTripRealtimeStatusMap(LARKSPUR, WINDSOR, northboundTrips);

  const arrivals = useMemo<Arrival[]>(() => {
    const stationIdx = stationIndexMap[station];
    if (stationIdx == null) return [];

    const nowMinutes = minutesOfDay(currentTime);

    const collect = (
      trips: typeof southboundTrips,
      isSouthbound: boolean,
      statusMaps: typeof sbStatus,
    ): Arrival[] =>
      trips
        .map((trip) => {
          const staticTime = trip.times[stationIdx];
          if (!staticTime || staticTime === "~~") return null;

          const rt = statusMaps.statusMap.get(trip.departureTime) ?? null;
          const live = rt?.allStopLiveDepartures?.[station];
          const effectiveTime = live ?? staticTime;
          const etaMinutes = parseTimeToMinutes(effectiveTime) - nowMinutes;

          const delayMinutes = rt?.delayMinutes ?? null;

          return {
            tripNumber: trip.trip,
            terminus: isSouthbound ? LARKSPUR : WINDSOR,
            isSouthbound,
            etaMinutes,
            delayMinutes:
              delayMinutes != null && delayMinutes >= DELAY_MINUTES_THRESHOLD
                ? delayMinutes
                : null,
            isCanceled: rt?.isCanceled === true,
          } satisfies Arrival;
        })
        .filter((a): a is Arrival => a != null);

    const merged = [
      ...collect(southboundTrips, true, sbStatus),
      ...collect(northboundTrips, false, nbStatus),
    ]
      .filter((a) => a.etaMinutes >= 0 && a.etaMinutes <= ARRIVALS_WINDOW_MINUTES)
      .sort((a, b) => a.etaMinutes - b.etaMinutes)
      .slice(0, MAX_ARRIVALS);

    return merged;
  }, [station, currentTime, southboundTrips, northboundTrips, sbStatus, nbStatus]);

  const zone = stationZoneMap[station];
  const zoneColor = ZONE_TRACK_COLORS[zone];

  return (
    <AppSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("stationInfo.stationInfoAria", { station })}
    >
      <div className="px-5 pb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: zoneColor }}
              aria-hidden="true"
            />
            <span
              className="text-xs font-bold tracking-widest uppercase"
              style={{ color: zoneColor }}
            >
              {t("stationInfo.zoneLabel", { zone })}
            </span>
          </div>
          <h2 className="mt-1 text-2xl font-bold text-foreground">{station}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 -mr-1 text-muted-foreground hover:text-foreground"
          aria-label={t("stationInfo.close")}
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {(onSetFrom || onSetTo) && (
        <div className="px-5 pb-4 flex gap-2">
          {onSetFrom && (
            <FromToButton
              role="from"
              isCurrent={fromStation === station}
              onClick={() => onSetFrom(station)}
            />
          )}
          {onSetTo && (
            <FromToButton
              role="to"
              isCurrent={toStation === station}
              onClick={() => onSetTo(station)}
            />
          )}
        </div>
      )}

      <div className="border-t border-border" />

      <div
        className="px-5 pt-4 pb-6 overflow-auto"
        data-sheet-scroll-area="true"
      >
        <h3 className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-3">
          {t("stationInfo.nextArrivals")}
        </h3>
        {arrivals.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {t("stationInfo.noUpcoming")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {arrivals.map((a) => (
              <ArrivalRow key={`${a.tripNumber}-${a.isSouthbound}`} arrival={a} />
            ))}
          </ul>
        )}
      </div>
    </AppSheet>
  );
}

function FromToButton({
  role,
  isCurrent,
  onClick,
}: {
  role: "from" | "to";
  isCurrent: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const Icon = isCurrent ? Check : role === "from" ? LogIn : LogOut;
  const label = isCurrent
    ? t(role === "from" ? "stationInfo.currentFrom" : "stationInfo.currentTo")
    : t(role === "from" ? "stationInfo.setAsFrom" : "stationInfo.setAsTo");

  return (
    <Button
      type="button"
      variant={isCurrent ? "secondary" : "outline"}
      size="sm"
      disabled={isCurrent}
      onClick={onClick}
      className="flex-1"
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

function ArrivalRow({ arrival }: { arrival: Arrival }) {
  const { t } = useTranslation();
  const isDelayed =
    !arrival.isCanceled &&
    arrival.delayMinutes != null &&
    arrival.delayMinutes >= DELAY_MINUTES_THRESHOLD;

  const badgeClasses = arrival.isCanceled
    ? "bg-muted text-muted-foreground"
    : isDelayed
      ? "bg-smart-gold text-white"
      : "bg-smart-train-green text-white";

  const etaClasses = arrival.isCanceled
    ? "text-muted-foreground line-through"
    : isDelayed
      ? "text-smart-gold"
      : "text-foreground";

  const DirArrow = arrival.isSouthbound ? ArrowDown : ArrowUp;
  const directionLabel = arrival.isSouthbound
    ? t("tracker.southbound")
    : t("tracker.northbound");

  return (
    <li className="flex items-center gap-4 py-4">
      <span
        className={cn(
          "flex items-center justify-center w-14 h-10 rounded-full font-bold text-lg shrink-0",
          badgeClasses,
        )}
      >
        {arrival.tripNumber}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-foreground">
          {t("stationInfo.toTerminus", { terminus: arrival.terminus })}
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
          <DirArrow className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{directionLabel}</span>
          {arrival.isCanceled ? (
            <span className="text-destructive font-medium">
              {t("stationInfo.canceledSuffix")}
            </span>
          ) : isDelayed ? (
            <span className="text-smart-gold font-medium">
              {t("stationInfo.delaySuffix", { minutes: arrival.delayMinutes })}
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span className={cn("text-3xl font-bold tabular-nums", etaClasses)}>
          {arrival.etaMinutes}
        </span>
        <span className={cn("text-sm ml-1", etaClasses)}>
          {t("stationInfo.minUnit")}
        </span>
      </div>
    </li>
  );
}
