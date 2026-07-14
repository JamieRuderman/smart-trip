import { CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { TripCard } from "./TripCard";
import { ScheduleHeader } from "./ScheduleHeader";
import { NoMoreTrainsAlert } from "./NoMoreTrainsAlert";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import {
  isTimeInPast,
  getNextTripIndex,
  getFirstInProgressTripIndex,
  effectiveDepartureTime,
} from "@/lib/scheduleUtils";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { useStationDirection } from "@/hooks/useStationDirection";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import type { Station } from "@/types/smartSchedule";

interface ScheduleResultsProps {
  filteredTrips: ProcessedTrip[];
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  showAllTrips: boolean;
  onToggleShowAllTrips: () => void;
  timeFormat: "12h" | "24h";
  /** Schedule (weekday/weekend) these results belong to — forwarded to each
   *  row's trip sheet so the reminder/focus control uses it instead of today. */
  scheduleType: "weekday" | "weekend";
  selectedTripNumber: number | null;
  onSelectTrip: (tripNumber: number | null) => void;
  /** The user's focused ("Go") trip number when it belongs to the displayed
   *  leg — that row is highlighted blue (it also appears pinned above; we
   *  intentionally keep it in the list rather than hiding it). */
  focusedTripNumber?: number | null;
}

export function ScheduleResults({
  filteredTrips,
  fromStation,
  toStation,
  currentTime,
  showAllTrips,
  onToggleShowAllTrips,
  timeFormat,
  scheduleType,
  selectedTripNumber,
  onSelectTrip,
  focusedTripNumber = null,
}: ScheduleResultsProps) {
  const direction = useStationDirection(fromStation, toStation);
  const { statusMap: realtimeStatusMap, canceledByStartTime, lastUpdated, isFeedUnavailable } = useTripRealtimeStatusMap(fromStation, toStation, filteredTrips);

  const nextTripIndex =
    filteredTrips.length > 0
      ? getNextTripIndex(filteredTrips, currentTime, realtimeStatusMap)
      : -1;

  // Show in-progress trips (departed but not yet arrived) before the next upcoming trip.
  const firstInProgressIndex = !showAllTrips
    ? getFirstInProgressTripIndex(filteredTrips, currentTime, realtimeStatusMap)
    : -1;

  const sliceStart = showAllTrips
    ? 0
    : firstInProgressIndex >= 0
      ? firstInProgressIndex
      : nextTripIndex >= 0
        ? nextTripIndex
        : 0;

  const displayedTrips = filteredTrips.slice(sliceStart);

  const visibleTrips =
    selectedTripNumber != null &&
    !showAllTrips &&
    !displayedTrips.some((trip) => trip.trip === selectedTripNumber)
      ? filteredTrips.filter(
          (trip) =>
            trip.trip === selectedTripNumber || displayedTrips.includes(trip),
        )
      : displayedTrips;

  // The "Next" row: the not-yet-departed trip with the EARLIEST live-aware
  // departure — not simply the first in schedule order, because a delayed
  // early trip (live 10:00) must not steal the badge from an on-time later
  // one (09:30) that actually leaves sooner. Single pass.
  let nextVisibleIndex = -1;
  let nextVisibleMinutes = Infinity;
  visibleTrips.forEach((trip, i) => {
    const departureTime = effectiveDepartureTime(trip, realtimeStatusMap);
    if (isTimeInPast(currentTime, departureTime)) return;
    const minutes = parseTimeToMinutes(departureTime);
    if (minutes < nextVisibleMinutes) {
      nextVisibleMinutes = minutes;
      nextVisibleIndex = i;
    }
  });

  if (!direction) return null;

  /**
   * Two-level realtime status lookup:
   * 1. Primary: match by fromStation scheduled departure time (normal case).
   * 2. Secondary: for CANCELED trips where the RT feed omitted stop_time_updates,
   *    scan trip.times for any time matching a canceledByStartTime key (origin time).
   */
  const getRealtimeStatus = (trip: { departureTime: string; times: string[] }) => {
    const primary = realtimeStatusMap.get(trip.departureTime);
    if (primary) return primary;
    if (canceledByStartTime.size === 0) return undefined;
    for (const t of trip.times) {
      const secondary = canceledByStartTime.get(t);
      if (secondary) return secondary;
    }
    return undefined;
  };

  return (
    <SectionCard>
      <ScheduleHeader
        direction={direction.direction}
        currentTime={currentTime}
        nextTripIndex={nextTripIndex}
        showAllTrips={showAllTrips}
        onToggleShowAllTrips={onToggleShowAllTrips}
        lastUpdated={lastUpdated}
        isFeedUnavailable={isFeedUnavailable}
      />
      <CardContent className="p-3 md:p-6 md:pt-0">
        {nextTripIndex === -1 && !showAllTrips && <NoMoreTrainsAlert />}
        <div
          className="space-y-3"
          role="list"
          aria-label="Train schedule results"
        >
          {visibleTrips.map((trip, index) => {
            // Live-aware: a delayed train past its scheduled slot but before
            // its live departure hasn't departed (keeps the aria "Departed"
            // announcement and badge flags consistent with the Next logic).
            const isPastTrip = isTimeInPast(
              currentTime,
              effectiveDepartureTime(trip, realtimeStatusMap),
            );
            const realtimeStatus = getRealtimeStatus(trip);
            const isNextTrip = index === nextVisibleIndex;
            const showFerry =
              !!trip.outboundFerry && toStation === FERRY_CONSTANTS.FERRY_STATION;

            // The focused trip stays in the list (also pinned above) and is
            // highlighted blue. focusedTripNumber is only set when the focus
            // is on this displayed leg, so a number match is sufficient.
            const isFocused =
              focusedTripNumber != null && trip.trip === focusedTripNumber;
            return (
              <TripCard
                key={trip.trip}
                trip={trip}
                isNextTrip={isNextTrip}
                isPastTrip={isPastTrip}
                isFocused={isFocused}
                showFerry={showFerry}
                timeFormat={timeFormat}
                realtimeStatus={realtimeStatus}
                lastUpdated={lastUpdated}
                fromStation={fromStation}
                toStation={toStation}
                currentTime={currentTime}
                scheduleType={scheduleType}
                selectedTripNumber={selectedTripNumber}
                onSelectTrip={onSelectTrip}
              />
            );
          })}
        </div>
      </CardContent>
    </SectionCard>
  );
}
