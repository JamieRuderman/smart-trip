import type { MapTrain } from "@/hooks/useMapTrains";
import {
  corridorDistanceKm,
  snapToRail,
  type RailSnap,
} from "@/lib/railProjection";
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

/** Source-strong upgrades can replace a held latch; "fallback" cannot. */
export function isUpgradeSource(s: LatchSource): boolean {
  return s !== "fallback";
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
 *   2. Track-motion match — phone moving along the rail in a classifiable
 *      direction → closest same-direction train. The user's mental model
 *      of "I'm on a train going this way" beats every other heuristic
 *      when both pieces are present.
 *   3. Cold-start fallback — tiered nearest-train logic for the case
 *      where neither of the above produces a pick (no boarding event,
 *      flaky heading, etc).
 */
export function pickTrainToLatch(args: PickArgs): LatchPick | null {
  const userSnap = snapToRail(args.user.lat, args.user.lng);
  // Cached for the tick: every tier reads it, every candidate distance
  // pairs against it.
  const userOnCorridor =
    distanceToCorridorKm(args.user.lat, args.user.lng, userSnap) <=
    ON_CORRIDOR_KM;
  const candidates = buildCandidates(args.user, args.trains, userSnap);
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

  const motion = trackMotionMatch(candidates, args.user, userOnCorridor);
  if (motion) return { key: motion, source: "motion" };

  const cold = coldStartFallback(candidates, args.user, userOnCorridor);
  return cold ? { key: cold, source: "fallback" } : null;
}

/**
 * Find a same-direction train sitting right on the user while the
 * currently-latched one is far away — corrects an early mis-pick once
 * the truth becomes obvious. Returns null if the latch is still close
 * enough to be plausible (avoids flicker between trains stacked at one
 * station).
 */
const STALE_LATCH_SWAP_KM = 1.0;
export function pickStrongerCoLocatedAlternate(
  latchedKey: string,
  user: UserSample,
  trains: MapTrain[],
): MapTrain | null {
  const latched = trains.find((t) => t.key === latchedKey);
  if (!latched) return null;
  const userSnap = snapToRail(user.lat, user.lng);
  const latchedDist = corridorDistanceKm(
    user.lat,
    user.lng,
    latched.latitude,
    latched.longitude,
    userSnap,
  );
  if (latchedDist < STALE_LATCH_SWAP_KM) return null;

  let best: { train: MapTrain; distKm: number } | null = null;
  for (const train of trains) {
    if (train.key === latchedKey) continue;
    if (!Number.isFinite(train.latitude) || !Number.isFinite(train.longitude)) continue;
    // A different-direction train co-located with us means we're at a
    // station, not riding it. Don't swap.
    if (latched.directionId != null && train.directionId !== latched.directionId) continue;
    const distKm = corridorDistanceKm(
      user.lat,
      user.lng,
      train.latitude,
      train.longitude,
      userSnap,
    );
    if (distKm > ENGAGE_COLOCATION_KM) continue;
    if (best == null || distKm < best.distKm) best = { train, distKm };
  }
  return best?.train ?? null;
}

function trackMotionMatch(
  candidates: Candidate[],
  user: UserSample,
  userOnCorridor: boolean,
): string | null {
  if (!userOnCorridor || user.heading == null) return null;
  const userDirId = classifyHeading(user.heading);
  if (userDirId == null) return null;

  const sameDir = candidates.filter(
    (c) => c.train.directionId === userDirId && c.distKm <= ON_CORRIDOR_SEARCH_KM,
  );
  return sameDir.length > 0 ? sameDir[0].train.key : null;
}

function buildCandidates(
  user: UserSample,
  trains: MapTrain[],
  userSnap: RailSnap | null,
): Candidate[] {
  const out: Candidate[] = [];
  for (const train of trains) {
    if (!Number.isFinite(train.latitude) || !Number.isFinite(train.longitude)) continue;
    // Along-track distance reflects "closeness on the same line": a train
    // two stations away on the curved rail can be closer in haversine
    // than the train you're sitting on whose feed position lags ~30 s
    // behind your phone GPS.
    const distKm = corridorDistanceKm(
      user.lat,
      user.lng,
      train.latitude,
      train.longitude,
      userSnap,
    );
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
  userOnCorridor: boolean,
): string | null {
  const userMoving =
    user.speedMps != null && user.speedMps >= ENGAGE_SPEED_MPS;

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

  // Tier 3: on-corridor + moving — widen to the full search radius.
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
