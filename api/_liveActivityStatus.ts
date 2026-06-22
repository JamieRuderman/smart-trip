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

/** How far past the scheduled arrival a run must be — while ALSO absent from the
 *  feed — before the cron treats it as finished and ends the activity. 511 prunes
 *  a run from the feed once it completes, and that pruning is exactly when an
 *  `end` could no longer be matched, so the activity would otherwise sit frozen
 *  at 0:00. A train that's merely late keeps a live destination arrival in the
 *  feed and is matched normally, so it never reaches this fallback early; the
 *  small grace only absorbs a single transient feed gap right at the boundary. */
const ARRIVED_DROP_GRACE_MS = 2 * 60 * 1000;

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
 * Match priority:
 *  1. **Origin start time** — the trip-level `startTime` (== `reg.originStartTime`)
 *     uniquely identifies the run and survives stop-pruning, so it is preferred.
 *     A station-based match alone can lock onto a DIFFERENT run that shares the
 *     boarding station within the window — SMART headways put the next train
 *     well inside the 2h window, which would yield a wildly wrong delay. From
 *     the identified run we take the live boarding departure if that stop is
 *     still present (pre-/at-departure), else the destination's live arrival
 *     (en route, after 511 prunes the boarding stop) — the latter is what keeps
 *     the locked-screen countdown correctable once the train has left.
 *  2. **Boarding stop** — only when the registration carries no origin time:
 *     match the live departure at `fromStation` closest to scheduled, in window.
 *
 * When neither locates the run, it has either not appeared yet or — once its
 * scheduled arrival is past — finished and been pruned from the feed. In the
 * latter case a terminal `ended` status is synthesized from the registration so
 * the cron can dismiss the activity instead of leaving the countdown frozen at
 * 0:00 (see `ARRIVED_DROP_GRACE_MS`); otherwise null (leave the native countdown
 * ticking).
 */
export function computeLiveTripStatus(args: {
  reg: LiveActivityRegistration;
  updates: FeedTripUpdate[];
  now: number;
}): LiveTripStatus | null {
  const { reg, updates, now } = args;
  const matched = matchLiveTripStatus(reg, updates, now);
  if (matched) return matched;
  // Unlocatable AND past the scheduled arrival → the run completed and 511
  // dropped it (a still-running late train would keep a live destination arrival
  // and be matched above). End it so the activity doesn't stick at 0:00.
  if (now >= reg.arrivalEpochMs + ARRIVED_DROP_GRACE_MS) {
    return {
      departureEpochMs: reg.departureEpochMs,
      arrivalEpochMs: reg.arrivalEpochMs,
      delayMinutes: 0,
      isCanceled: false,
      isEnded: true,
    };
  }
  return null;
}

/** Locate `reg`'s run in the feed and derive its live status, or null when it
 *  can't be found. The feed-matching core of `computeLiveTripStatus`, split out
 *  so the public entry can layer the finished-run terminal case on top. */
function matchLiveTripStatus(
  reg: LiveActivityRegistration,
  updates: FeedTripUpdate[],
  now: number,
): LiveTripStatus | null {
  // 1. Precise identity by origin start time.
  if (reg.originStartTime) {
    const match = updates.find(
      (u) => u.startTime?.slice(0, 5) === reg.originStartTime,
    );
    return match ? statusFromTrip(reg, match, now) : null;
  }

  // 2. No origin time on the registration: match by the boarding stop's live
  //    departure, closest to scheduled within a window.
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
  return best ? statusFromBoarding(reg, best.update, best.from, now) : null;
}

/**
 * Derive status from the run already identified by its origin start time:
 *  - boarding stop still present → its live departure gives the precise delay
 *    (the pre-/at-departure case);
 *  - boarding pruned but destination present → the destination's live arrival
 *    gives the corrected arrival + delay (the EN-ROUTE case);
 *  - neither present → only a cancellation is worth a push; a plain scheduled
 *    run with no usable stop yields null (leave the native countdown ticking).
 */
function statusFromTrip(
  reg: LiveActivityRegistration,
  update: FeedTripUpdate,
  now: number,
): LiveTripStatus | null {
  const from = update.stopTimeUpdates.find(
    (s) =>
      s.departureTime != null &&
      resolveStation(s.stopId, reg.fromStation, reg.direction),
  );
  if (from?.departureTime != null) return statusFromBoarding(reg, update, from, now);

  const isCanceled = update.scheduleRelationship === "CANCELED";
  const to = findDestination(reg, update);
  if (to?.arrivalTime != null) {
    const liveArrivalMs = to.arrivalTime * 1000;
    // Arrival lateness ≈ boarding lateness; 511 always reports
    // `departureDelay: 0`, so we diff times, not deltas.
    const delayMs = Math.max(0, liveArrivalMs - reg.arrivalEpochMs);
    return {
      departureEpochMs: reg.departureEpochMs + delayMs,
      arrivalEpochMs: liveArrivalMs,
      delayMinutes: Math.round(delayMs / 60_000),
      isCanceled,
      isEnded: now >= liveArrivalMs,
    };
  }

  // No usable stop to derive from: only a cancellation is still worth a push.
  if (!isCanceled) return null;
  return {
    departureEpochMs: reg.departureEpochMs,
    arrivalEpochMs: reg.arrivalEpochMs,
    delayMinutes: 0,
    isCanceled: true,
    isEnded: now >= reg.arrivalEpochMs,
  };
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
