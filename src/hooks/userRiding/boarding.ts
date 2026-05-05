import { getClosestStationWithDistance } from "@/lib/stationUtils";
import {
  DEPARTURE_SPEED_MPS,
  PLATFORM_DWELL_MS,
  PLATFORM_RADIUS_KM,
} from "./constants";
import type { BoardingState, DepartureEvent, UserSample } from "./types";

export const INITIAL_BOARDING_STATE: BoardingState = {
  station: null,
  sinceMs: null,
};

/**
 * Update the boarding-primer state for a single GPS tick.
 *
 * The user is "primed for boarding" once they've dwelled inside
 * PLATFORM_RADIUS_KM of a single station for PLATFORM_DWELL_MS. A
 * `DepartureEvent` is emitted on the tick the user crosses outside the
 * platform radius while moving above DEPARTURE_SPEED_MPS — that's the
 * signal we then correlate against train stopped→moving transitions to
 * decide which overlapping train the user actually boarded.
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
