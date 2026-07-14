import { useMemo } from "react";
import { X, ArrowUp, ArrowDown, MapPin, Flag } from "lucide-react";
import { useTranslation } from "react-i18next";

import stations from "@/data/stations";
import {
  getFilteredTrips,
  getTodayScheduleType,
  type ProcessedTrip,
} from "@/lib/scheduleUtils";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { stationIndexMap, stationZoneMap } from "@/lib/stationUtils";
import { ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import { cn } from "@/lib/utils";
import {
  DELAY_MINUTES_THRESHOLD,
  isTrainDelayed,
} from "@/lib/realtimeConstants";
import { AppSheet } from "@/components/ui/app-sheet";
import { TripIcon } from "@/components/icons/TripIcon";
import { TimeDisplay, formatTime } from "@/components/TimeDisplay";
import { useStationSelection } from "@/contexts/stationSelection";
import { focusedTripMatchesSchedule } from "@/lib/focusedTrip";
import {
  cardTripState,
  stateCardStyle,
  stateText,
  ridingCardStyle,
  type TripState,
} from "@/lib/tripTheme";
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
  /** Effective arrival time at this station, "HH:MM" — includes live updates
   *  when present so the displayed clock time reflects real-world delay. */
  effectiveTime: string;
  /** Scheduled arrival time at this station — used to show a struck-through
   *  comparison when the live time differs (delayed). */
  scheduledTime: string;
  /** The user's destination if they've picked one in the matching direction;
   *  otherwise the train's end-of-line terminus. */
  destinationStation: Station;
  /** Effective arrival time at {@link destinationStation}, or null when the
   *  tapped station IS the destination (so we don't render a redundant time). */
  destinationTime: string | null;
  delayMinutes: number | null;
  isCanceled: boolean;
  /** Underlying schedule trip — handed back to the caller when the row is
   *  tapped so they can open the trip detail sheet. */
  trip: ProcessedTrip;
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
  /** Clear the trip origin — called when tapping the From button while this
   *  station is already the origin. */
  onClearFrom?: () => void;
  /** Clear the trip destination — called when tapping the To button while
   *  this station is already the destination. */
  onClearTo?: () => void;
  /** Open the trip detail sheet for an arriving train, with this station
   *  as the displayed origin and the train's terminus as the destination. */
  onArrivalClick?: (
    trip: ProcessedTrip,
    fromStation: Station,
    toStation: Station,
  ) => void;
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
  onClearFrom,
  onClearTo,
  onArrivalClick,
}: StationInfoSheetProps) {
  const { t } = useTranslation();
  const scheduleType = getTodayScheduleType();
  const { focusedTrip } = useStationSelection();

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

  // When the user has both endpoints selected, restrict the arrivals list to
  // the direction of their trip — these are train schedules, and trains going
  // the wrong way aren't actionable from the station they tapped.
  const directionFilter = useMemo<"southbound" | "northbound" | null>(() => {
    if (!fromStation || !toStation) return null;
    const a = stationIndexMap[fromStation];
    const b = stationIndexMap[toStation];
    if (a == null || b == null) return null;
    return a < b ? "southbound" : "northbound";
  }, [fromStation, toStation]);

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

          // Delay at THIS station — the displayed time (effectiveTime) is
          // this station's live time, so the delayed styling must match it,
          // not the origin's delay: a train on time at its origin can be
          // late by the time it reaches this stop, and one delayed at its
          // origin can have recovered. When the feed carries a live time for
          // this station, its per-stop delay (absent = on time here) is
          // authoritative; the trip-level origin delay is only the fallback
          // for trips with no per-stop data.
          const delayMinutes =
            rt?.allStopDelayMinutes?.[station] ??
            (live != null ? null : (rt?.delayMinutes ?? null));
          const terminus = isSouthbound ? LARKSPUR : WINDSOR;

          // Prefer the user's selected destination if direction matches the
          // train; otherwise fall back to the train's end-of-line terminus.
          const destinationStation: Station =
            directionFilter && toStation && (directionFilter === "southbound") === isSouthbound
              ? toStation
              : terminus;
          let destinationTime: string | null = null;
          if (destinationStation !== station) {
            const destIdx = stationIndexMap[destinationStation];
            const destStatic = destIdx != null ? trip.times[destIdx] : null;
            if (destStatic && destStatic !== "~~") {
              const destLive = rt?.allStopLiveDepartures?.[destinationStation];
              destinationTime = destLive ?? destStatic;
            }
          }

          return {
            tripNumber: trip.trip,
            terminus,
            isSouthbound,
            etaMinutes,
            effectiveTime,
            scheduledTime: staticTime,
            destinationStation,
            destinationTime,
            delayMinutes:
              delayMinutes != null && delayMinutes >= DELAY_MINUTES_THRESHOLD
                ? delayMinutes
                : null,
            isCanceled: rt?.isCanceled === true,
            trip,
          } satisfies Arrival;
        })
        .filter((a): a is Arrival => a != null);

    const merged = [
      ...collect(southboundTrips, true, sbStatus),
      ...collect(northboundTrips, false, nbStatus),
    ]
      .filter(
        (a) =>
          a.etaMinutes >= 0 &&
          a.etaMinutes <= ARRIVALS_WINDOW_MINUTES &&
          (directionFilter == null ||
            (directionFilter === "southbound") === a.isSouthbound),
      )
      .sort((a, b) => a.etaMinutes - b.etaMinutes)
      .slice(0, MAX_ARRIVALS);

    return merged;
  }, [
    station,
    currentTime,
    southboundTrips,
    northboundTrips,
    sbStatus,
    nbStatus,
    directionFilter,
    toStation,
  ]);

  const zone = stationZoneMap[station];
  const zoneColor = ZONE_TRACK_COLORS[zone];

  return (
    <AppSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("stationInfo.stationInfoAria", { station })}
      handleSlot={
        // Colored drag-handle band keyed off the station's zone color, so
        // handle and the colored title row below read as one continuous band.
        <div
          className="flex justify-center pt-3 pb-1 shrink-0"
          style={{ backgroundColor: zoneColor }}
        >
          <div className="w-10 h-1 rounded-full bg-white/40" />
        </div>
      }
    >
      <div
        className="px-5 pt-2 pb-4 flex items-start justify-between gap-4 shrink-0"
        style={{ backgroundColor: zoneColor }}
      >
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-widest uppercase text-white/80">
            {t("stationInfo.zoneLabel", { zone })}
          </p>
          <h2 className="mt-0.5 text-2xl font-bold text-white">{station}</h2>
          {fromStation && toStation && (
            // Route summary — mirrors the home "My Trip" card. The current
            // station collapses to "Here" so the user can see at a glance
            // whether they're looking at their origin, destination, or an
            // intermediate stop.
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-white/90">
              <span className="whitespace-nowrap">
                {fromStation === station ? t("stationInfo.here") : fromStation}
              </span>
              <span className="font-normal text-white/60">→</span>
              <span className="whitespace-nowrap">
                {toStation === station ? t("stationInfo.here") : toStation}
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 -mr-1 rounded-full text-white hover:bg-white/20 transition-colors shrink-0"
          aria-label={t("stationInfo.close")}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {(onSetFrom || onSetTo) && (
        <div className="px-5 pt-4 pb-4 flex gap-3">
          {onSetFrom && (
            <FromToColumn
              role="from"
              isCurrent={fromStation === station}
              onClick={() =>
                fromStation === station
                  ? onClearFrom?.()
                  : onSetFrom(station)
              }
            />
          )}
          {onSetTo && (
            <FromToColumn
              role="to"
              isCurrent={toStation === station}
              onClick={() =>
                toStation === station ? onClearTo?.() : onSetTo(station)
              }
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
          <ul className="flex flex-col gap-2">
            {arrivals.map((a) => {
              // Highlight the user's focused ("Go") train blue here too,
              // matching the schedule rows and pinned card. Shared predicate:
              // number + direction + schedule type (the trip number is reused
              // across directions / weekday-weekend).
              const isFocused =
                focusedTripMatchesSchedule(
                  focusedTrip,
                  a.isSouthbound,
                  scheduleType,
                ) && focusedTrip.tripNumber === a.tripNumber;
              return (
                <ArrivalRow
                  key={`${a.tripNumber}-${a.isSouthbound}`}
                  arrival={a}
                  isFocused={isFocused}
                  onClick={
                    onArrivalClick
                      ? () => onArrivalClick(a.trip, station, a.terminus)
                      : undefined
                  }
                />
              );
            })}
          </ul>
        )}
      </div>
    </AppSheet>
  );
}

function FromToColumn({
  role,
  isCurrent,
  onClick,
}: {
  role: "from" | "to";
  isCurrent: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const RoleIcon = role === "from" ? MapPin : Flag;
  const roleLabel = t(
    role === "from" ? "stationInfo.departure" : "stationInfo.destination",
  );
  const actionLabel = t(
    isCurrent ? "stationInfo.clearStation" : "stationInfo.setStation",
  );
  const ariaLabel = t(
    isCurrent
      ? role === "from"
        ? "stationInfo.clearDepartureAria"
        : "stationInfo.clearDestinationAria"
      : role === "from"
        ? "stationInfo.setAsDepartureAria"
        : "stationInfo.setAsDestinationAria",
  );

  return (
    <div className="flex-1 flex flex-col gap-1.5 min-w-0">
      <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
        {roleLabel}
      </span>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isCurrent}
        aria-label={ariaLabel}
        className={cn(
          "h-11 rounded-xl border-2 px-3 flex items-center gap-2",
          "transition-colors text-left",
          isCurrent
            ? "border-primary bg-primary/10 text-primary hover:bg-primary/20"
            : "border-border bg-card text-foreground hover:bg-accent hover:border-primary/40",
        )}
      >
        <span
          className={cn(
            "shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
            isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {isCurrent ? <X className="w-3.5 h-3.5" /> : <RoleIcon className="w-3.5 h-3.5" />}
        </span>
        <span className="text-sm font-semibold leading-tight">{actionLabel}</span>
      </button>
    </div>
  );
}

function ArrivalRow({
  arrival,
  isFocused = false,
  onClick,
}: {
  arrival: Arrival;
  /** True when this is the user's focused ("Go") trip — blue card treatment
   *  so it reads as "the trip I'm taking". */
  isFocused?: boolean;
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const isDelayed = isTrainDelayed(arrival);

  // Card state mirrors TripCard's semantics so the row reads in the same
  // visual language as the main schedule. No "next train" highlight here —
  // every row is an upcoming arrival; only delay/cancel deserve emphasis.
  const cardState: TripState = cardTripState({
    isCanceledOrSkipped: arrival.isCanceled,
    isDelayed,
    isNextTrip: false,
    isPastTrip: false,
  });

  const DirArrow = arrival.isSouthbound ? ArrowDown : ArrowUp;
  const directionLabel = arrival.isSouthbound
    ? t("tracker.southbound")
    : t("tracker.northbound");

  const etaCopy = arrival.isCanceled
    ? t("stationInfo.canceledSuffix").replace(/^·\s*/, "")
    : arrival.etaMinutes <= 0
      ? t("stationInfo.nowArriving")
      : t("stationInfo.inMinutes", { minutes: arrival.etaMinutes });

  const rowContent = (
    <>
      {/* Train icon + number, tinted by trip state (delayed = gold,
          canceled = red, otherwise foreground). */}
      <div className={cn("flex items-center gap-1.5 shrink-0", stateText[cardState])}>
        <TripIcon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <span className="text-2xl font-semibold tabular-nums leading-none">
          {arrival.tripNumber}
        </span>
      </div>

      {/* Direction (top) + ETA copy (bottom). ETA is indented `pl-5` so it
          lines up with the "Southbound" / "Northbound" label rather than the
          arrow icon — matches w-4 (16px) + gap-1 (4px) = 20px. */}
      <div className="flex-1 min-w-0 leading-tight">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <DirArrow className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="font-medium truncate">{directionLabel}</span>
        </div>
        <div
          className={cn(
            "text-xs tabular-nums mt-0.5 pl-5",
            arrival.isCanceled ? "text-destructive font-medium" : "text-muted-foreground",
            isDelayed && "text-smart-gold font-medium",
          )}
        >
          {etaCopy}
        </div>
      </div>

      {/* Right: arrival time at this station (large) + "to {destination} at
          {time}" beneath it when the train continues past this stop. */}
      <div className="shrink-0 text-right leading-tight">
        <div
          className={cn(
            "text-xl font-semibold tabular-nums",
            arrival.isCanceled && "line-through text-muted-foreground",
            isDelayed && "text-smart-gold",
          )}
        >
          <TimeDisplay time={arrival.effectiveTime} />
        </div>
        {arrival.destinationTime && (
          <div
            className={cn(
              "text-xs tabular-nums mt-0.5 text-muted-foreground",
              arrival.isCanceled && "line-through",
            )}
          >
            {t("stationInfo.arrivingAt", {
              time: formatTime(arrival.destinationTime),
            })}
          </div>
        )}
        {isDelayed && (
          <TimeDisplay
            time={arrival.scheduledTime}
            className="text-xs line-through text-muted-foreground"
          />
        )}
      </div>
    </>
  );

  const cardClasses = cn(
    "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all",
    // Blue == "you're taking this train" — overrides the semantic state
    // colour for the user-focused ("Go") trip.
    isFocused ? ridingCardStyle : stateCardStyle[cardState],
  );

  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            cardClasses,
            "w-full text-left touch-manipulation cursor-pointer focus:outline-none",
          )}
          aria-label={t("stationInfo.openTripAria", {
            trip: arrival.tripNumber,
            terminus: arrival.terminus,
          })}
        >
          {rowContent}
        </button>
      ) : (
        <div className={cardClasses}>{rowContent}</div>
      )}
    </li>
  );
}
