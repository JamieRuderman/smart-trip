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
  ENGAGE_PROXIMITY_MAX_KM,
  ENGAGE_SPEED_MPS,
  ON_CORRIDOR_KM,
  ON_CORRIDOR_SEARCH_KM,
  PROXIMITY_LAG_BUDGET_S,
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

  // A train missing `direction_id` in the feed (happens intermittently)
  // shouldn't kill the match — treat null as a pass and prefer an explicit
  // same-direction candidate if one exists.
  const compatible = candidates.filter(
    (c) =>
      c.distKm <= ON_CORRIDOR_SEARCH_KM &&
      (c.train.directionId == null || c.train.directionId === userDirId),
  );
  if (compatible.length === 0) return null;
  const sameDir = compatible.find((c) => c.train.directionId === userDirId);
  return (sameDir ?? compatible[0]).train.key;
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
  // Every cold-start tier requires explicit user motion. A null speed
  // (laptop forever, phone briefly at first sample) is not evidence of
  // riding — the boarding-correlation path above is the right answer when
  // boarding is in progress, so here we refuse to guess. Without this
  // gate, a stationary user near the line (e.g. a home within 900 m of
  // the corridor) gets latched onto any passing train.
  const userMoving =
    user.speedMps != null && user.speedMps >= ENGAGE_SPEED_MPS;
  if (!userMoving) return null;

  // When the user's heading is classifiable, restrict every tier to
  // same-direction trains. A train going the opposite way can't be the
  // one the user is riding, so we refuse rather than fall back to the
  // closest as preferSameDirection would. Null `userDirId` (heading
  // missing or near east/west) and null `train.directionId` (some feeds
  // omit `direction_id`) both fall through — direction can't gate a
  // decision when either side is unknown.
  const userDirId =
    user.heading != null ? classifyHeading(user.heading) : null;
  const directionMatches = (c: Candidate) =>
    userDirId == null ||
    c.train.directionId == null ||
    c.train.directionId === userDirId;
  // When the user's direction is known, an explicit same-direction match
  // beats a feed-missing-direction candidate even if the latter is a hair
  // closer — otherwise a null-directionId train would silently outrank a
  // real match. Lists are distance-sorted, so `find` returns the closest
  // of each group.
  const pickBest = (list: Candidate[]): Candidate | null => {
    if (list.length === 0) return null;
    if (userDirId == null) return list[0];
    return list.find((c) => c.train.directionId === userDirId) ?? list[0];
  };

  // Tier 1: co-located. A train is right on top of the (moving) user —
  // strongest cold-start signal short of correlation.
  const colocated = candidates.filter(
    (c) => c.distKm <= ENGAGE_COLOCATION_KM && directionMatches(c),
  );
  const colocatedPick = pickBest(colocated);
  if (colocatedPick) return colocatedPick.train.key;

  // Tier 2: nearby. Radius scales with phone speed because GTFS-RT lag
  // translates to "marker behind the rider" linearly with speed — at 30 m/s
  // (~67 mph) a 60 s feed lag puts the train icon 1.8 km behind the true
  // position. A fixed 0.9 km radius rejects the obvious match on fast
  // trains. Capped so a noisy GPS speed can't latch something miles off.
  const proximityKm = Math.min(
    ENGAGE_PROXIMITY_MAX_KM,
    Math.max(
      ENGAGE_PROXIMITY_KM,
      (user.speedMps ?? 0) * PROXIMITY_LAG_BUDGET_S / 1000,
    ),
  );
  const nearby = candidates.filter(
    (c) => c.distKm <= proximityKm && directionMatches(c),
  );
  const nearbyPick = pickBest(nearby);
  if (nearbyPick) return nearbyPick.train.key;

  // Tier 3: on-corridor — widen to the full search radius for users
  // who are squarely on the rail.
  if (userOnCorridor) {
    const onCorridor = candidates.filter(
      (c) => c.distKm <= ON_CORRIDOR_SEARCH_KM && directionMatches(c),
    );
    const onCorridorPick = pickBest(onCorridor);
    if (onCorridorPick) return onCorridorPick.train.key;
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
