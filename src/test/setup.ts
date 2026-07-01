/**
 * Vitest global setup. Pins the timezone to the agency's zone so the many
 * local-time Date computations (schedule day keys, midnight rollover, "is this
 * trip in the past", live-time anchoring) are deterministic across machines and
 * CI. Without this, tests that build `new Date(y, m, d, h, m)` and read it back
 * with `getHours()`/`getDay()` silently depend on the runner's timezone.
 *
 * SMART runs in America/Los_Angeles; pinning here matches production behavior
 * for the in-region rider and makes overnight/boundary assertions meaningful.
 */
process.env.TZ = "America/Los_Angeles";
