/**
 * Detect whether the user is currently riding a train.
 *
 * Returns the matching train's `key` (matches `MapTrain.key`) when the user's
 * GPS plausibly indicates they're on a SMART train. Engagement is evaluated
 * in three tiers, from most to least direct:
 *   - Co-location (≤ ENGAGE_COLOCATION_KM): engage regardless of motion. At
 *     this distance the user is effectively in the vehicle, so a station
 *     stop where neither side reports speed shouldn't block the latch.
 *   - Proximity + movement (≤ ENGAGE_DISTANCE_KM, user OR train moving):
 *     short-radius fallback for cases where GTFS-RT lag has the train
 *     marker close but not co-located. Mobile Safari often returns null
 *     for `coords.speed`, so the train's own GTFS-RT speed corroborates
 *     when the device hasn't reported a velocity.
 *   - On-corridor + moving (≤ ON_TRACK_KM perpendicular to the rail line,
 *     user moving): the phone is sitting on the SMART line and moving fast
 *     enough to be on a train. Engage the nearest same-direction train
 *     (or the nearest train overall when heading is unknown). Wide
 *     candidate radius here — GTFS-RT vehicle positions can lag several
 *     km between updates, especially right after a station departure.
 *     Accepts a stray false positive from a parallel-road car going the
 *     same way; the latch will release once distance exceeds
 *     RELEASE_DISTANCE_KM.
 *
 * Release: drop the latch only when the user has walked off the rail
 * corridor (they got off) OR has been near-stationary for several ticks
 * while the train kept moving. We deliberately do NOT release on raw
 * distance to the latched train — GTFS-RT vehicle positions can lag the
 * rider by multiple kilometers between updates, and that lag is not the
 * same as the rider getting off. A station stop (both stationary, still
 * co-located) does NOT count as stationary ticks either, otherwise the
 * latch would drop every time the train spent more than ~3 s at a platform.
 */

import { useEffect, useRef, useState } from "react";
import type { MapTrain } from "@/hooks/useMapTrains";
import { haversineKm } from "@/lib/stationUtils";
import stations, { STATION_COORDINATES } from "@/data/stations";

interface UseUserRidingArgs {
  userLat: number | null;
  userLng: number | null;
  userSpeedMps: number | null;
  /** Direction of travel in degrees (0 = N, 90 = E, …). Often null when the
   *  device isn't moving or hasn't seen enough position deltas yet. */
  userHeading: number | null;
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

/** Maximum perpendicular distance from the user's GPS to the SMART rail
 *  corridor for "on the track" to be true. 0.2 km absorbs typical phone
 *  GPS error while still excluding parallel arterials in most stretches. */
const ON_TRACK_KM = 0.2;

/** Looser corridor threshold for releasing a latch — once the user is this
 *  far from the rail line, they've clearly gotten off. Hysteresis: > ON_TRACK_KM
 *  so a brief GPS jitter past the engage threshold doesn't release. */
const OFF_CORRIDOR_KM = 0.5;

/** Sanity upper bound on distance between user and latched train. Even with
 *  GTFS-RT lag, > this means we latched the wrong train (or the rider
 *  switched). Wider than ON_TRACK_ENGAGE_KM so a fresh tier-3 latch isn't
 *  immediately dropped before the next vehicle update arrives. */
const MAX_LATCHED_DISTANCE_KM = 8.0;

/** Distance to the candidate train under the on-corridor tier. Wider than
 *  ENGAGE_DISTANCE_KM because GTFS-RT vehicle positions can lag the train
 *  by multi-km between updates, especially after a station departure. */
const ON_TRACK_ENGAGE_KM = 5.0;

/** Speed below which the user-stationary counter increments. */
const STATIONARY_SPEED_MPS = 1;

/** Number of consecutive sub-stationary ticks before releasing the latch. */
const STATIONARY_TICKS_TO_RELEASE = 3;

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_KM) / 180;

/** Perpendicular distance (km) from a point to the SMART corridor,
 *  approximated as the polyline through the station list. The corridor is
 *  ~110 km of stations and we only iterate inter-station segments, so this
 *  is cheap to call once per tick. */
