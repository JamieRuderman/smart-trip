import { useEffect, useMemo } from "react";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  anchorLiveTime,
  focusedArrivalInstant,
  focusedTripClearInstant,
  reconstructFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { useNow } from "@/hooks/useNow";
import { toLocalDateKey } from "@/lib/timeUtils";
import { TRIP_ENDED_THRESHOLD_MIN } from "@/lib/tripConstants";

/**
 * Invisible app-level worker that clears the focused trip a short grace after it
 * arrives — delay-aware, so a late train isn't dropped while it's still en
 * route. Lives at the root (like {@link LiveActivitySync}) so it tracks the
 * focus on any surface, and runs on every platform (the pinned "My Trip" card
 * exists on web/Android too, where there's no Live Activity to piggyback on).
 *
 * The clock is the live arrival (GTFS-RT), falling back to the schedule; the
 * exact rule lives in {@link focusedTripClearInstant}. `loadFocusedTrip`'s
 * scheduled-arrival eviction is only a far storage backstop for a focus left
 * behind by a cold boot hours later.
 */
export function FocusedTripAutoClear() {
  const { focusedTrip } = useStationSelection();
  if (!focusedTrip) return null;
  return <FocusedTripAutoClearInner focusedTrip={focusedTrip} />;
}

function FocusedTripAutoClearInner({
  focusedTrip,
}: {
  focusedTrip: FocusedTrip;
}) {
  const { clearFocusedTrip } = useStationSelection();
  // 30s tick: cheap re-render that re-checks the arrival boundary between
  // realtime polls, matching LiveActivitySync's cadence.
  const nowSeconds = useNow(30_000);
  const now = nowSeconds * 1000;

  const trip = useMemo(() => reconstructFocusedTrip(focusedTrip), [focusedTrip]);
  const trips = useMemo(() => (trip ? [trip] : []), [trip]);
  const { statusMap, canceledByStartTime, lastUpdated } =
    useTripRealtimeStatusMap(
      focusedTrip.fromStation,
      focusedTrip.toStation,
      trips,
    );

  // Same primary + cancelled-fallback lookup as FocusedTripCard / LiveActivitySync.
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

  // The RT feed describes today's runs only — a future-service focus must not
  // inherit live data from a same-numbered trip running today.
  const live =
    focusedTrip.serviceDate === toLocalDateKey(new Date(now))
      ? realtimeStatus
      : null;

  const scheduledArrivalAt = useMemo(
    () => focusedArrivalInstant(focusedTrip),
    [focusedTrip],
  );
  const liveArrivalAt =
    scheduledArrivalAt != null && live?.liveArrivalTime
      ? anchorLiveTime(scheduledArrivalAt, live.liveArrivalTime)
      : null;

  const clearAt = focusedTripClearInstant({
    scheduledArrivalAt,
    liveArrivalAt,
    feedLoaded: lastUpdated != null,
    graceMs: TRIP_ENDED_THRESHOLD_MIN * 60_000,
  });

  useEffect(() => {
    if (clearAt == null || now < clearAt) return;
    void clearFocusedTrip();
  }, [now, clearAt, clearFocusedTrip]);

  return null;
}
