/**
 * Minutes after the live arrival time before a trip is considered "ended"
 * and the detail sheet switches to the grey ended state. Kept short so a
 * just-finished trip greys out promptly — a through train departs the rider's
 * stop within a minute or two of arriving. (On iOS a focused trip's pinned
 * card is auto-cleared right at arrival by LiveActivitySync; this threshold
 * mainly governs browsing a non-focused past trip's sheet.)
 */
export const TRIP_ENDED_THRESHOLD_MIN = 2;
