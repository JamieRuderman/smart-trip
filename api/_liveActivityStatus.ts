import { GTFS_STOP_ID_TO_PLATFORM } from "../src/data/generated/stationPlatforms.generated.js";
import type { LiveActivityRegistration } from "../src/lib/liveActivityPushTypes.js";

/**
 * Pure derivation of a registered trip's LIVE departure/arrival/delay from the
 * normalized GTFS-RT trip-updates JSON (the shape `/api/gtfsrt/tripupdates`
 * returns). Server-side analog of the client's `useTripRealtimeStatusMap`, but
 * scoped to a single registration so the push cron can correct one activity's
 * countdown while the phone is locked. No DOM/React deps; unit-tested.
 *
 * Matching: 511 shifts `departure.time` forward for delays and always reports
 * `departureDelay: 0`, so the scheduled time isn't recoverable from the feed.
 * We instead match the stop_time_update that resolves (by `stop_id` + the
 * registration's direction) to the boarding station and whose live departure is
 * closest to the registration's scheduled departure instant within a window —
 * robust given SMART headways far exceed realistic delays.
 */

/** Minimal normalized shapes we consume from the tripupdates endpoint. */
export interface FeedStopTimeUpdate {
  stopId?: string;
  arrivalTime?: number; // unix seconds
  departureTime?: number; // unix seconds
  scheduleRelationship?: string;
}
export interface FeedTripUpdate {
  scheduleRelationship?: string;
  /** Trip's scheduled origin departure, "HH:MM:SS" — the cancellation
   *  fallback's match key (cancelled runs often lose their stop updates). */
  startTime?: string;
  stopTimeUpdates: FeedStopTimeUpdate[];
}

export interface LiveTripStatus {
  /** Live boarding departure instant (epoch ms) — scheduled shifted by delay. */
  departureEpochMs: number;
  /** Live arrival instant at the destination (epoch ms). */
  arrivalEpochMs: number;
  /** Whole minutes late at boarding; 0 when on time/early. */
  delayMinutes: number;
  isCanceled: boolean;
  isEnded: boolean;
}

/** Max distance between a feed departure and the scheduled instant for it to be
 *  considered the same run. Half a typical headway buffer; comfortably larger
 *  than any realistic delay. */
const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

function resolveStation(
  stopId: string | undefined,
  station: string,
  direction: string,
): boolean {
  if (!stopId) return false;
  const platform = GTFS_STOP_ID_TO_PLATFORM[stopId];
  return platform?.station === station && platform?.direction === direction;
}

/**
 * Compute the live status for `reg` from the feed `updates`, or null when the
 * trip can't be located (no live data — the cron leaves the countdown as-is).
 *
 * Two match strategies, tried in order:
 *  1. **Boarding stop** — find the run by its live departure at `fromStation`,
 *     closest to the scheduled departure within a window. Most precise (gives
 *     the live boarding delay), and the right path before/at departure.
 *  2. **Origin start time** — once the train departs your boarding station, 511
 *     prunes that stop from the feed, so (1) can no longer find it. The run is
 *     still in the feed though (its later stops remain), so fall back to
 *     identifying it by the trip-level `startTime` (== `reg.originStartTime`)
 *     and derive the live arrival from the destination stop, which is still
 *     ahead. This is what keeps the EN-ROUTE countdown correctable while locked.
 */
export function computeLiveTripStatus(args: {
  reg: LiveActivityRegistration;
  updates: FeedTripUpdate[];
  now: number;
}): LiveTripStatus | null {
  const { reg, updates, now } = args;

  let best: { update: FeedTripUpdate; from: FeedStopTimeUpdate; distance: number } | null =
    null;
  for (const update of updates) {
    const from = update.stopTimeUpdates.find(
      (s) =>
        s.departureTime != null &&
        resolveStation(s.stopId, reg.fromStation, reg.direction),
    );
    if (!from || from.departureTime == null) continue;
    const distance = Math.abs(from.departureTime * 1000 - reg.departureEpochMs);
    if (distance > MATCH_WINDOW_MS) continue;
    if (!best || distance < best.distance) best = { update, from, distance };
  }
  if (best) return statusFromBoarding(reg, best.update, best.from, now);

  return matchByOriginStartTime(reg, updates, now);
}

/** Status from a matched boarding stop: live departure gives the delay; the
 *  destination's live arrival is preferred, else scheduled shifted by the
 *  boarding delay (511 leaves arrivalDelay at 0 too). */
