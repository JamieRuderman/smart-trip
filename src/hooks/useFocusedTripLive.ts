import { useMemo } from "react";
import {
  reconstructFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { toLocalDateKey } from "@/lib/timeUtils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";

export interface FocusedTripLive {
  /** The focused trip reconstructed from the schedule, or null when it's no
   *  longer in the timetable. */
  trip: ProcessedTrip | null;
  /** Realtime status for the focused leg, or null when the feed has nothing
   *  for it OR the focus is a future-service run (see below). */
  live: TripRealtimeStatus | null;
  /** When the GTFS-RT data was last fetched (null if never — i.e. not loaded). */
  lastUpdated: Date | null;
}

/**
 * Shared focused-trip realtime derivation used by the app-root workers that
 * track the pinned trip ({@link LiveActivitySync}, {@link ReminderDialogHost},
 * {@link FocusedTripAutoClear}). Reconstructs the trip, looks up its realtime
 * status (primary by departure time, cancelled-fallback by origin start time),
 * and gates that status to the focus's own service date — the RT feed describes
 * TODAY's runs only, so a future-service focus (e.g. a weekend trip picked on a
 * weekday) must not inherit live data from a same-numbered run today.
 *
 * `now` (epoch ms) is passed in so each caller keeps its own tick cadence.
 */
export function useFocusedTripLive(
  focusedTrip: FocusedTrip,
  now: number,
): FocusedTripLive {
  const trip = useMemo(() => reconstructFocusedTrip(focusedTrip), [focusedTrip]);
  const trips = useMemo(() => (trip ? [trip] : []), [trip]);
  const { statusMap, canceledByStartTime, lastUpdated } =
    useTripRealtimeStatusMap(
      focusedTrip.fromStation,
      focusedTrip.toStation,
      trips,
    );

  const realtimeStatus = useMemo(() => {
    if (!trip) return null;
    const primary = statusMap.get(trip.departureTime);
    if (primary) return primary;
    if (canceledByStartTime.size > 0) {
      for (const time of trip.times) {
        const secondary = canceledByStartTime.get(time);
        if (secondary) return secondary;
      }
    }
    return null;
  }, [statusMap, canceledByStartTime, trip]);

  const live =
    focusedTrip.serviceDate === toLocalDateKey(new Date(now))
      ? realtimeStatus
      : null;

  return { trip, live, lastUpdated };
}
