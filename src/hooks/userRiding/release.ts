import type { MapTrain } from "@/hooks/useMapTrains";
import { haversineKm } from "@/lib/stationUtils";
import {
  MAX_LATCHED_DISTANCE_KM,
  RELEASE_OFF_CORRIDOR_KM,
  TRAIN_VANISHED_MS,
} from "./constants";
import { distanceToCorridorKm } from "./corridor";
import type { RidingLatch, TrainTransitionMap, UserSample } from "./types";

export type ReleaseReason = "off-corridor" | "vanished" | "wrong-train";

interface ReleaseArgs {
  latch: RidingLatch;
  user: UserSample;
  trains: MapTrain[];
  transitions: TrainTransitionMap;
}

/**
 * Decide whether to drop the latch this tick.
 *
 * The new model trusts the boarding correlation, so a long platform dwell
 * mid-trip should NOT release the latch the way the old stationary-tick
 * counter did. Release only on hard signals:
 *   - User is clearly off the rail corridor (disembarked and walked away).
 *   - The latched train has dropped out of the GTFS-RT feed for too long
 *     (trip likely ended or vehicle went offline).
 *   - User is implausibly far from the latched train's last reported
 *     position (wrong train, or rider switched).
 */
export function shouldReleaseLatch(args: ReleaseArgs): ReleaseReason | null {
  const { latch, user, trains, transitions } = args;

  if (distanceToCorridorKm(user.lat, user.lng) > RELEASE_OFF_CORRIDOR_KM) {
    return "off-corridor";
  }

  const transition = transitions.get(latch.trainKey);
  if (transition && user.nowMs - transition.lastSeenAtMs > TRAIN_VANISHED_MS) {
    return "vanished";
  }

  const live = trains.find((t) => t.key === latch.trainKey);
  if (live) {
    const distKm = haversineKm(
      user.lat,
      user.lng,
      live.latitude,
      live.longitude,
    );
    if (distKm > MAX_LATCHED_DISTANCE_KM) return "wrong-train";
  }

  return null;
}
