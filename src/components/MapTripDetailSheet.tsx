import stations from "@/data/stations";
import { useStationSelection } from "@/contexts/stationSelection";
import { isFocusedTrainToday } from "@/lib/focusedTrip";
import { getTodayScheduleType, type ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { MyTripGate } from "./MyTripGate";
import { TripDetailSheet } from "./TripDetailSheet";

const LARKSPUR = stations[stations.length - 1];

/** A train run as a map resolves it: from a mid-corridor station (the stop it
 *  last served, or a tapped arrival's station) to the end of the line. */
export interface MapTripDetail {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  realtimeStatus: TripRealtimeStatus | null;
}

interface MapTripDetailSheetProps {
  detail: MapTripDetail;
  isOpen: boolean;
  onClose: () => void;
  currentTime: Date;
  lastUpdated: Date | null;
  /** The home screen's selected leg, marked on the run's stop timeline. */
  userFromStation: Station | null;
  userToStation: Station | null;
}

/**
 * Trip sheet for a train opened from the live map or line diagram (its marker,
 * or a station sheet's arrival row). Any other train shows its run to the end
 * of the line; the user's own focused run shows their leg instead — the trip,
 * live status and ferry that My Trip shows — so the "My Trip" sheet never
 * reads different times, stops or fare from the trip it's labelled as.
 */
export function MapTripDetailSheet({
  detail,
  isOpen,
  onClose,
  currentTime,
  lastUpdated,
  userFromStation,
  userToStation,
}: MapTripDetailSheetProps) {
  const { focusedTrip } = useStationSelection();
  const shared = { isOpen, onClose, currentTime, lastUpdated } as const;

  if (
    isFocusedTrainToday(
      focusedTrip,
      detail.trip.trip,
      detail.toStation === LARKSPUR,
      currentTime,
    )
  ) {
    return (
      <MyTripGate focusedTrip={focusedTrip} currentTime={currentTime}>
        {({ trip, live, showFerry }) => (
          <TripDetailSheet
            {...shared}
            trip={trip}
            fromStation={focusedTrip.fromStation}
            toStation={focusedTrip.toStation}
            realtimeStatus={live}
            timeFormat="12h"
            isNextTrip={true}
            showFerry={showFerry}
            isFocused={true}
            scheduleType={focusedTrip.scheduleType}
          />
        )}
      </MyTripGate>
    );
  }

  // isNextTrip=true so the header reads as an active, on-time trip when all
  // displayed stops are still in the future (the narrowed view hides past
  // stops, which would otherwise flip the header into the neutral "future"
  // state).
  return (
    <TripDetailSheet
      {...shared}
      trip={detail.trip}
      fromStation={detail.fromStation}
      toStation={detail.toStation}
      realtimeStatus={detail.realtimeStatus}
      timeFormat="12h"
      isNextTrip={true}
      showFerry={false}
      scheduleType={getTodayScheduleType()}
      userFromStation={userFromStation}
      userToStation={userToStation}
    />
  );
}
