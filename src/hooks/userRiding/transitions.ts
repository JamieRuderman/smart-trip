import type { MapTrain } from "@/hooks/useMapTrains";
import { getClosestStationWithDistance } from "@/lib/stationUtils";
import {
  TRAIN_AT_STATION_KM,
  TRAIN_MOVING_MPS,
  TRAIN_STATIONARY_MPS,
} from "./constants";
import type { TrainTransitionMap, TrainTransitionState } from "./types";

/**
 * Update per-train transition state for the current tick.
 *
 * For each train we record:
 *   - The most recent station the train was sitting at while stationary.
 *   - The timestamp + station of the most recent stopped→moving transition.
 *   - The last time we saw the train in the GTFS-RT feed (used by the
 *     release logic to detect vanished trains).
 *
 * Trains absent from the current `trains` array carry their previous state
 * forward unchanged so a brief feed gap doesn't lose history.
 */
export function updateTransitions(
  prev: TrainTransitionMap,
  trains: MapTrain[],
  nowMs: number,
): TrainTransitionMap {
  const next: TrainTransitionMap = new Map();

  for (const train of trains) {
    if (!Number.isFinite(train.latitude) || !Number.isFinite(train.longitude)) continue;
    const previous = prev.get(train.key);
    const speed = train.speed;

    const isStationary = speed != null && speed <= TRAIN_STATIONARY_MPS;
    const isMoving = speed != null && speed >= TRAIN_MOVING_MPS;

    let lastStationaryNearStation = previous?.lastStationaryNearStation ?? null;
    if (isStationary) {
      const { station, distanceKm } = getClosestStationWithDistance(
        train.latitude,
        train.longitude,
      );
      if (distanceKm <= TRAIN_AT_STATION_KM) lastStationaryNearStation = station;
    }

    let lastDepartedAtMs = previous?.lastDepartedAtMs ?? null;
    let lastDepartedFromStation = previous?.lastDepartedFromStation ?? null;
    const wasStationary =
      previous != null &&
      previous.lastSpeedMps != null &&
      previous.lastSpeedMps <= TRAIN_STATIONARY_MPS;
    if (wasStationary && isMoving && lastStationaryNearStation != null) {
      lastDepartedAtMs = nowMs;
      lastDepartedFromStation = lastStationaryNearStation;
    }

    const updated: TrainTransitionState = {
      lastSpeedMps: speed,
      lastStationaryNearStation,
      lastDepartedAtMs,
      lastDepartedFromStation,
      lastSeenAtMs: nowMs,
    };
    next.set(train.key, updated);
  }

  // Preserve absent trains so the release logic can detect "vanished".
  for (const [key, state] of prev) {
    if (!next.has(key)) next.set(key, state);
  }
  return next;
}
