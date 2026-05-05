import { getClosestStationWithDistance } from "@/lib/stationUtils";
import {
  DEPARTURE_MATCH_WINDOW_MS,
  DEPARTURE_SPEED_MPS,
  PLATFORM_DWELL_MS,
  PLATFORM_RADIUS_KM,
} from "./constants";
import type { BoardingState, DepartureEvent, UserSample } from "./types";

export const INITIAL_BOARDING_STATE: BoardingState = {
  station: null,
  sinceMs: null,
};

/** A departure event is only useful while a corresponding train transition
 *  could plausibly arrive. Past the match window, drop it so it can't
 *  associate the user with a totally unrelated later departure. */
export function isDepartureStale(
  departure: DepartureEvent,
  nowMs: number,
): boolean {
  return nowMs - departure.atMs > DEPARTURE_MATCH_WINDOW_MS;
}

/**
 * Update the boarding-primer state for a single GPS tick. The dwell
 * requirement is what prevents drive-bys (cars passing through a platform
 * zone) from looking like a boarding event.
 */
export function updateBoardingState(
  prev: BoardingState,
  sample: UserSample,
): { next: BoardingState; departure: DepartureEvent | null } {
  const { station: nearest, distanceKm } = getClosestStationWithDistance(
    sample.lat,
    sample.lng,
  );
  const atPlatform = distanceKm <= PLATFORM_RADIUS_KM;

  if (atPlatform) {
    // Re-arm the dwell timer when first arriving (or station changed).
    if (prev.station !== nearest || prev.sinceMs == null) {
      return {
        next: { station: nearest, sinceMs: sample.nowMs },
        departure: null,
      };
    }
    return { next: prev, departure: null };
  }

  // Stepped outside the platform radius. Emit a departure only if the user
  // had been primed AND they're moving fast enough to be on a train.
  const userMoving =
    sample.speedMps != null && sample.speedMps >= DEPARTURE_SPEED_MPS;
  const wasPrimed =
    prev.station != null &&
    prev.sinceMs != null &&
    sample.nowMs - prev.sinceMs >= PLATFORM_DWELL_MS;

  if (wasPrimed && userMoving) {
    return {
      next: INITIAL_BOARDING_STATE,
      departure: { fromStation: prev.station!, atMs: sample.nowMs },
    };
  }

  // Walked off the platform without a fast departure (e.g. drove away,
  // bailed on the trip). Reset the primer.
  if (prev.station != null) {
    return { next: INITIAL_BOARDING_STATE, departure: null };
  }
  return { next: prev, departure: null };
}
