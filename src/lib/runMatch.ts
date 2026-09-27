/**
 * Which GTFS-RT entry is a given scheduled run. Shared by the app's realtime
 * hooks and the Live Activity push backend, so the in-app status and the lock
 * screen always pick the same train. Pure; no app imports (the Worker bundles it).
 */

/** What identifies a scheduled run, from the static timetable. */
export interface RunKey {
  /** GTFS `trip_id`. */
  tripId?: string;
  /** Origin departure, "HH:MM". */
  originStartTime?: string;
  /** Service day, "YYYYMMDD". */
  serviceDay?: string;
  /** 0 = southbound, 1 = northbound. */
  directionId?: number;
}

/** The run a feed entry reports: a trip update, or a vehicle's `trip`. */
export interface FeedRun {
  tripId?: string;
  /** Origin departure, "HH:MM:SS". */
  startTime?: string;
  startDate?: string;
  directionId?: number;
}

/** Whether two optional fields don't contradict. 511 sends "" for an omitted string. */
function agrees(a: string | number | undefined, b: string | number | undefined): boolean {
  return a == null || a === "" || b == null || b === "" || a === b;
}

export function isRunById(feed: FeedRun, run: RunKey): boolean {
  return !!run.tripId && feed.tripId === run.tripId && agrees(feed.startDate, run.serviceDay);
}

export function isRunByOriginTime(feed: FeedRun, run: RunKey): boolean {
  return (
    !!run.originStartTime &&
    feed.startTime?.slice(0, 5) === run.originStartTime &&
    agrees(feed.startDate, run.serviceDay) &&
    agrees(feed.directionId, run.directionId)
  );
}

/**
 * The entry for `run`: by trip id first, then by origin time. 511's static and
 * realtime origin times can drift apart while the ids stay put, and an
 * opposite-direction run can share the origin minute. A stale static id still
 * falls back to the origin time.
 */
export function findRun<T>(
  entries: readonly T[],
  run: RunKey,
  runOf: (entry: T) => FeedRun | undefined,
): T | undefined {
  const byId = entries.find((e) => {
    const feed = runOf(e);
    return feed != null && isRunById(feed, run);
  });
  if (byId !== undefined) return byId;
  return entries.find((e) => {
    const feed = runOf(e);
    return feed != null && isRunByOriginTime(feed, run);
  });
}
