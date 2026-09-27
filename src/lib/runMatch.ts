/** Which GTFS-RT entry is a given scheduled run, shared by the app and the push
 *  backend so both pick the same train. No app imports: the Worker bundles it. */

/** What identifies a scheduled run, from the static timetable. */
export interface RunKey {
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

function isRunById(feed: FeedRun, run: RunKey): boolean {
  return !!run.tripId && feed.tripId === run.tripId && agrees(feed.startDate, run.serviceDay);
}

function isRunByOriginTime(feed: FeedRun, run: RunKey): boolean {
  return (
    !!run.originStartTime &&
    feed.startTime?.slice(0, 5) === run.originStartTime &&
    agrees(feed.startDate, run.serviceDay) &&
    agrees(feed.directionId, run.directionId)
  );
}

/** The entry for `run`: by trip id (511's origin times drift while ids hold; a DUPLICATED
 *  run's vehicle keeps the id, so one that also matches the origin wins), then origin time. */
export function findRun<T>(
  entries: readonly T[],
  run: RunKey,
  runOf: (entry: T) => FeedRun | undefined,
): T | undefined {
  const find = (isRun: (feed: FeedRun, run: RunKey) => boolean) =>
    entries.find((e) => {
      const feed = runOf(e);
      return feed != null && isRun(feed, run);
    });
  return (
    find((feed, key) => isRunById(feed, key) && isRunByOriginTime(feed, key)) ??
    find(isRunById) ??
    find(isRunByOriginTime)
  );
}

/** The vehicle running `run`. One without a stop is skipped: it can't place the train. */
export function findVehicleRun<V extends { stopId?: string; trip?: FeedRun }>(
  vehicles: readonly V[],
  run: RunKey,
): V | undefined {
  return findRun(vehicles, run, (v) => (v.stopId ? v.trip : undefined));
}
