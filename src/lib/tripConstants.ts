/**
 * Minutes after the live arrival time before a trip is considered "ended"
 * and the detail sheet switches to the grey ended state. Kept short so a
 * just-finished trip greys out promptly — a through train departs the rider's
 * stop within a minute or two of arriving. (On iOS a focused trip's pinned
 * card is auto-cleared right at arrival by LiveActivitySync; this threshold
 * mainly governs browsing a non-focused past trip's sheet.)
 */
export const TRIP_ENDED_THRESHOLD_MIN = 2;

/**
 * Storage backstop: how long past a focused trip's SCHEDULED arrival
 * `loadFocusedTrip` keeps the record before evicting it. Generous on purpose —
 * the prompt, delay-aware clear is done live by FocusedTripAutoClear (live
 * arrival + TRIP_ENDED_THRESHOLD_MIN). This only needs to be long enough to
 * never preempt a delayed run (SMART delays don't approach two hours) while
 * still discarding a genuinely stale focus on a cold boot hours/days later.
 */
export const FOCUS_ARRIVAL_EVICT_GRACE_MIN = 120;
