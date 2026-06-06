import { useEffect } from "react";
import { useStationSelection } from "@/contexts/stationSelection";
import stations from "@/data/stations";
import {
  getTodayScheduleType,
  nextServiceDate,
  tripServesLeg,
} from "@/lib/scheduleUtils";
import { focusedTripMatchesSchedule } from "@/lib/focusedTrip";
import type { Station } from "@/types/smartSchedule";

/**
 * Once-per-session record of rides we've already auto-focused (or that the
 * user explicitly took ownership of). Module-level so it survives navigation
 * between home and the map-diagram page — both can call this hook safely
 * without re-triggering after a cancel. Cleared on full page reload, which
 * is fine: if the user opens the app again later, auto-focusing the current
 * ride is the desired behaviour.
 */
const autoFocusedRides = new Set<string>();

interface UseAutoFocusOnRidingArgs {
  /** GTFS-derived human trip number of the train the user is on. */
  ridingTripNumber: number | null;
  /** Direction of the riding train. `null` when unknown. */
  ridingIsSouthbound: boolean | null;
  currentTime: Date;
  /** User's home from/to (empty string = unset). When set and the trip
   *  serves the leg, focus on the home leg so the pinned card shows the
   *  user's actual destination instead of the corridor terminus. */
  homeFromStation?: Station | "";
  homeToStation?: Station | "";
}

/**
 * Promote a GPS-detected ride to the "Going" / focused state. Being detected
 * on a train is a strong signal that this IS the user's trip — so the pinned
 * "My Trip" card, schedule highlights, and reminder controls should all be
 * available without making the user re-tap Go.
 *
 * Once per ride the hook fires `focusTrip()`. The session ref means a user
 * who taps Cancel on the pinned card won't get re-focused on the next GPS
 * tick (otherwise the cancel is uncancellable while on the train).
 *
 * A different train (e.g. they got off and boarded another) or a fresh
 * session (page reload) is a new opportunity for auto-focus.
 */
export function useAutoFocusOnRiding({
  ridingTripNumber,
  ridingIsSouthbound,
  currentTime,
  homeFromStation = "",
  homeToStation = "",
}: UseAutoFocusOnRidingArgs): void {
  const { focusedTrip, focusTrip } = useStationSelection();

  useEffect(() => {
    if (ridingTripNumber == null || ridingIsSouthbound == null) return;
    const scheduleType = getTodayScheduleType(currentTime);
    const serviceDate = nextServiceDate(currentTime, scheduleType);
    const rideKey = `${ridingTripNumber}-${ridingIsSouthbound}-${serviceDate}`;
    if (autoFocusedRides.has(rideKey)) return;

    // Already focused on this exact run — record so we don't re-fire after a
    // user cancel during the same ride.
    if (
      focusedTripMatchesSchedule(focusedTrip, ridingIsSouthbound, scheduleType) &&
      focusedTrip.tripNumber === ridingTripNumber
    ) {
      autoFocusedRides.add(rideKey);
      return;
    }

    // Don't clobber a different explicit focus the user set on their own.
    // They might be tracking a train they're meeting, not the one they're on.
    if (focusedTrip) return;

    // Prefer the user's home leg when this train serves it (so the pinned
    // card shows their selected destination), otherwise the full corridor.
    const corridorFrom = ridingIsSouthbound
      ? stations[0]
      : stations[stations.length - 1];
    const corridorTo = ridingIsSouthbound
      ? stations[stations.length - 1]
      : stations[0];
    const useHomeLeg =
      !!homeFromStation &&
      !!homeToStation &&
      tripServesLeg(
        ridingTripNumber,
        homeFromStation,
        homeToStation,
        scheduleType,
      );

    autoFocusedRides.add(rideKey);
    void focusTrip({
      tripNumber: ridingTripNumber,
      fromStation: useHomeLeg ? homeFromStation : corridorFrom,
      toStation: useHomeLeg ? homeToStation : corridorTo,
      scheduleType,
      serviceDate,
    });
  }, [
    ridingTripNumber,
    ridingIsSouthbound,
    focusedTrip,
    homeFromStation,
    homeToStation,
    currentTime,
    focusTrip,
  ]);
}
