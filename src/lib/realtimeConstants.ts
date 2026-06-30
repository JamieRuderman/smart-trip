/**
 * Shared realtime-display thresholds, kept in one place so the schedule list,
 * Mapbox map, line diagram, and station sheet all agree on what counts as
 * "delayed".
 *
 * There are intentionally TWO thresholds, for two different jobs:
 *
 *  - {@link MIN_REPORTED_DELAY_SECONDS} — the floor for *reporting a delay
 *    number* in the schedule list ("2 min late"). Sub-minute differences
 *    between the live feed and the static timetable are rounding noise, so
 *    they're reported as on-time.
 *  - {@link DELAY_MINUTES_THRESHOLD} — the floor for *flipping a surface to the
 *    delayed color* on the at-a-glance views (map dots, line-diagram markers,
 *    station-sheet rows). A higher bar than the list so a barely-late train
 *    doesn't paint every marker red.
 *
 * If these should ever collapse to a single value, change them here — every
 * surface routes through this module (and {@link isTrainDelayed}).
 */

/** Minimum seconds late before the schedule list reports a delay (rounds to a
 *  whole-minute "N min late"); under this counts as on-time. */
export const MIN_REPORTED_DELAY_SECONDS = 60;

/** Minimum minutes late to flip an at-a-glance surface from on-time → delayed. */
export const DELAY_MINUTES_THRESHOLD = 3;

/** Whether a train should render in the "delayed" color on the at-a-glance
 *  surfaces (map, line diagram, station sheet). Canceled trains are never
 *  "delayed" (they have their own state); a null delay means no realtime, also
 *  not delayed. Single source of truth for the previously copy-pasted check. */
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
