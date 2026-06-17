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
  /** Explicit cancellation flag — the widget keys its visual treatment (red
   *  pill, no countdown) on this, never on parsing `statusText`. */
  isCanceled: boolean;
  isEnded: boolean;
  /** Whether a leave reminder is armed for this trip — drives the bell icon. */
  reminderSet: boolean;
  /** Absolute fire instant (epoch ms) of the armed leave alarm, when one is set.
   *  The target the pre-alarm countdown ticks down to on the compact island,
   *  expanded island, and lock screen. Absent when no reminder is armed. */
  reminderEpochMs?: number;
  /** Precomputed gate: a reminder is armed AND hasn't fired yet, so the surfaces
   *  lead with a bell + "Alarm in" countdown before flipping to the train +
   *  "Departs in" countdown. Mirrors `phase`'s precompute discipline — the
   *  widget keys its icon/label on this flag, never on its own clock. */
  alarmPending: boolean;
  /** ActivityKit staleDate (epoch ms): when the OS should mark the activity
   *  visually stale because JS may not have corrected it (phone locked). */
  staleAfterEpochMs?: number;
}

/** Minimum iOS for ActivityKit Live Activities. */
export const MIN_LIVE_ACTIVITY_IOS_MAJOR = 16;
export const MIN_LIVE_ACTIVITY_IOS_MINOR = 2;

/** How long before departure the Live Activity becomes eligible to show. A
 *  focused trip further out than this stays dormant (no hours-long lock-screen
 *  clutter) until it enters the window — unless a reminder is armed or it's
 *  already en route. */
export const LIVE_ACTIVITY_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Random base36 slug for activity ids. `crypto.getRandomValues` exists in
 *  every WKWebView/browser/Node we run in; Math.random is a non-security
 *  fallback only for exotic embeds. */
function randomSlug(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  // Structural type, not `Crypto`: this module is also compiled under the
  // DOM-less api tsconfig.
  const globalCrypto = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (globalCrypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    globalCrypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Activity id for a focused trip: trip/service-date scoped for debuggability,
 * plus a random slug so the id is NOT guessable. The id doubles as the join
 * key between the client registration and the iOS-posted push token on the
 * server, where the register/deregister endpoints are necessarily public — an
 * unguessable id is the capability that stops a third party from overwriting
 * or deregistering someone else's activity. Reaching the running activity
 * across JS reloads relies on the id being PERSISTED (`FocusedTrip.
 * liveActivityId`), not recomputed, so the randomness costs nothing.
 */
export function tripActivityId(tripNumber: number, serviceDate: string): string {
  return `trip-${tripNumber}-${serviceDate}-${randomSlug()}`;
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
 * Whether the focused trip's Live Activity should currently be on screen. Pure
 * + testable. Shows it within `LIVE_ACTIVITY_WINDOW_MS` of departure, whenever a
 * reminder is armed (a strong "I'm tracking this" signal that overrides the
 * window), or once it's en route ("riding"). Stops once arrival has passed.
 * Orthogonal to the iOS/version gate (`canStartActivity`): this is the WHETHER,
 * that is the CAN.
 */
export function shouldShowLiveActivity(args: {
  hasReminder: boolean;
  departureEpochMs: number;
  arrivalEpochMs: number;
  now: number;
}): boolean {
  if (args.now >= args.arrivalEpochMs) return false;
  if (args.hasReminder) return true;
  if (args.now >= args.departureEpochMs) return true;
  return args.departureEpochMs - args.now <= LIVE_ACTIVITY_WINDOW_MS;
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
 * cancelled > ended > delayed > on-time. The widget's colour theme (blue /
 * orange / red) keys off these same flags, never off parsing this text.
 */
export function deriveStatusText(args: {
  delayMinutes: number | null;
  isCanceled: boolean;
  isEnded: boolean;
}): string {
  if (args.isCanceled) return "Cancelled";
  if (args.isEnded) return "Arrived";
  if (args.delayMinutes != null && args.delayMinutes > 0) return "Delayed";
  return "On time";
}

/**
 * Build the dynamic content state from the focused trip's instants + realtime
 * status. Pure — the single source of truth for the activity payload, shared by
 * the start, drift-update, and server push paths. `delayMinutes` null is
 * normalized to 0. The staleness target is the ACTIVE countdown's instant (the
 * armed alarm while it's still pending, else departure pre-board, else arrival),
 * so iOS dims the activity once the countdown it's showing elapses and JS hasn't
 * refreshed it.
 */
export function buildContentState(args: {
  departureEpochMs: number;
  arrivalEpochMs: number;
  delayMinutes: number | null;
  nextStop: string | null;
  remainingStops: number | null;
  isCanceled: boolean;
  isEnded: boolean;
  reminderSet?: boolean;
  /** Absolute fire instant of the armed leave alarm (epoch ms), if any. */
  reminderEpochMs?: number | null;
  now: number;
}): TripActivityContentState {
  const phase = derivePhase({ departureEpochMs: args.departureEpochMs, now: args.now });
  const delayMinutes = args.delayMinutes ?? 0;
  const reminderSet = args.reminderSet ?? false;
  const reminderEpochMs = args.reminderEpochMs ?? null;
  // Lead with the alarm countdown only while the alarm is both armed and still
  // ahead of us — once it fires (or there's no reminder) the surfaces fall
  // through to the departure / arrival countdown.
  const alarmPending =
    reminderSet && reminderEpochMs != null && args.now < reminderEpochMs;
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
    }),
    isCanceled: args.isCanceled,
    isEnded: args.isEnded,
    reminderSet,
    ...(reminderEpochMs != null ? { reminderEpochMs } : {}),
    alarmPending,
    staleAfterEpochMs: alarmPending
      ? reminderEpochMs!
      : phase === "pre-departure"
        ? args.departureEpochMs
        : args.arrivalEpochMs,
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
    isCanceled: String(c.isCanceled),
    isEnded: String(c.isEnded),
    reminderSet: String(c.reminderSet),
    alarmPending: String(c.alarmPending),
    ...(c.reminderEpochMs != null
      ? { reminderEpochMs: String(c.reminderEpochMs) }
      : {}),
    ...(c.staleAfterEpochMs != null
      ? { staleAfterEpochMs: String(c.staleAfterEpochMs) }
      : {}),
  };
}
