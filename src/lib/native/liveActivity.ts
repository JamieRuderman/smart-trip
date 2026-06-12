/**
 * iOS Live Activity wrapper for the focused-trip countdown (lock screen +
 * Dynamic Island). Mirrors the shape of `leaveAlarm.ts`: platform/version
 * guards, small PURE decision helpers (unit-tested without Capacitor), and a
 * graceful no-op fallback so callers never have to special-case non-iOS.
 *
 * Design notes that shaped the API:
 *   - The plugin's `attributes` and `contentState` are `Record<string,string>`,
 *     so every value is serialized to a string here (`encodeAttributes` /
 *     `encodeContentState`) and parsed back in the SwiftUI widget.
 *   - The plugin's local `startActivity` returns void and takes a
 *     CALLER-supplied `id`; update/end reference that same id. So we choose a
 *     stable id per focused trip (see `tripActivityId`) and persist it as
 *     `FocusedTrip.liveActivityId` — analogous to `reminder.alarmId`.
 *   - iOS renders `Text(timerInterval:)` as a self-ticking countdown with no
 *     push/app-wake, so the countdown target is an absolute epoch; JS only
 *     pushes a new content state when the target/delay/phase actually changes.
 */
import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { LiveActivity } from "capacitor-live-activity";
import { logger } from "../logger";

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
 * different day is a distinct activity.
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
 * the start and drift-update paths. `delayMinutes` null is normalized to 0. The
 * staleness target is the ACTIVE countdown's instant (departure pre-board, else
 * arrival), so iOS dims the activity once the countdown it's showing elapses and
 * JS hasn't refreshed it.
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
 * widget treats empty as absent). Keep keys in sync with the SwiftUI views.
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

// ─── NATIVE BRIDGE ──────────────────────────────────────────────────────────
// Thin pass-throughs around the helpers above. Every entry returns its no-op
// shape (never throws) on non-iOS, when Live Activities are disabled/too old, or
// on plugin error — exactly like leaveAlarm.ts.

/** Parse "16.2"/"17.4.1" → {major, minor}; 0s on garbage so the gate fails closed. */
function parseIosVersion(osVersion: string): { major: number; minor: number } {
  const [major, minor] = osVersion.split(".").map((n) => parseInt(n, 10));
  return {
    major: Number.isFinite(major) ? major : 0,
    minor: Number.isFinite(minor) ? minor : 0,
  };
}

/** The countdown the activity currently shows — used as the start/version gate
 *  target (must be in the future to be worth starting). */
function activeTarget(content: TripActivityContentState): number {
  return content.phase === "pre-departure"
    ? content.departureEpochMs
    : content.arrivalEpochMs;
}

/** Whether Live Activities are enabled & permitted right now (iOS 16.2+, toggle
 *  on). Reflects the plugin's native `areActivitiesEnabled`. */
export async function isLiveActivityAvailable(): Promise<boolean> {
  if (Capacitor.getPlatform() !== "ios") return false;
  try {
    const { value } = await LiveActivity.isAvailable();
    return value === true;
  } catch (error) {
    logger.warn("LiveActivity.isAvailable failed", error);
    return false;
  }
}

/**
 * Start the focused-trip Live Activity under the caller-supplied logical `id`
 * (persist it as `FocusedTrip.liveActivityId`). No-ops to `{ started: false }`
 * on non-iOS, iOS < 16.2, an already-past target, Live Activities disabled, or a
 * plugin error. Uses the LOCAL `startActivity` in Phase 1; Phase 2 swaps to
 * `startActivityWithPush` to obtain the per-activity APNs token.
 */
export async function startTripActivity(
  id: string,
  attributes: TripActivityAttributes,
  content: TripActivityContentState,
): Promise<{ started: boolean }> {
  if (Capacitor.getPlatform() !== "ios") return { started: false };
  let iosMajor = 0;
  let iosMinor = 0;
  try {
    const info = await Device.getInfo();
    ({ major: iosMajor, minor: iosMinor } = parseIosVersion(info.osVersion));
  } catch (error) {
    logger.warn("Device.getInfo failed", error);
    return { started: false };
  }
  if (
    !canStartActivity({
      platform: "ios",
      iosMajor,
      iosMinor,
      targetEpochMs: activeTarget(content),
      now: Date.now(),
    })
  ) {
    return { started: false };
  }
  try {
    const { value } = await LiveActivity.isAvailable();
    if (!value) return { started: false };
    await LiveActivity.startActivity({
      id,
      attributes: encodeAttributes(attributes),
      contentState: encodeContentState(content),
    });
    return { started: true };
  } catch (error) {
    logger.warn("LiveActivity.startActivity failed", error);
    return { started: false };
  }
}

/** Push a new content state to the running activity (drift correction / phase
 *  flip). No-op `{ updated: false }` on non-iOS or plugin error. */
export async function updateTripActivity(
  id: string,
  content: TripActivityContentState,
): Promise<{ updated: boolean }> {
  if (Capacitor.getPlatform() !== "ios") return { updated: false };
  try {
    await LiveActivity.updateActivity({
      id,
      contentState: encodeContentState(content),
    });
    return { updated: true };
  } catch (error) {
    logger.warn("LiveActivity.updateActivity failed", error);
    return { updated: false };
  }
}

/** End the activity (on clear / arrival / focus replace). Best-effort; dismisses
 *  immediately. Optionally renders a final state first. */
export async function endTripActivity(
  id: string,
  finalContent?: TripActivityContentState,
): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  try {
    await LiveActivity.endActivity({
      id,
      contentState: finalContent ? encodeContentState(finalContent) : {},
      dismissalPolicy: "immediate",
    });
  } catch (error) {
    logger.warn("LiveActivity.endActivity failed", error);
  }
}

/** Logical ids of activities the OS still knows about — for boot reconciliation
 *  (end any orphan whose trip no longer matches the focus). `[]` off-iOS/error. */
export async function listTripActivities(): Promise<string[]> {
  if (Capacitor.getPlatform() !== "ios") return [];
  try {
    const { items } = await LiveActivity.listActivities();
    return items.map((i) => i.id);
  } catch (error) {
    logger.warn("LiveActivity.listActivities failed", error);
    return [];
  }
}
