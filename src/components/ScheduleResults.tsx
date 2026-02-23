import { CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { TripCard } from "./TripCard";
import { ScheduleHeader } from "./ScheduleHeader";
import { NoMoreTrainsAlert } from "./NoMoreTrainsAlert";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { isTimeInPast, getNextTripIndex } from "@/lib/scheduleUtils";
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
}

export function ScheduleResults({
  filteredTrips,
  fromStation,
  toStation,
  currentTime,
  showAllTrips,
  onToggleShowAllTrips,
  timeFormat,
}: ScheduleResultsProps) {
  const direction = useStationDirection(fromStation, toStation);
  const { statusMap: realtimeStatusMap, canceledByStartTime } = useTripRealtimeStatusMap(fromStation, toStation, filteredTrips);

  const nextTripIndex =
    filteredTrips.length > 0
      ? getNextTripIndex(filteredTrips, currentTime)
      : -1;

  const displayedTrips = showAllTrips
    ? filteredTrips
    : filteredTrips.slice(nextTripIndex >= 0 ? nextTripIndex : 0);

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
        timeFormat={timeFormat}
        nextTripIndex={nextTripIndex}
        showAllTrips={showAllTrips}
        onToggleShowAllTrips={onToggleShowAllTrips}
      />
      <CardContent className="p-3 md:p-6 md:pt-0">
        {nextTripIndex === -1 && !showAllTrips && <NoMoreTrainsAlert />}
        <div
          className="space-y-3"
          role="list"
          aria-label="Train schedule results"
        >
          {displayedTrips.map((trip, index) => {
            const isPastTrip = isTimeInPast(currentTime, trip.departureTime);
            const realtimeStatus = getRealtimeStatus(trip);
            const isTripCanceled = realtimeStatus?.isCanceled ?? false;
            const isTripSkipped = realtimeStatus?.isOriginSkipped ?? false;
            // Skip canceled/skipped trips when finding the next available train
            const isNextTrip =
              !isPastTrip &&
              !isTripCanceled &&
              !isTripSkipped &&
              displayedTrips.slice(0, index).every((prevTrip) => {
                const prevStatus = getRealtimeStatus(prevTrip);
                return (
                  isTimeInPast(currentTime, prevTrip.departureTime) ||
                  (prevStatus?.isCanceled ?? false) ||
                  (prevStatus?.isOriginSkipped ?? false)
                );
              });
            const showFerry =
              trip.outboundFerry && toStation === FERRY_CONSTANTS.FERRY_STATION;

            return (
              <TripCard
                key={trip.trip}
                trip={trip}
                isNextTrip={isNextTrip}
                isPastTrip={isPastTrip}
                showAllTrips={showAllTrips}
                showFerry={showFerry}
                timeFormat={timeFormat}
                realtimeStatus={realtimeStatus}
              />
            );
          })}
        </div>
      </CardContent>
    </SectionCard>
  );
}
