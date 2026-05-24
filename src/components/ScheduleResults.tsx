import { CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { TripCard } from "./TripCard";
import { ScheduleHeader } from "./ScheduleHeader";
import { NoMoreTrainsAlert } from "./NoMoreTrainsAlert";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { isTimeInPast, getNextTripIndex, getFirstInProgressTripIndex } from "@/lib/scheduleUtils";
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
  selectedTripNumber: number | null;
  onSelectTrip: (tripNumber: number | null) => void;
  /** Trip number of the train the user is currently riding (if any) — the
   *  matching row gets a blue ring + "Riding" pill. */
  ridingTripNumber?: number | null;
  /** Direction of the riding train — disambiguates trip numbers that are
   *  reused across directions. */
  ridingIsSouthbound?: boolean | null;
}

export function ScheduleResults({
  filteredTrips,
  fromStation,
  toStation,
  currentTime,
  showAllTrips,
  onToggleShowAllTrips,
  timeFormat,
  selectedTripNumber,
  onSelectTrip,
  ridingTripNumber = null,
  ridingIsSouthbound = null,
}: ScheduleResultsProps) {
  const direction = useStationDirection(fromStation, toStation);
  // Direction of the displayed schedule — used to confirm a riding trip
  // number actually belongs to the schedule the user is looking at (the
  // same trip number is reused across the opposite-direction schedule).
  const scheduleIsSouthbound = direction?.direction === "southbound";
  const ridingMatchesSchedule =
    ridingTripNumber != null &&
    ridingIsSouthbound != null &&
    ridingIsSouthbound === scheduleIsSouthbound;
  const { statusMap: realtimeStatusMap, canceledByStartTime, lastUpdated } = useTripRealtimeStatusMap(fromStation, toStation, filteredTrips);

  const nextTripIndex =
    filteredTrips.length > 0
      ? getNextTripIndex(filteredTrips, currentTime)
      : -1;

  // Show in-progress trips (departed but not yet arrived) before the next upcoming trip.
  const firstInProgressIndex = !showAllTrips
    ? getFirstInProgressTripIndex(filteredTrips, currentTime)
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

  // First non-past index in visibleTrips — used to flag the "Next" row.
  // Single pass instead of per-row .slice().every() (O(n) total vs O(n²)).
  const nextVisibleIndex = visibleTrips.findIndex(
    (trip) => !isTimeInPast(currentTime, trip.departureTime),
  );

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
      />
      <CardContent className="p-3 md:p-6 md:pt-0">
        {nextTripIndex === -1 && !showAllTrips && <NoMoreTrainsAlert />}
        <div
          className="space-y-3"
          role="list"
          aria-label="Train schedule results"
        >
          {visibleTrips.map((trip, index) => {
            const isPastTrip = isTimeInPast(currentTime, trip.departureTime);
            const realtimeStatus = getRealtimeStatus(trip);
            const isNextTrip = index === nextVisibleIndex;
            const showFerry =
              !!trip.outboundFerry && toStation === FERRY_CONSTANTS.FERRY_STATION;

            const isRiding =
              ridingMatchesSchedule && trip.trip === ridingTripNumber;
            return (
              <TripCard
                key={trip.trip}
                trip={trip}
                isNextTrip={isNextTrip}
                isPastTrip={isPastTrip}
                isRiding={isRiding}
                showFerry={showFerry}
                timeFormat={timeFormat}
                realtimeStatus={realtimeStatus}
                lastUpdated={lastUpdated}
                fromStation={fromStation}
                toStation={toStation}
                currentTime={currentTime}
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
