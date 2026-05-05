import type { MapTrain } from "@/hooks/useMapTrains";
import { haversineKm } from "@/lib/stationUtils";
import {
  MAX_LATCHED_DISTANCE_KM,
  RELEASE_OFF_CORRIDOR_KM,
  TRAIN_VANISHED_MS,
} from "./constants";
import { distanceToCorridorKm } from "./corridor";
import type { TrainTransitionMap, UserSample } from "./types";

export type ReleaseReason = "off-corridor" | "vanished" | "wrong-train";

interface ReleaseArgs {
  latchedTrainKey: string;
  user: UserSample;
  trains: MapTrain[];
  transitions: TrainTransitionMap;
}

/**
 * Decide whether to drop the latch this tick. We deliberately do NOT release
 * on stationary-user ticks the way the old detector did — long platform
 * dwells mid-trip would spuriously drop the latch. With boarding correlation
 * doing the engagement, only hard "the rider is gone" signals release.
 *
 * Cheaper checks first so the polyline walk is skipped when possible.
 */
export function shouldReleaseLatch(args: ReleaseArgs): ReleaseReason | null {
  const { latchedTrainKey, user, trains, transitions } = args;

  const transition = transitions.get(latchedTrainKey);
  if (transition && user.nowMs - transition.lastSeenAtMs > TRAIN_VANISHED_MS) {
    return "vanished";
  }

  const live = trains.find((t) => t.key === latchedTrainKey);
  if (live) {
    const distKm = haversineKm(
      user.lat,
      user.lng,
      live.latitude,
      live.longitude,
    );
    if (distKm > MAX_LATCHED_DISTANCE_KM) return "wrong-train";
  }

  if (distanceToCorridorKm(user.lat, user.lng) > RELEASE_OFF_CORRIDOR_KM) {
    return "off-corridor";
  }

  return null;
}
