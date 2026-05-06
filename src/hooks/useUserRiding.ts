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
import {
  INITIAL_BOARDING_STATE,
  isDepartureStale,
  updateBoardingState,
} from "./userRiding/boarding";
import {
  isUpgradeSource,
  pickStrongerCoLocatedAlternate,
  pickTrainToLatch,
} from "./userRiding/engagement";
import { shouldReleaseLatch } from "./userRiding/release";
import { updateTransitions } from "./userRiding/transitions";
import type {
  BoardingState,
  DepartureEvent,
  TrainTransitionMap,
  UserSample,
} from "./userRiding/types";
import type { MapTrain } from "@/hooks/useMapTrains";

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
      // A fallback latch can be replaced by a stronger signal — a
      // boarding-correlated transition, a "moving along the rail this
      // way" reading, or an obviously-co-located alternate while the
      // current latch is far away.
      const upgrade = pickTrainToLatch({
        user: sample,
        trains,
        transitions: transitionsRef.current,
        recentDeparture: recentDepartureRef.current,
      });
      if (upgrade?.source === "correlation") recentDepartureRef.current = null;

      const upgraded =
        upgrade && upgrade.key !== ridingTrainKey && isUpgradeSource(upgrade.source);
      if (upgraded) {
        setRidingTrainKey(upgrade.key);
      } else {
        const alternate = pickStrongerCoLocatedAlternate(
          ridingTrainKey,
          sample,
          trains,
        );
        if (alternate) setRidingTrainKey(alternate.key);
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