function statusFromBoarding(
  reg: LiveActivityRegistration,
  update: FeedTripUpdate,
  from: FeedStopTimeUpdate,
  now: number,
): LiveTripStatus {
  const isCanceled = update.scheduleRelationship === "CANCELED";
  const liveDepartureMs = from.departureTime! * 1000;
  // Only count lateness; an early/on-time live time keeps the scheduled target.
  const delayMs = Math.max(0, liveDepartureMs - reg.departureEpochMs);
  const to = findDestination(reg, update);
  const arrivalEpochMs =
    to?.arrivalTime != null ? to.arrivalTime * 1000 : reg.arrivalEpochMs + delayMs;

  return {
    departureEpochMs: reg.departureEpochMs + delayMs,
    arrivalEpochMs,
    delayMinutes: Math.round(delayMs / 60_000),
    isCanceled,
    isEnded: now >= arrivalEpochMs,
  };
}

/**
 * Identify the run by its scheduled origin start time (the trip-level
 * `startTime` 511 keeps even after a stop is pruned), then derive status:
 *  - if the destination stop is still in the feed, the live arrival gives both
 *    the corrected arrival and the delay (arrival lateness ≈ boarding lateness;
 *    511 always reports `departureDelay: 0`, so we diff times, not deltas);
 *  - otherwise the only thing worth pushing is a CANCELED signal (scheduled
 *    targets stand, no delay derivable) — a plain scheduled run with no usable
 *    stop yields null, so the cron leaves the native countdown ticking.
 * Requires `reg.originStartTime`; absent it, there is no pruning-proof key.
 */
function matchByOriginStartTime(
  reg: LiveActivityRegistration,
  updates: FeedTripUpdate[],
  now: number,
): LiveTripStatus | null {
  if (!reg.originStartTime) return null;
  const match = updates.find(
    (u) => u.startTime?.slice(0, 5) === reg.originStartTime,
  );
  if (!match) return null;
  const isCanceled = match.scheduleRelationship === "CANCELED";

  const to = findDestination(reg, match);
  if (to?.arrivalTime != null) {
    const liveArrivalMs = to.arrivalTime * 1000;
    const delayMs = Math.max(0, liveArrivalMs - reg.arrivalEpochMs);
    return {
      departureEpochMs: reg.departureEpochMs + delayMs,
      arrivalEpochMs: liveArrivalMs,
      delayMinutes: Math.round(delayMs / 60_000),
      isCanceled,
      isEnded: now >= liveArrivalMs,
    };
  }

  // No destination stop to derive from: only a cancellation is still worth a
  // push; a scheduled run with no usable stop leaves the countdown as-is.
  if (!isCanceled) return null;
  return {
    departureEpochMs: reg.departureEpochMs,
    arrivalEpochMs: reg.arrivalEpochMs,
    delayMinutes: 0,
    isCanceled: true,
    isEnded: now >= reg.arrivalEpochMs,
  };
}

/** The destination stop_time_update for this registration (resolves to
 *  `toStation` + direction and carries a live arrival), or undefined. */
function findDestination(
  reg: LiveActivityRegistration,
  update: FeedTripUpdate,
): FeedStopTimeUpdate | undefined {
  return update.stopTimeUpdates.find(
    (s) =>
      s.arrivalTime != null &&
      resolveStation(s.stopId, reg.toStation, reg.direction),
  );
}

export type PushAction = "none" | "update" | "end";

/**
 * Decide whether the cron should push for this activity, given the freshly
 * computed live status and what we last sent. Pure. We push an `end` once the
 * trip has arrived, an `update` when the delay, the departure→arrival phase, or
 * the cancellation changed, and otherwise nothing — the native countdown ticks
 * on its own, so unchanged state needs no push (and APNs throttles updates).
 */
export function decidePushAction(args: {
  status: LiveTripStatus;
  lastSent: {
    delayMinutes: number;
    phase: "pre-departure" | "en-route";
    isEnded: boolean;
    /** Older records (pre-cancellation tracking) may lack this; treated as
     *  "not cancelled" so a cancellation still triggers exactly one update. */
    isCanceled?: boolean;
  } | null;
  now: number;
}): { action: PushAction; phase: "pre-departure" | "en-route" } {
  const phase: "pre-departure" | "en-route" =
    args.now < args.status.departureEpochMs ? "pre-departure" : "en-route";
  if (args.status.isEnded) {
    // Only end once.
    return { action: args.lastSent?.isEnded ? "none" : "end", phase };
  }
  if (
    args.lastSent != null &&
    args.lastSent.delayMinutes === args.status.delayMinutes &&
    args.lastSent.phase === phase &&
    (args.lastSent.isCanceled ?? false) === args.status.isCanceled
  ) {
    return { action: "none", phase };
  }
  return { action: "update", phase };
}
