import { useEffect, useMemo, useRef } from "react";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  anchorLiveTime,
  focusedArrivalInstant,
  focusedTripClearInstant,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { useFocusedTripLive } from "@/hooks/useFocusedTripLive";
import { useNow } from "@/hooks/useNow";
import { useVehiclePositionForTrip } from "@/hooks/useVehiclePositions";
import { isVehicleShortOfDestination } from "@/lib/tripProgress";
import { isSouthbound } from "@/lib/stationUtils";
import { TRIP_ENDED_THRESHOLD_MIN } from "@/lib/tripConstants";

/** How far before the scheduled arrival the vehicle-position veto starts
 *  polling. The time-based clear can't fire before scheduled arrival + grace,
 *  so a couple of poll cycles of lead is enough for fresh data at the boundary. */
const VEHICLE_VETO_LEAD_MS = 5 * 60_000;

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
  // Key by trip identity so the "last seen live arrival" ref below resets when
  // the user switches trips (the inner component would otherwise persist it).
  const key = `${focusedTrip.tripNumber}-${focusedTrip.serviceDate}-${focusedTrip.fromStation}-${focusedTrip.toStation}`;
  return <FocusedTripAutoClearInner key={key} focusedTrip={focusedTrip} />;
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

  const { trip, live, lastUpdated } = useFocusedTripLive(focusedTrip, now);

  const scheduledArrivalAt = useMemo(
    () => focusedArrivalInstant(focusedTrip),
    [focusedTrip],
  );

  // Live vehicle position for the focused run (same strict start-time/date/
  // direction match the detail sheet uses). A heavily delayed train can drop
  // its arrival prediction from the trip updates feed entirely; the positions
  // feed is then the only proof it's still en route, and it must veto the
  // time-based clear below so the rider's active trip isn't stopped mid-ride.
  // Polling only starts shortly before the scheduled arrival — the clear can't
  // fire earlier, so a trip focused hours ahead doesn't pay for an all-day feed.
  const southbound = isSouthbound(focusedTrip.fromStation, focusedTrip.toStation);
  const originStartTime = southbound
    ? trip?.times[0]?.slice(0, 5)
    : trip?.times[trip.times.length - 1]?.slice(0, 5);
  const nearArrival =
    scheduledArrivalAt != null &&
    now >= scheduledArrivalAt - VEHICLE_VETO_LEAD_MS;
  const vehiclePosition = useVehiclePositionForTrip(
    originStartTime,
    focusedTrip.serviceDate.replace(/-/g, ""),
    southbound ? 0 : 1,
    nearArrival,
  );
  const vehicleShortOfDestination = isVehicleShortOfDestination(
    vehiclePosition,
    focusedTrip.toStation,
    southbound,
  );
  const liveArrivalAt =
    scheduledArrivalAt != null && live?.liveArrivalTime
      ? anchorLiveTime(scheduledArrivalAt, live.liveArrivalTime)
      : null;

  // Remember the last live arrival the feed gave us. A tracked, delayed train
  // that's still short of the stop can briefly drop its prediction (feed
  // hiccup); without this we'd fall back to scheduled+grace and clear it early.
  // Using the last-seen value instead keeps deferring while it's still ahead,
  // and — once the train passes the stop and the prediction is genuinely gone —
  // that last value is now in the past, so the clear fires promptly (correct for
  // a through train that continues past the rider's stop).
  const lastLiveArrivalRef = useRef<number | null>(null);
  useEffect(() => {
    if (liveArrivalAt != null) lastLiveArrivalRef.current = liveArrivalAt;
  }, [liveArrivalAt]);

  const clearAt = focusedTripClearInstant({
    scheduledArrivalAt,
    liveArrivalAt: liveArrivalAt ?? lastLiveArrivalRef.current,
    feedLoaded: lastUpdated != null,
    graceMs: TRIP_ENDED_THRESHOLD_MIN * 60_000,
    vehicleShortOfDestination,
  });

  useEffect(() => {
    if (clearAt == null || now < clearAt) return;
    void clearFocusedTrip();
  }, [now, clearAt, clearFocusedTrip]);

  return null;
}
