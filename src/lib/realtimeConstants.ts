/**
 * Shared realtime-display thresholds, kept in one place so the Mapbox map,
 * line diagram, and station sheet all agree on what counts as "delayed".
 */

/** Minimum minutes late to flip a train from on-time → delayed. */
export const DELAY_MINUTES_THRESHOLD = 3;
