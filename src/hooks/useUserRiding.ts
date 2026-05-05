/**
 * Detect whether the user is currently riding a SMART train.
 *
 * Returns the matching train's `key` (matches `MapTrain.key`).
 *
 * Detection model (composed from `./userRiding/`):
 *   1. Boarding primer (`boarding.ts`) — the user dwelled at a station
 *      platform long enough to plausibly be boarding.
 *   2. Train transition tracker (`transitions.ts`) — for each train, record
 *      the most recent stopped→moving event and the station it left from.
 *   3. Engagement (`engagement.ts`) — when the user accelerates away from
 *      a primed platform, latch onto the train whose transition correlates
 *      with that station + timestamp. This disambiguates two trains stacked
 *      at one platform. Falls back to same-direction tiered nearest-train
 *      logic for cold-start cases (app opened mid-ride, GPS-flaky boarding).
 *      A correlated latch can also "upgrade" a fallback latch on the next
 *      tick if the freshest GTFS-RT update reveals the right train.
 *   4. Release (`release.ts`) — drop the latch only when the user is clearly
 *      off the corridor, the train vanishes from the feed, or the user is
 *      implausibly far from the latched train. Long platform dwells do NOT
 *      release the latch.
 */

import { useEffect, useRef, useState } from "react";
import type { MapTrain } from "@/hooks/useMapTrains";
import { INITIAL_BOARDING_STATE, updateBoardingState } from "./userRiding/boarding";
import { DEPARTURE_MATCH_WINDOW_MS } from "./userRiding/constants";
import { pickTrainToLatch } from "./userRiding/engagement";
import { shouldReleaseLatch } from "./userRiding/release";
import { updateTransitions } from "./userRiding/transitions";
import type {
  BoardingState,
  DepartureEvent,
  RidingLatch,
  TrainTransitionMap,
  UserSample,
} from "./userRiding/types";

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
  const latchRef = useRef<RidingLatch | null>(null);
  const boardingRef = useRef<BoardingState>(INITIAL_BOARDING_STATE);
  const transitionsRef = useRef<TrainTransitionMap>(new Map());
  const recentDepartureRef = useRef<DepartureEvent | null>(null);

  useEffect(() => {
    if (userLat == null || userLng == null) return;

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

    // Drop a stale departure event so it can't latch a wrong train minutes
    // later — outside the correlation window, the GTFS-RT transition we'd
    // be matching against is no longer the user's actual boarding.
    if (
      recentDepartureRef.current &&
      nowMs - recentDepartureRef.current.atMs > DEPARTURE_MATCH_WINDOW_MS
    ) {
      recentDepartureRef.current = null;
    }

    const latch = latchRef.current;

    if (latch) {
      // Upgrade path: if we latched via cold-start fallback but a fresh
      // GTFS-RT transition now correlates to a different train, swap. This
      // catches the "two trains stacked" case where the closer one was
      // wrong and the right one's transition arrived a tick later.
      if (recentDepartureRef.current) {
        const pick = pickTrainToLatch({
          user: sample,
          trains,
          transitions: transitionsRef.current,
          recentDeparture: recentDepartureRef.current,
        });
        if (pick?.source === "correlation") {
          if (pick.key !== latch.trainKey) {
            latchRef.current = { trainKey: pick.key, sinceMs: nowMs, lastSeenMs: nowMs };
            setRidingTrainKey(pick.key);
          }
          recentDepartureRef.current = null;
        }
      }

      const reason = shouldReleaseLatch({
        latch: latchRef.current!,
        user: sample,
        trains,
        transitions: transitionsRef.current,
      });
      if (reason) {
        latchRef.current = null;
        setRidingTrainKey(null);
      } else {
        latchRef.current!.lastSeenMs = nowMs;
      }
      return;
    }

    const pick = pickTrainToLatch({
      user: sample,
      trains,
      transitions: transitionsRef.current,
      recentDeparture: recentDepartureRef.current,
    });
    if (pick) {
      latchRef.current = { trainKey: pick.key, sinceMs: nowMs, lastSeenMs: nowMs };
      // Consume the departure event only when correlation drove the latch.
      // Keeping it across a fallback latch lets the upgrade path above
      // promote to the right train when correlation arrives.
      if (pick.source === "correlation") recentDepartureRef.current = null;
      setRidingTrainKey(pick.key);
    }
  }, [userLat, userLng, userSpeedMps, userHeading, trains]);

  return { ridingTrainKey };
}
