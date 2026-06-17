/**
 * iOS Live Activity NATIVE BRIDGE for the focused-trip countdown (lock screen +
 * Dynamic Island). Mirrors the shape of `leaveAlarm.ts`: platform/version
 * guards and a graceful no-op fallback so callers never special-case non-iOS.
 *
 * The platform-free content model + builders live in `../liveActivityContent`
 * (so the Phase 2 push backend can import them too) and are re-exported here, so
 * existing imports from this module keep working unchanged.
 */
import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { LiveActivity } from "capacitor-live-activity";
import { logger } from "../logger";
import {
  canStartActivity,
  encodeAttributes,
  encodeContentState,
  type TripActivityAttributes,
  type TripActivityContentState,
} from "../liveActivityContent";

export * from "../liveActivityContent";
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

/**
 * Phase 2: start the activity with APNs push support, returning the system
 * `activityId`. Identical gating to `startTripActivity`, but uses the plugin's
 * `startActivityWithPush` so iOS emits a per-activity update token (delivered to
 * the token endpoint configured via `setLiveActivityTokenEndpoint`). The backend
 * then corrects the countdown while the phone is locked. No-op `{started:false}`
 * off-iOS / <16.2 / disabled / error.
 */
export async function startTripActivityWithPush(
  id: string,
  attributes: TripActivityAttributes,
  content: TripActivityContentState,
): Promise<{ started: boolean; activityId?: string }> {
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
    const { activityId } = await LiveActivity.startActivityWithPush({
      id,
      attributes: encodeAttributes(attributes),
      contentState: encodeContentState(content),
    });
    return { started: true, activityId };
  } catch (error) {
    logger.warn("LiveActivity.startActivityWithPush failed", error);
    return { started: false };
  }
}

/**
 * Configure the native endpoint iOS POSTs per-activity update tokens to
 * (`{ id, activityId, token }`). Persisted natively across launches, so the
 * backend keeps receiving fresh tokens even when the WebView isn't running.
 * Best-effort; no-op off-iOS / on error.
 */
export async function setLiveActivityTokenEndpoint(url: string): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  try {
    await LiveActivity.setUpdateTokenEndpoint({ url });
  } catch (error) {
    logger.warn("LiveActivity.setUpdateTokenEndpoint failed", error);
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

/**
 * End the activity (on clear / arrival / focus replace). Best-effort; optionally
 * renders a final state first.
 *
 * By default dismisses IMMEDIATELY. When `dismissAtEpochMs` is a future instant,
 * the activity is instead scheduled to auto-dismiss THEN (ActivityKit
 * `.after(date)`): it stays on the lock screen / Dynamic Island — its
 * `Text(timerInterval:)` countdown keeps ticking — and iOS removes it at that
 * date even if the app never runs again. This is how the local (non-push)
 * focused-trip activity self-clears after arrival while the phone is locked,
 * since the JS that would otherwise call this never wakes in the background.
 * `dismissalDate` is UNIX *seconds* (the plugin feeds it to
 * `Date(timeIntervalSince1970:)`). A past/now `dismissAtEpochMs` falls back to
 * immediate.
 */
export async function endTripActivity(
  id: string,
  finalContent?: TripActivityContentState,
  dismissAtEpochMs?: number,
): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  const contentState = finalContent ? encodeContentState(finalContent) : {};
  try {
    if (dismissAtEpochMs != null && dismissAtEpochMs > Date.now()) {
      await LiveActivity.endActivity({
        id,
        contentState,
        dismissalPolicy: "after",
        dismissalDate: Math.floor(dismissAtEpochMs / 1000),
      });
      return;
    }
    await LiveActivity.endActivity({
      id,
      contentState,
      dismissalPolicy: "immediate",
    });
  } catch (error) {
    logger.warn("LiveActivity.endActivity failed", error);
  }
}

/** A known activity and its ActivityKit lifecycle state ("active" | "stale" |
 *  "pending" | "ended" | "dismissed"). */
export interface TripActivityRecord {
  id: string;
  state: string;
}

/** Known activities (with lifecycle state) the OS still tracks — for boot /
 *  foreground reconciliation: end orphans, and tell an `ended` activity (one we
 *  scheduled to auto-dismiss after arrival) apart from a live one. `[]`
 *  off-iOS/error. */
export async function listTripActivityRecords(): Promise<TripActivityRecord[]> {
  if (Capacitor.getPlatform() !== "ios") return [];
  try {
    const { items } = await LiveActivity.listActivities();
    return items.map((i) => ({ id: i.id, state: i.state }));
  } catch (error) {
    logger.warn("LiveActivity.listActivities failed", error);
    return [];
  }
}
