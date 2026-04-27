/**
 * Detect whether the user is currently riding a train.
 *
 * Returns the matching train's `key` (matches `MapTrain.key`) when a train's
 * GPS position and the user's GPS position are close AND the user is moving
 * fast enough to plausibly be on board. The diagram uses this to render the
 * user-location dot at the train's marker instead of at the nearest station.
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

/** User's speed must be at least this for "riding" to engage from scratch.
 *  At/below this speed we assume the user is walking/driving alongside, not
 *  on the train. SMART trains accelerate fast, so 5 m/s (~11 mph) is a
 *  conservative floor that excludes typical walking and slow biking. */
const ENGAGE_SPEED_MPS = 5;

/** Maximum train→user haversine distance for engaging the riding state. */
const ENGAGE_DISTANCE_KM = 0.25;

/** Distance at which we drop a latched train (let the dot snap back to the
 *  nearest station). Larger than ENGAGE_DISTANCE_KM so brief GPS noise or
 *  parallel-track wiggle doesn't cause flicker. */
const RELEASE_DISTANCE_KM = 0.5;

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
      // Engage: requires moving and a train within engage radius.
      if (
        userSpeedMps != null &&
        userSpeedMps >= ENGAGE_SPEED_MPS &&
        nearest &&
        nearest.distKm <= ENGAGE_DISTANCE_KM
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
