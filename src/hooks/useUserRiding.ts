/**
 * Detect whether the user is currently riding a SMART train.
 *
 * The detection model lives in `./userRiding/`:
 *   - boarding.ts: dwell at a platform → DepartureEvent on accelerated exit
 *   - transitions.ts: per-train stopped→moving history from GTFS-RT
 *   - engagement.ts: correlate boarding with train departure (preferred);
 *     fall back to same-direction tiered nearest-train for cold starts
 *   - release.ts: drop the latch only on hard signals (off-corridor,
 *     vanished from feed, implausibly far from latched train)
 *
 * The hook orchestrates these and exposes the latched train's `key`.
 */

import { useEffect, useRef, useState } from "react";
import type { MapTrain } from "@/hooks/useMapTrains";
import { alongTrackDistanceKm } from "@/lib/railProjection";
import { haversineKm } from "@/lib/stationUtils";
import {
  INITIAL_BOARDING_STATE,
  isDepartureStale,
  updateBoardingState,
} from "./userRiding/boarding";
import { ENGAGE_COLOCATION_KM } from "./userRiding/constants";
import { pickTrainToLatch } from "./userRiding/engagement";
import { shouldReleaseLatch } from "./userRiding/release";
import { updateTransitions } from "./userRiding/transitions";
import type {
  BoardingState,
  DepartureEvent,
  TrainTransitionMap,
  UserSample,
} from "./userRiding/types";

/** Latched train must be at least this far along-track for an obviously-
 *  co-located alternate to override it. Keeps the latch sticky against
 *  same-direction trains stacked at one station while still correcting an
 *  early mis-pick once the user is sitting next to a different train. */
const STALE_LATCH_SWAP_KM = 1.0;

/** Find the train (other than `latched`) the user is most clearly riding,
 *  if any. We require the alternate to be co-located AND much closer along
 *  the corridor than the current latch — flicker-proof but corrective. */
function strongerCoLocatedAlternate(
  latchedKey: string,
  user: UserSample,
  trains: MapTrain[],
): MapTrain | null {
  const latched = trains.find((t) => t.key === latchedKey);
  if (!latched) return null;
  const latchedAlong =
    alongTrackDistanceKm(
      user.lat,
      user.lng,
      latched.latitude,
      latched.longitude,
    ) ??
    haversineKm(
      user.lat,
      user.lng,
      latched.latitude,
      latched.longitude,
    );
  if (latchedAlong < STALE_LATCH_SWAP_KM) return null;

  let best: { train: MapTrain; distKm: number } | null = null;
  for (const train of trains) {
    if (train.key === latchedKey) continue;
    if (!Number.isFinite(train.latitude) || !Number.isFinite(train.longitude)) continue;
    if (latched.directionId != null && train.directionId !== latched.directionId) {
      // A different-direction train co-located with us means we're at a
      // station, not riding it. Don't swap.
      continue;
    }
    const distKm =
      alongTrackDistanceKm(
        user.lat,
        user.lng,
        train.latitude,
        train.longitude,
      ) ??
      haversineKm(user.lat, user.lng, train.latitude, train.longitude);
    if (distKm > ENGAGE_COLOCATION_KM) continue;
    if (best == null || distKm < best.distKm) best = { train, distKm };
  }
  return best?.train ?? null;
}

interface UseUserRidingArgs {
  userLat: number | null;
  userLng: number | null;
  userSpeedMps: number | null;
  /** Direction of travel in degrees (0 = N, 90 = E, …). Often null when the
   *  device isn't moving or hasn't seen enough position deltas yet. */
  userHeading: number | null;
  trains: MapTrain[];
}

export function useUserRiding({
  userLat,
  userLng,
  userSpeedMps,
  userHeading,
  trains,
}: UseUserRidingArgs): { ridingTrainKey: string | null } {
  const [ridingTrainKey, setRidingTrainKey] = useState<string | null>(null);
  const boardingRef = useRef<BoardingState>(INITIAL_BOARDING_STATE);
  const transitionsRef = useRef<TrainTransitionMap>(new Map());
  const recentDepartureRef = useRef<DepartureEvent | null>(null);

  useEffect(() => {
    if (userLat == null || userLng == null) {
      // GPS unavailable (permission revoked, location services off). Without
      // a position we can't justify saying the user is on a train, so drop
      // the latch and reset the boarding primer. Train transition history
      // can stay — it's about trains, not the user.
      if (ridingTrainKey !== null) setRidingTrainKey(null);
      boardingRef.current = INITIAL_BOARDING_STATE;
      recentDepartureRef.current = null;
      return;
    }

    const nowMs = Date.now();
    const sample: UserSample = {
      lat: userLat,
      lng: userLng,
      speedMps: userSpeedMps,
      heading: userHeading,
      nowMs,
    };

    transitionsRef.current = updateTransitions(
      transitionsRef.current,
      trains,
      nowMs,
    );

    const { next, departure } = updateBoardingState(boardingRef.current, sample);
    boardingRef.current = next;
    if (departure) recentDepartureRef.current = departure;
    if (
      recentDepartureRef.current &&
      isDepartureStale(recentDepartureRef.current, nowMs)
    ) {
      recentDepartureRef.current = null;
    }

    if (ridingTrainKey != null) {
      // Upgrade paths: a fallback latch can be replaced when a stronger
      // signal lands — a boarding-correlated transition, or a clear
      // "phone is moving along the rail in this direction" reading.
      let swapped = false;
      const upgrade = pickTrainToLatch({
        user: sample,
        trains,
        transitions: transitionsRef.current,
        recentDeparture: recentDepartureRef.current,
      });
      if (
        upgrade &&
        upgrade.key !== ridingTrainKey &&
        (upgrade.source === "correlation" || upgrade.source === "motion")
      ) {
        setRidingTrainKey(upgrade.key);
        swapped = true;
      }
      if (upgrade?.source === "correlation") {
        recentDepartureRef.current = null;
      }

      // Self-correction: if a different same-direction train is sitting
      // on top of the user while the latched one is far away, the cold-
      // start fallback picked the wrong train (or the user transferred).
      // Swap to the obviously-correct one. Bounded by along-track
      // distance so two trains stacked at a station won't oscillate.
      if (!swapped) {
        const alternate = strongerCoLocatedAlternate(
          ridingTrainKey,
          sample,
          trains,
        );
        if (alternate) {
          setRidingTrainKey(alternate.key);
          swapped = true;
        }
      }

      const reason = shouldReleaseLatch({
        latchedTrainKey: ridingTrainKey,
        user: sample,
        trains,
        transitions: transitionsRef.current,
      });
      if (reason) setRidingTrainKey(null);
      return;
    }

    const pick = pickTrainToLatch({
      user: sample,
      trains,
      transitions: transitionsRef.current,
      recentDeparture: recentDepartureRef.current,
    });
    if (pick) {
      if (pick.source === "correlation") recentDepartureRef.current = null;
      setRidingTrainKey(pick.key);
    }
  }, [userLat, userLng, userSpeedMps, userHeading, trains, ridingTrainKey]);

  return { ridingTrainKey };
}
