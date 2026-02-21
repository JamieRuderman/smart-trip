import { Card, CardContent } from "@/components/ui/card";
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
  const realtimeStatusMap = useTripRealtimeStatusMap(fromStation, toStation);

  const nextTripIndex =
    filteredTrips.length > 0
      ? getNextTripIndex(filteredTrips, currentTime)
      : -1;

  const displayedTrips = showAllTrips
    ? filteredTrips
    : filteredTrips.slice(nextTripIndex >= 0 ? nextTripIndex : 0);

  if (!direction) return null;

  return (
    <Card className="border-0 shadow-none md:border md:shadow-sm max-w-4xl mx-auto w-full">
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
            // Find the next trip using the same time logic as isPastTrip
            const isNextTrip =
              !isPastTrip &&
              displayedTrips.slice(0, index).every((prevTrip) => {
                return isTimeInPast(currentTime, prevTrip.departureTime);
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
                realtimeStatus={realtimeStatusMap.get(trip.departureTime)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
