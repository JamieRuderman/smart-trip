/**
 * Detect whether the user is currently riding a train.
 *
 * Returns the matching train's `key` (matches `MapTrain.key`) when the user's
 * and train's GPS positions are close enough to indicate they're together.
 * Engagement uses two tiers:
 *   - Co-location (≤ ENGAGE_COLOCATION_KM): engage regardless of motion. At
 *     this distance the user is effectively in the vehicle, so a station
 *     stop where neither side reports speed shouldn't block the latch.
 *   - Proximity (≤ ENGAGE_DISTANCE_KM): require movement (user OR train
 *     above ENGAGE_SPEED_MPS). Mobile Safari often returns null for
 *     `coords.speed`, so the train's own GTFS-RT speed corroborates when
 *     the device hasn't reported a velocity.
 *
 * Distance thresholds are sized to absorb the ~30 s lag between vehicle-
 * position updates (a train at ~25 m/s can be hundreds of meters ahead of
 * its last reported point).
 *
 * Hysteresis: once latched, only release when the train moves far away OR
 * the user has been near-stationary for a few ticks while the train kept
 * moving. A station stop (both stationary, still co-located) does NOT
 * count as stationary ticks — otherwise the latch would drop every time
 * the train spent more than ~3 s at a platform.
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

/** Co-location radius. Within this distance the user is effectively inside
 *  the train, so engage regardless of reported speed. Critical for the
 *  station-stop case: both user and train sit still (speed = 0) yet the
 *  user is plainly on board. Tighter than ENGAGE_DISTANCE_KM so a train
 *  passing on a parallel road can't trigger this branch. */
const ENGAGE_COLOCATION_KM = 0.15;

/** Maximum train→user haversine distance for engaging via the proximity
 *  branch (movement required). GTFS-RT vehicle positions are typically
 *  refreshed every ~30 s, so a train at ~25 m/s can be 700+ m ahead of its
 *  last reported point — this absorbs that lag without being so wide that
 *  parallel-road traffic latches. */
const ENGAGE_DISTANCE_KM = 0.9;

/** Distance at which we drop a latched train (let the dot snap back to the
 *  nearest station). Comfortably larger than ENGAGE_DISTANCE_KM so brief
 *  GPS noise or stale vehicle-position updates don't cause flicker. */
const RELEASE_DISTANCE_KM = 1.5;

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
      if (!nearest) return;

      // Tier 1: co-located. The user and the train share GPS within the
      // close-radius — engage regardless of speed. Handles the station-stop
      // case where both sides report 0.
      if (nearest.distKm <= ENGAGE_COLOCATION_KM) {
        setRidingTrainKey(nearest.train.key);
        stationaryTicksRef.current = 0;
        return;
      }

      // Tier 2: nearby and moving. Mobile Safari often returns null for
      // `coords.speed`; treat the train's own GTFS-RT speed as corroborating
      // evidence so we don't refuse to engage just because the device didn't
      // report a velocity.
      const userMoving =
        userSpeedMps != null && userSpeedMps >= ENGAGE_SPEED_MPS;
      const trainMoving =
        nearest.train.speed != null &&
        nearest.train.speed >= ENGAGE_SPEED_MPS;
      const hasMovementSignal =
        userMoving || (userSpeedMps == null && trainMoving);

      if (nearest.distKm <= ENGAGE_DISTANCE_KM && hasMovementSignal) {
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

    // Only count "user is stationary" ticks against the latch when the
    // train is actually moving — a station stop means both sides sit still
    // and shouldn't release. Co-location is the second guard: if user and
    // train are still together, treat any stillness as "we're stopped at a
    // station" rather than "user got off."
    const userStationary =
      userSpeedMps != null && userSpeedMps < STATIONARY_SPEED_MPS;
    const trainStationary =
      latched.speed == null || latched.speed < STATIONARY_SPEED_MPS;
    const colocated = latchedDistKm <= ENGAGE_COLOCATION_KM;
    const stationStop = trainStationary && colocated;

    if (userStationary && !stationStop) {
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
