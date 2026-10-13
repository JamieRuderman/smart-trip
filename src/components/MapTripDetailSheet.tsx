import type { ReactElement } from "react";
import stations from "@/data/stations";
import { useStationSelection } from "@/contexts/stationSelection";
import { useFocusedTripLive } from "@/hooks/useFocusedTripLive";
import { focusedLegShowsFerry } from "@/hooks/useMyTrip";
import {
  focusedTripKey,
  isFocusedTrainToday,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { getTodayScheduleType, type ProcessedTrip } from "@/lib/scheduleUtils";
import { validStation } from "@/lib/stationUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
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

  // isNextTrip=true so the header reads as an active, on-time trip when all
  // displayed stops are still in the future (the narrowed view hides past
  // stops, which would otherwise flip the header into the neutral "future"
  // state). The home screen's selected leg is marked on the run's stops.
  const runSheet = (
    <TripDetailSheet
      {...shared}
      trip={run}
      fromStation={run.fromStation}
      toStation={run.toStation}
      realtimeStatus={detail.realtimeStatus}
      timeFormat="12h"
      isNextTrip={true}
      showFerry={false}
      scheduleType={getTodayScheduleType(currentTime)}
      userFromStation={validStation(fromStation)}
      userToStation={validStation(toStation)}
    />
  );

  if (
    isFocusedTrainToday(
      focusedTrip,
      run.trip,
      run.toStation === LARKSPUR,
      currentTime,
    )
  ) {
    return (
      <FocusedLegSheet
        key={focusedTripKey(focusedTrip)}
        {...shared}
        focusedTrip={focusedTrip}
        fallback={runSheet}
      />
    );
  }
  return runSheet;
}

/**
 * The focused leg's sheet: its reconstructed trip and live status, the same
 * ones My Trip shows. Keyed per focus by the caller, so per-trip state resets
 * on a switch. Falls back to the
 * tapped run's sheet while the focus can't be rebuilt from the timetable (the
 * provider's tick then clears it), rather than opening nothing.
 */
function FocusedLegSheet({
  focusedTrip,
  fallback,
  ...shared
}: Omit<MapTripDetailSheetProps, "detail"> & {
  focusedTrip: FocusedTrip;
  fallback: ReactElement;
}) {
  const { trip, live } = useFocusedTripLive(
    focusedTrip,
    shared.currentTime.getTime(),
  );
  if (!trip) return fallback;
  return (
    <TripDetailSheet
      {...shared}
      trip={trip}
      fromStation={focusedTrip.fromStation}
      toStation={focusedTrip.toStation}
      realtimeStatus={live}
      timeFormat="12h"
      isNextTrip={true}
      showFerry={focusedLegShowsFerry(focusedTrip, trip)}
      isFocused={true}
      scheduleType={focusedTrip.scheduleType}
    />
  );
}
