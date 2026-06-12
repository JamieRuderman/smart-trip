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
 * `platformMap` is injectable for tests; defaults to the generated map.
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
  if (!best) return matchCanceledByStartTime(reg, updates, now);

  const isCanceled = best.update.scheduleRelationship === "CANCELED";
  const liveDepartureMs = best.from.departureTime! * 1000;
  // Only count lateness; an early/on-time live time keeps the scheduled target.
  const delayMs = Math.max(0, liveDepartureMs - reg.departureEpochMs);
  const delayMinutes = Math.round(delayMs / 60_000);
  const departureEpochMs = reg.departureEpochMs + delayMs;

  // Prefer the destination's live arrival; otherwise shift scheduled by the
  // boarding delay (511 leaves arrivalDelay at 0 too).
  const to = best.update.stopTimeUpdates.find(
    (s) =>
      s.arrivalTime != null &&
      resolveStation(s.stopId, reg.toStation, reg.direction),
  );
  const arrivalEpochMs =
    to?.arrivalTime != null ? to.arrivalTime * 1000 : reg.arrivalEpochMs + delayMs;

  return {
    departureEpochMs,
    arrivalEpochMs,
    delayMinutes,
    isCanceled,
    isEnded: now >= arrivalEpochMs,
  };
}

/**
 * Fallback for cancelled runs whose stop_time_updates the feed omitted (511
 * does this — the client keeps an equivalent `canceledByStartTime` map):
 * match a CANCELED update by the trip's scheduled origin start time. Only
 * offered when the registration carries `originStartTime`, and only ever
 * yields a cancelled status — with no stop updates there is no delay to
 * derive, so the scheduled targets stand.
 */
function matchCanceledByStartTime(
  reg: LiveActivityRegistration,
  updates: FeedTripUpdate[],
  now: number,
): LiveTripStatus | null {
  if (!reg.originStartTime) return null;
  const match = updates.find(
    (u) =>
      u.scheduleRelationship === "CANCELED" &&
      u.startTime?.slice(0, 5) === reg.originStartTime,
  );
  if (!match) return null;
  return {
    departureEpochMs: reg.departureEpochMs,
    arrivalEpochMs: reg.arrivalEpochMs,
    delayMinutes: 0,
    isCanceled: true,
    isEnded: now >= reg.arrivalEpochMs,
  };
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
