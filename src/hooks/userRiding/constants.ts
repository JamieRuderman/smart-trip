/**
 * Thresholds for the riding-detection state machine. All distances in km,
 * speeds in m/s, durations in milliseconds.
 */

/** Radius around a station that counts as "at the platform" for boarding. */
export const PLATFORM_RADIUS_KM = 0.12;

/** Continuous time the user must dwell within PLATFORM_RADIUS_KM of one
 *  station before we treat them as primed for boarding. Short enough to
 *  catch a quick walk-up, long enough to ignore drive-bys. */
export const PLATFORM_DWELL_MS = 10_000;

/** User must accelerate above this for the "departed the platform" event
 *  to fire. Above walking speed, below train cruising speed. */
export const DEPARTURE_SPEED_MPS = 3;

/** Window for matching a user departure event with a train's stopped→moving
 *  transition. ±60 s absorbs the realistic spread between the GTFS-RT
 *  position cadence and the user's GPS smoothing. */
export const DEPARTURE_MATCH_WINDOW_MS = 60_000;

/** A train counts as "stationary" when its GTFS-RT speed is at or below this. */
export const TRAIN_STATIONARY_MPS = 0.5;

/** A train counts as "moving" (post-station) when its speed crosses this. */
export const TRAIN_MOVING_MPS = 2;

/** Radius used to associate a stationary train with the nearest station. */
export const TRAIN_AT_STATION_KM = 0.15;

/** Co-location radius — fallback tier 1. */
export const ENGAGE_COLOCATION_KM = 0.15;

/** Proximity radius for fallback tier 2 (movement signal required). */
export const ENGAGE_PROXIMITY_KM = 0.9;

/** Perpendicular corridor tolerance for fallback tier 3. */
export const ON_CORRIDOR_KM = 0.2;

/** Search radius around the user when picking a corridor candidate. */
export const ON_CORRIDOR_SEARCH_KM = 5.0;

/** General "moving like a train" floor used by all fallback tiers. */
export const ENGAGE_SPEED_MPS = 3;

/** Hysteresis: drop the latch when the user is this far from the corridor.
 *  Wider than ON_CORRIDOR_KM so a brief GPS jitter doesn't release. */
export const RELEASE_OFF_CORRIDOR_KM = 1.6;

/** Drop the latch if the train hasn't been seen in the GTFS-RT feed for
 *  longer than this — likely the trip ended or the vehicle dropped offline. */
export const TRAIN_VANISHED_MS = 120_000;

/** Sanity bound — even with GTFS-RT lag, beyond this we latched the wrong
 *  train. Higher than RELEASE_OFF_CORRIDOR_KM since along-track lag is real. */
export const MAX_LATCHED_DISTANCE_KM = 12.0;
