/**
 * Platform-free Live Activity content model + builders, shared by the iOS
 * native bridge (`native/liveActivity.ts`) and the Phase 2 push backend
 * (`api/liveactivity/*`), which builds the SAME content state server-side to
 * push via APNs while the phone is locked.
 *
 * Kept free of any Capacitor/DOM import so Vercel serverless functions can
 * import it. The native bridge re-exports everything here, so existing client
 * imports from `native/liveActivity` keep working unchanged.
 *
 * Design notes:
 *   - The plugin's `attributes` and `contentState` are `Record<string,string>`,
 *     so values are serialized to strings (`encodeAttributes` /
 *     `encodeContentState`) and parsed back in the SwiftUI widget.
 *   - iOS renders `Text(timerInterval:)` as a self-ticking countdown with no
 *     push/app-wake, so the countdown target is an absolute epoch; a push is
 *     only needed when the target/delay/phase actually changes.
 */

/** Static, identity-level attributes — set once at start, never updated. */
export interface TripActivityAttributes {
  tripNumber: number;
  fromStation: string;
  toStation: string;
  /** Display route/line label, e.g. "SMART". */
  routeName: string;
  direction: "northbound" | "southbound";
}

/** Before departure the headline counts down to departure; once departed it
 *  flips to the arrival countdown. */
export type TripActivityPhase = "pre-departure" | "en-route";

/** Dynamic content pushed on every update — drives the SwiftUI views. */
export interface TripActivityContentState {
  phase: TripActivityPhase;
  /** Absolute target for the pre-departure `Text(timerInterval:)` countdown. */
  departureEpochMs: number;
  /** Absolute target for the en-route `Text(timerInterval:)` countdown. */
  arrivalEpochMs: number;
  /** Minutes late at the boarding station; 0 == on time. */
  delayMinutes: number;
  nextStop: string | null;
  remainingStops: number | null;
  /** Humanized status pill, e.g. "On time" | "+4 min" | "Cancelled". */
  statusText: string;
  isEnded: boolean;
  /** ActivityKit staleDate (epoch ms): when the OS should mark the activity
   *  visually stale because JS may not have corrected it (phone locked). */
  staleAfterEpochMs?: number;
}

/** Minimum iOS for ActivityKit Live Activities. */
export const MIN_LIVE_ACTIVITY_IOS_MAJOR = 16;
export const MIN_LIVE_ACTIVITY_IOS_MINOR = 2;

/**
 * Stable, deterministic activity id for a focused trip. The plugin's local
 * `startActivity` requires a caller-supplied id and keys update/end on it, so
 * the same trip must always resolve to the same id (across JS reloads) to reach
 * its running activity. Service-date-scoped so the same trip number on a
 * different day is a distinct activity. Also the join key between the client
 * registration and the iOS-posted push token on the server.
 */
export function tripActivityId(tripNumber: number, serviceDate: string): string {
  return `trip-${tripNumber}-${serviceDate}`;
}

/**
 * Whether this device can run a Live Activity for `targetEpochMs`. Pure so it's
 * unit-testable; the native bridge feeds it the parsed iOS version + the active
 * countdown target. Gates on iOS 16.2+ and a target that's still in the future.
 */
export function canStartActivity(args: {
  platform: string;
  iosMajor: number;
  iosMinor: number;
  targetEpochMs: number;
  now: number;
}): boolean {
  if (args.platform !== "ios") return false;
  if (args.targetEpochMs <= args.now) return false;
  if (args.iosMajor > MIN_LIVE_ACTIVITY_IOS_MAJOR) return true;
  if (args.iosMajor < MIN_LIVE_ACTIVITY_IOS_MAJOR) return false;
  return args.iosMinor >= MIN_LIVE_ACTIVITY_IOS_MINOR;
}

/**
 * Which countdown the headline shows: departure until the train has left, then
 * arrival. Pure; the boundary is the departure instant. Used both to build the
 * content state and to pick the active staleness target.
 */
export function derivePhase(args: {
  departureEpochMs: number;
  now: number;
}): TripActivityPhase {
  return args.now < args.departureEpochMs ? "pre-departure" : "en-route";
}

/**
 * Humanized status pill from the realtime/derived flags. Pure. Precedence:
 * cancelled > ended > delayed > on-time. The on-time copy is phase-aware so the
 * lock screen reads naturally ("Departing"/"Arriving") when not late.
 */
export function deriveStatusText(args: {
  delayMinutes: number | null;
  isCanceled: boolean;
  isEnded: boolean;
  phase: TripActivityPhase;
}): string {
  if (args.isCanceled) return "Cancelled";
  if (args.isEnded) return "Arrived";
  if (args.delayMinutes != null && args.delayMinutes > 0) {
    return `+${args.delayMinutes} min`;
  }
  return args.phase === "pre-departure" ? "On time · departing" : "On time · arriving";
}

/**
 * Build the dynamic content state from the focused trip's instants + realtime
 * status. Pure — the single source of truth for the activity payload, shared by
 * the start, drift-update, and server push paths. `delayMinutes` null is
 * normalized to 0. The staleness target is the ACTIVE countdown's instant
 * (departure pre-board, else arrival), so iOS dims the activity once the
 * countdown it's showing elapses and JS hasn't refreshed it.
 */
export function buildContentState(args: {
  departureEpochMs: number;
  arrivalEpochMs: number;
  delayMinutes: number | null;
  nextStop: string | null;
  remainingStops: number | null;
  isCanceled: boolean;
  isEnded: boolean;
  now: number;
}): TripActivityContentState {
  const phase = derivePhase({ departureEpochMs: args.departureEpochMs, now: args.now });
  const delayMinutes = args.delayMinutes ?? 0;
  return {
    phase,
    departureEpochMs: args.departureEpochMs,
    arrivalEpochMs: args.arrivalEpochMs,
    delayMinutes,
    nextStop: args.nextStop,
    remainingStops: args.remainingStops,
    statusText: deriveStatusText({
      delayMinutes,
      isCanceled: args.isCanceled,
      isEnded: args.isEnded,
      phase,
    }),
    isEnded: args.isEnded,
    staleAfterEpochMs:
      phase === "pre-departure" ? args.departureEpochMs : args.arrivalEpochMs,
  };
}

/**
 * Serialize static attributes into the plugin's `Record<string,string>` shape.
 * The SwiftUI widget reads these keys from the generic attributes dictionary.
 */
export function encodeAttributes(
  a: TripActivityAttributes,
): Record<string, string> {
  return {
    tripNumber: String(a.tripNumber),
    fromStation: a.fromStation,
    toStation: a.toStation,
    routeName: a.routeName,
    direction: a.direction,
  };
}

/**
 * Serialize the dynamic content state into the plugin's `Record<string,string>`
 * shape. Numbers → decimal strings, booleans → "true"/"false", null → "" (the
 * widget treats empty as absent). Keep keys in sync with the SwiftUI views and
 * the APNs `content-state` the server sends.
 */
export function encodeContentState(
  c: TripActivityContentState,
): Record<string, string> {
  return {
    phase: c.phase,
    departureEpochMs: String(c.departureEpochMs),
    arrivalEpochMs: String(c.arrivalEpochMs),
    delayMinutes: String(c.delayMinutes),
    nextStop: c.nextStop ?? "",
    remainingStops: c.remainingStops == null ? "" : String(c.remainingStops),
    statusText: c.statusText,
    isEnded: String(c.isEnded),
    ...(c.staleAfterEpochMs != null
      ? { staleAfterEpochMs: String(c.staleAfterEpochMs) }
      : {}),
  };
}
