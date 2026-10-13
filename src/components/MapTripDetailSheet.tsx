import stations from "@/data/stations";
import { useStationSelection } from "@/contexts/stationSelection";
import { isFocusedTrainToday } from "@/lib/focusedTrip";
import { getTodayScheduleType, type ProcessedTrip } from "@/lib/scheduleUtils";
import { stationIndexMap } from "@/lib/stationUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { MyTripGate } from "./MyTripGate";
import { TripDetailSheet } from "./TripDetailSheet";

const LARKSPUR = stations[stations.length - 1];

/** A train run as a map resolves it: `trip` runs from a mid-corridor station
 *  (the stop it last served, or a tapped arrival's station) to the end of the
 *  line. */
export interface MapTripDetail {
  trip: ProcessedTrip;
  realtimeStatus: TripRealtimeStatus | null;
}

interface MapTripDetailSheetProps {
  detail: MapTripDetail;
  isOpen: boolean;
  onClose: () => void;
  currentTime: Date;
  lastUpdated: Date | null;
}

const validStation = (station: Station | ""): Station | null =>
  station && stationIndexMap[station] != null ? station : null;

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
}: MapTripDetailSheetProps) {
  const { fromStation, toStation, focusedTrip } = useStationSelection();
  const { trip: run } = detail;
  const shared = { isOpen, onClose, currentTime, lastUpdated } as const;

  if (
    isFocusedTrainToday(
      focusedTrip,
      run.trip,
      run.toStation === LARKSPUR,
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
  // state). The home screen's selected leg is marked on the run's stops.
  return (
    <TripDetailSheet
      {...shared}
      trip={run}
      fromStation={run.fromStation}
      toStation={run.toStation}
      realtimeStatus={detail.realtimeStatus}
      timeFormat="12h"
      isNextTrip={true}
      showFerry={false}
      scheduleType={getTodayScheduleType()}
      userFromStation={validStation(fromStation)}
      userToStation={validStation(toStation)}
    />
  );
}
