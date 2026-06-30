/**
 * Single source of truth for turning a raw live-vs-scheduled lateness into a
 * displayed delay. Shared verbatim by the client realtime status
 * (`useTripUpdates`) and the server push backend (`api/_liveActivityStatus`),
 * so the in-app "Delayed" badge and the Live Activity pill are computed by the
 * SAME code and can never disagree (e.g. a 30–59 s feed jitter must read as
 * on-time on both, not "Delayed" on the lock screen while the app says "On
 * time"). Pure — no DOM/React/Capacitor import — so the Cloudflare Worker /
 * Durable Object can import it too.
 */

/** Lateness below this (seconds) is on-time. 511 reports `departureDelay: 0`
 *  even for late trains and its `departure.time` carries sub-minute jitter, so
 *  anything under a minute is treated as on-time on every surface. */
export const MIN_DELAY_SECONDS = 60;

/**
 * Whole-minute lateness from a raw live-minus-scheduled diff in seconds, or
 * `null` when within the on-time threshold (early, on-time, or a sub-minute
 * slip). Rounds to the nearest minute once past the threshold.
 */
export function delayMinutesFromSeconds(delaySeconds: number): number | null {
  return delaySeconds >= MIN_DELAY_SECONDS ? Math.round(delaySeconds / 60) : null;
}
