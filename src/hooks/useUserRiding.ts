/**
 * Detect whether the user is currently riding a train.
 *
 * Returns the matching train's `key` (matches `MapTrain.key`) when a train's
 * GPS position and the user's GPS position are close AND something is moving
 * fast enough to plausibly be on board. Either the device's reported speed
 * or the train's own GTFS-RT speed satisfies the movement check — Mobile
 * Safari frequently returns null for `coords.speed`, so requiring it strictly
 * misses real rides. Distance thresholds are sized to absorb the ~30 s lag
 * between vehicle-position updates (a train at ~25 m/s can be hundreds of
 * meters ahead of its last reported point).
 *
 * Hysteresis: once latched onto a train, only release when the train moves
 * far away OR the user has been near-stationary for a few ticks. Without
 * this, the dot would flick between the train marker and the nearest
 * station every time the train pauses at a red signal or station.
 */

import { useEffect, useRef, useState } from "react";
import type { MapTrain } from "@/hooks/useMapTrains";
import { haversineKm } from "@/lib/stationUtils";

interface UseUserRidingArgs {
  userLat: number | null;
  userLng: number | null;
  userSpeedMps: number | null;
  trains: MapTrain[];
}

/** Movement floor for engaging "riding". Has to be above typical walking/
 *  cycling speeds (~3 m/s ≈ 6.7 mph) but low enough to catch a train coasting
 *  into or out of a station. Either the user *or* the train can supply this
 *  signal — see hasMovementSignal below. */
const ENGAGE_SPEED_MPS = 3;

/** Maximum train→user haversine distance for engaging the riding state.
 *  GTFS-RT vehicle positions are typically refreshed every ~30 s, so a train
 *  at ~25 m/s can be 700+ m ahead of its last reported point by the time we
 *  evaluate. Tight thresholds (≤ 0.3 km) miss the ride entirely; this gives
 *  the lag enough headroom while still excluding parallel roads. */
const ENGAGE_DISTANCE_KM = 0.6;

/** Distance at which we drop a latched train (let the dot snap back to the
 *  nearest station). Comfortably larger than ENGAGE_DISTANCE_KM so brief
 *  GPS noise or stale vehicle-position updates don't cause flicker. */
const RELEASE_DISTANCE_KM = 1.2;

/** Speed below which the user-stationary counter increments. */
const STATIONARY_SPEED_MPS = 1;

/** Number of consecutive sub-stationary ticks before releasing the latch. */
const STATIONARY_TICKS_TO_RELEASE = 3;

export function useUserRiding({
  userLat,
  userLng,
  userSpeedMps,
  trains,
}: UseUserRidingArgs): { ridingTrainKey: string | null } {
  const [ridingTrainKey, setRidingTrainKey] = useState<string | null>(null);
  const stationaryTicksRef = useRef(0);

  useEffect(() => {
    if (userLat == null || userLng == null) {
      if (ridingTrainKey !== null) setRidingTrainKey(null);
      stationaryTicksRef.current = 0;
      return;
    }

    // Find the nearest train to the user; we'll evaluate engagement against
    // it (single best candidate avoids ambiguity at close-parallel tracks).
    let nearest: { train: MapTrain; distKm: number } | null = null;
    for (const train of trains) {
      if (
        !Number.isFinite(train.latitude) ||
        !Number.isFinite(train.longitude)
      ) {
        continue;
      }
      const distKm = haversineKm(
        userLat,
        userLng,
        train.latitude,
        train.longitude,
      );
      if (!nearest || distKm < nearest.distKm) {
        nearest = { train, distKm };
      }
    }

    if (ridingTrainKey == null) {
      // Engage when a train is within radius AND something is moving fast
      // enough. Mobile Safari often returns null for `coords.speed`; in that
      // case the train's own GTFS-RT speed is treated as corroborating
      // evidence so we don't refuse to engage just because the device didn't
      // report a velocity.
      const userMoving =
        userSpeedMps != null && userSpeedMps >= ENGAGE_SPEED_MPS;
      const trainMoving =
        nearest != null &&
        nearest.train.speed != null &&
        nearest.train.speed >= ENGAGE_SPEED_MPS;
      const hasMovementSignal =
        userMoving || (userSpeedMps == null && trainMoving);

      if (
        nearest &&
        nearest.distKm <= ENGAGE_DISTANCE_KM &&
        hasMovementSignal
      ) {
        setRidingTrainKey(nearest.train.key);
        stationaryTicksRef.current = 0;
      }
      return;
    }

    // Already latched. Re-evaluate the latched train specifically.
    const latched = trains.find((t) => t.key === ridingTrainKey);
    if (!latched) {
      setRidingTrainKey(null);
      stationaryTicksRef.current = 0;
      return;
    }
    const latchedDistKm = haversineKm(
      userLat,
      userLng,
      latched.latitude,
      latched.longitude,
    );

    if (latchedDistKm > RELEASE_DISTANCE_KM) {
      setRidingTrainKey(null);
      stationaryTicksRef.current = 0;
      return;
    }

    if (userSpeedMps != null && userSpeedMps < STATIONARY_SPEED_MPS) {
      stationaryTicksRef.current += 1;
      if (stationaryTicksRef.current >= STATIONARY_TICKS_TO_RELEASE) {
        setRidingTrainKey(null);
        stationaryTicksRef.current = 0;
      }
    } else {
      stationaryTicksRef.current = 0;
    }
  }, [userLat, userLng, userSpeedMps, trains, ridingTrainKey]);

  return { ridingTrainKey };
}
