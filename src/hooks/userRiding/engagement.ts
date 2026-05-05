import type { MapTrain } from "@/hooks/useMapTrains";
import { alongTrackDistanceKm } from "@/lib/railProjection";
import { haversineKm } from "@/lib/stationUtils";
import {
  DEPARTURE_MATCH_WINDOW_MS,
  ENGAGE_COLOCATION_KM,
  ENGAGE_PROXIMITY_KM,
  ENGAGE_SPEED_MPS,
  ON_CORRIDOR_KM,
  ON_CORRIDOR_SEARCH_KM,
} from "./constants";
import { classifyHeading, distanceToCorridorKm } from "./corridor";
import type {
  DepartureEvent,
  TrainTransitionMap,
  UserSample,
} from "./types";

interface Candidate {
  train: MapTrain;
  distKm: number;
}

export type LatchSource = "correlation" | "motion" | "fallback";
export interface LatchPick {
  key: string;
  source: LatchSource;
}

interface PickArgs {
  user: UserSample;
  trains: MapTrain[];
  transitions: TrainTransitionMap;
  recentDeparture: DepartureEvent | null;
}

/**
 * Decide which train (if any) the user is riding.
 *
 * Priority:
 *   1. Departure correlation — when the user just stepped off a platform
 *      while accelerating, latch onto the train whose stopped→moving
 *      transition matches that station + timestamp. Disambiguates two
 *      trains stacked at one platform reliably.
 *   2. Track-motion match — when the phone is moving along the rail
 *      (heading classifies as N or S, and the device is sitting on the
 *      corridor), latch onto the closest same-direction train. The
 *      "I'm on a train going this way" signal beats every other
 *      heuristic when both pieces are present.
 *   3. Cold-start fallback — tiered nearest-train logic for the case
 *      where neither of the above produces a pick (no boarding event,
 *      flaky heading, etc).
 */
export function pickTrainToLatch(args: PickArgs): LatchPick | null {
  const candidates = buildCandidates(args.user, args.trains);
  if (candidates.length === 0) return null;

  if (args.recentDeparture) {
    const correlated = correlateDeparture(
      candidates,
      args.transitions,
      args.recentDeparture,
      args.user,
    );
    if (correlated) return { key: correlated.train.key, source: "correlation" };
  }

  const motion = trackMotionMatch(candidates, args.user);
  if (motion) return { key: motion, source: "motion" };

  const cold = coldStartFallback(candidates, args.user);
  return cold ? { key: cold, source: "fallback" } : null;
}

/**
 * If the phone is moving along the corridor in a classifiable direction,
 * latch onto the closest same-direction train. This is the user's mental
 * model of riding detection: "the train going my way that's right next
 * to me." Returns null if the phone isn't on the corridor or its heading
 * isn't a clean N/S — those cases fall through to the colder tiers.
 */
function trackMotionMatch(
  candidates: Candidate[],
  user: UserSample,
): string | null {
  if (user.heading == null) return null;
  const userDirId = classifyHeading(user.heading);
  if (userDirId == null) return null;
  if (distanceToCorridorKm(user.lat, user.lng) > ON_CORRIDOR_KM) return null;

  const sameDir = candidates.filter(
    (c) => c.train.directionId === userDirId && c.distKm <= ON_CORRIDOR_SEARCH_KM,
  );
  return sameDir.length > 0 ? sameDir[0].train.key : null;
}

function buildCandidates(user: UserSample, trains: MapTrain[]): Candidate[] {
  const out: Candidate[] = [];
  for (const train of trains) {
    if (!Number.isFinite(train.latitude) || !Number.isFinite(train.longitude)) continue;
    // Along-track corridor distance is what "closeness on the same line"
    // actually means: a train two stations away on the curved rail can be
    // closer in haversine than the train you're sitting on whose feed
    // position lags ~30 s behind your phone GPS. Fall back to haversine
    // when either point doesn't snap to the rail.
    const along = alongTrackDistanceKm(
      user.lat,
      user.lng,
      train.latitude,
      train.longitude,
    );
    const distKm =
      along ??
      haversineKm(user.lat, user.lng, train.latitude, train.longitude);
    out.push({ train, distKm });
  }
  out.sort((a, b) => a.distKm - b.distKm);
  return out;
}

function correlateDeparture(
  candidates: Candidate[],
  transitions: TrainTransitionMap,
  departure: DepartureEvent,
  user: UserSample,
): Candidate | null {
  const matches = candidates.filter((c) => {
    const t = transitions.get(c.train.key);
    if (!t || t.lastDepartedFromStation == null || t.lastDepartedAtMs == null) {
      return false;
    }
    if (t.lastDepartedFromStation !== departure.fromStation) return false;
    return Math.abs(t.lastDepartedAtMs - departure.atMs) <= DEPARTURE_MATCH_WINDOW_MS;
  });
  if (matches.length === 0) return null;
  return preferSameDirection(matches, user);
}

function coldStartFallback(
  candidates: Candidate[],
  user: UserSample,
): string | null {
  const userMoving =
    user.speedMps != null && user.speedMps >= ENGAGE_SPEED_MPS;
  const userOnCorridor =
    distanceToCorridorKm(user.lat, user.lng) <= ON_CORRIDOR_KM;

  // Tier 1: co-located. Engage regardless of speed — at this distance the
  // user is effectively in the vehicle, so a station stop where neither
  // side reports speed shouldn't block the latch.
  const colocated = candidates.filter((c) => c.distKm <= ENGAGE_COLOCATION_KM);
  if (colocated.length > 0) {
    return preferSameDirection(colocated, user).train.key;
  }

  // Tier 2: nearby. Sitting on the rails is signal enough — speed often
  // momentarily reads null when returning to the foreground or on Safari.
  // Off-corridor still requires a movement signal so a coffee shop
  // ~500 m from the line doesn't latch a passing train.
  const nearby = candidates.filter((c) => {
    if (c.distKm > ENGAGE_PROXIMITY_KM) return false;
    if (userOnCorridor) return true;
    const trainMoving =
      c.train.speed != null && c.train.speed >= ENGAGE_SPEED_MPS;
    return userMoving || (user.speedMps == null && trainMoving);
  });
  if (nearby.length > 0) {
    return preferSameDirection(nearby, user).train.key;
  }

  // Tier 3: user is on the corridor and moving — pick the nearest
  // same-direction train inside the search radius.
  if (userMoving && userOnCorridor) {
    const onCorridor = candidates.filter((c) => c.distKm <= ON_CORRIDOR_SEARCH_KM);
    if (onCorridor.length > 0) {
      return preferSameDirection(onCorridor, user).train.key;
    }
  }
  return null;
}

/**
 * Among candidates that already passed a tier's threshold, prefer one whose
 * direction matches the user's heading. Falls back to the closest if direction
 * can't be classified or no same-direction candidate exists.
 */
function preferSameDirection(
  list: Candidate[],
  user: UserSample,
): Candidate {
  if (user.heading == null) return list[0];
  const userDirId = classifyHeading(user.heading);
  if (userDirId == null) return list[0];
  const same = list.find((c) => c.train.directionId === userDirId);
  return same ?? list[0];
}