function distanceToCorridorKm(lat: number, lng: number): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const kxKm = cosLat * KM_PER_DEG_LAT;
  const kyKm = KM_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = STATION_COORDINATES[stations[i]];
    const b = STATION_COORDINATES[stations[i + 1]];
    // Local Cartesian with origin at the user; segment endpoints in km.
    const ax = (a.lng - lng) * kxKm;
    const ay = (a.lat - lat) * kyKm;
    const bx = (b.lng - lng) * kxKm;
    const by = (b.lat - lat) * kyKm;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    }
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < best) best = d;
  }
  return best;
}

/** Classify a heading (0-360°) as the train direction the user is travelling
 *  in. Returns 1 (north) or 0 (south) to match GTFS-RT directionId, or null
 *  for east/west headings (shouldn't happen on the corridor but keeps us
 *  honest). Wider window (±60°) than a strict ±45° so curves don't toggle. */
function classifyHeading(heading: number): 0 | 1 | null {
  const h = ((heading % 360) + 360) % 360;
  if (h <= 60 || h >= 300) return 1;
  if (h >= 120 && h <= 240) return 0;
  return null;
}

function nearestSameDirectionTrain(
  userLat: number,
  userLng: number,
  userHeading: number | null,
  trains: MapTrain[],
): { train: MapTrain; distKm: number } | null {
  if (userHeading == null) return null;
  const userDirId = classifyHeading(userHeading);
  if (userDirId == null) return null;
  let best: { train: MapTrain; distKm: number } | null = null;
  for (const t of trains) {
    if (t.directionId !== userDirId) continue;
    if (!Number.isFinite(t.latitude) || !Number.isFinite(t.longitude)) continue;
    const d = haversineKm(userLat, userLng, t.latitude, t.longitude);
    if (!best || d < best.distKm) best = { train: t, distKm: d };
  }
  return best;
}

export function useUserRiding({
  userLat,
  userLng,
  userSpeedMps,
  userHeading,
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

      const userMoving =
        userSpeedMps != null && userSpeedMps >= ENGAGE_SPEED_MPS;

      // Tier 2: nearby and moving. Mobile Safari often returns null for
      // `coords.speed`; treat the train's own GTFS-RT speed as corroborating
      // evidence so we don't refuse to engage just because the device didn't
      // report a velocity.
      const trainMoving =
        nearest.train.speed != null &&
        nearest.train.speed >= ENGAGE_SPEED_MPS;
      const hasMovementSignal =
        userMoving || (userSpeedMps == null && trainMoving);
      if (nearest.distKm <= ENGAGE_DISTANCE_KM && hasMovementSignal) {
        setRidingTrainKey(nearest.train.key);
        stationaryTicksRef.current = 0;
        return;
      }

      // Tier 3: phone is on the rail corridor and moving. Engages on a
      // wider radius — GTFS-RT vehicle positions can lag a moving train by
      // multiple km between updates, so the closest train marker can sit
      // well behind where the user actually is. Prefer a same-direction
      // candidate when we have a heading; fall back to the overall nearest
      // when we don't.
      if (userMoving && distanceToCorridorKm(userLat, userLng) <= ON_TRACK_KM) {
        const directional = nearestSameDirectionTrain(
          userLat,
          userLng,
          userHeading,
          trains,
        );
        const candidate = directional ?? nearest;
        if (candidate.distKm <= ON_TRACK_ENGAGE_KM) {
          setRidingTrainKey(candidate.train.key);
          stationaryTicksRef.current = 0;
        }
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

    // Release if the user has clearly walked off the rail corridor — they
    // got off the train. We deliberately do NOT release on raw distance to
    // the latched train (it can lag multi-km behind the rider), only on a
    // wide sanity bound and on off-corridor walking.
    if (distanceToCorridorKm(userLat, userLng) > OFF_CORRIDOR_KM) {
      setRidingTrainKey(null);
      stationaryTicksRef.current = 0;
      return;
    }
    if (latchedDistKm > MAX_LATCHED_DISTANCE_KM) {
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
  }, [userLat, userLng, userSpeedMps, userHeading, trains, ridingTrainKey]);

  return { ridingTrainKey };
}
