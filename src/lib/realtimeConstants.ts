/**
 * Shared realtime-display threshold, kept in one place so the schedule list,
 * Mapbox map, line diagram, and station sheet all agree on what counts as
 * "delayed".
 *
 * There is a SINGLE threshold: a train is "delayed" as soon as it is at least
 * this many whole minutes late. The whole-minute lateness itself is produced by
 * `delayMinutesFromSeconds` (see `tripDelay.ts`), which already treats a slip
 * under MIN_DELAY_SECONDS as on-time — so a reported delay is always >= this
 * threshold and every surface flips to the delayed treatment at the same point.
 */

/** Minimum whole minutes late before a train is treated as delayed, everywhere.
 *  Keep in lockstep with MIN_DELAY_SECONDS (tripDelay.ts). */
export const DELAY_MINUTES_THRESHOLD = 2;

/** Whether a train should render in the "delayed" state on any surface (schedule
 *  list, map, line diagram, station sheet). Canceled trains are never "delayed"
 *  (they have their own state); a null delay means no realtime, also not
 *  delayed. Single source of truth for the previously copy-pasted check. */
export function isTrainDelayed(train: {
  isCanceled: boolean;
  delayMinutes: number | null;
}): boolean {
  return (
    !train.isCanceled &&
    train.delayMinutes != null &&
    train.delayMinutes >= DELAY_MINUTES_THRESHOLD
  );
}
