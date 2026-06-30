/**
 * Phase 2 client glue for push-backed Live Activity accuracy. Registers the
 * focused trip + its APNs token with the backend so the countdown is corrected
 * for delays while the phone is locked (when JS can't run).
 *
 * Gated behind `VITE_LIVE_ACTIVITY_PUSH` and iOS so it's an inert no-op until
 * the widget extension + APNs credentials exist. Mirrors the leaveAlarm ethos:
 * every entry guards platform/flag and never throws to callers.
 */
import { Capacitor } from "@capacitor/core";
import { apiBaseUrl, readOptionalEnvString } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  setLiveActivityTokenEndpoint,
  startTripActivityWithPush,
} from "@/lib/native/liveActivity";
import type {
  TripActivityAttributes,
  TripActivityContentState,
} from "@/lib/liveActivityContent";
import type { LiveActivityRegistration } from "@/lib/liveActivityPushTypes";

const REGISTER_PATH = "/api/liveactivity/register";
const TOKEN_PATH = "/api/liveactivity/token";

/**
 * Whether push-backed updates are enabled for this build. Off by default: it
 * only does anything once the widget extension is shipped and the APNs backend
 * is configured, at which point the native build sets `VITE_LIVE_ACTIVITY_PUSH=1`.
 * Until then the app uses the local-only `startTripActivity` (Phase 1).
 */
export function isLiveActivityPushEnabled(): boolean {
  if (Capacitor.getPlatform() !== "ios") return false;
  return readOptionalEnvString(import.meta.env.VITE_LIVE_ACTIVITY_PUSH) != null;
}

/**
 * Start a push-enabled Live Activity and register it with the backend. Points
 * iOS at the token endpoint (so it POSTs the per-activity token directly, even
 * across launches) and POSTs the trip identity the server needs to re-derive
 * live arrival/delay from GTFS-RT. Returns whether the activity started; a
 * registration network failure is logged but does NOT fail the start (the
 * activity still shows the local countdown, and the boot-time
 * `registerPushActivity` heal retries on the next launch).
 */
export async function startAndRegisterPushActivity(
  registration: LiveActivityRegistration,
  attributes: TripActivityAttributes,
  content: TripActivityContentState,
): Promise<{ started: boolean }> {
  // Configure the token sink BEFORE starting, so the token iOS mints at start
  // has somewhere to go.
  await setLiveActivityTokenEndpoint(`${apiBaseUrl}${TOKEN_PATH}`);
  const { started } = await startTripActivityWithPush(
    registration.id,
    attributes,
    content,
  );
  if (!started) return { started: false };
  await registerPushActivity(registration);
  return { started: true };
}

/**
 * (Re-)POST a registration to the backend. Idempotent upsert keyed on the
 * activity id, so it doubles as the boot-time heal for a start whose original
 * registration POST failed (offline at focus time) — and refreshes the
 * server-side TTLs as a bonus. Best-effort; never throws. Returns whether the
 * POST reached the server, so callers that dedupe re-registrations can avoid
 * caching a failed attempt (and so retry it on the next trigger).
 */
export async function registerPushActivity(
  registration: LiveActivityRegistration,
): Promise<boolean> {
  try {
    await fetch(`${apiBaseUrl}${REGISTER_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registration),
    });
    return true;
  } catch (error) {
    // The activity stays live with a working local countdown; only the locked-
    // screen delay correction is degraded until the next registration attempt.
    logger.warn("Live Activity push registration failed", error);
    return false;
  }
}

/** Tell the backend to stop pushing to this activity (on clear / arrival /
 *  focus replace). Best-effort. */
export async function deregisterPushActivity(id: string): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  try {
    await fetch(`${apiBaseUrl}${REGISTER_PATH}?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    logger.warn("Live Activity push deregistration failed", error);
  }
}
