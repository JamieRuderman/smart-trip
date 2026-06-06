import { Capacitor } from "@capacitor/core";
import { CapgoAlarm } from "@capgo/capacitor-alarm";
import { logger } from "../logger";

/**
 * Thin, mockable wrapper around `@capgo/capacitor-alarm` for the "Leave Alarm"
 * feature. We deliberately scope true alarms to **iOS only** (Apple AlarmKit,
 * iOS 26+). On Android the plugin merely hands off to the system Clock app via
 * an AlarmClock intent — it can't be cancelled programmatically and pops the
 * clock UI — so it doesn't fit our auto-scheduled, per-trip, cancellable model.
 * Android (and web) therefore stay on the existing local-notification path.
 *
 * AlarmKit makes the leave reminder break through Silent Mode / Focus, instead
 * of a notification that's easy to miss. Keeping the vendor API behind this
 * module means the focused-trip scheduler and its unit tests depend on our
 * stable surface, and any upstream naming drift is isolated here.
 */

export type AlarmAuthStatus = "authorized" | "denied" | "unavailable";

/** Whether a real AlarmKit alarm can be scheduled on this device. iOS-only. */
export async function isAlarmAvailable(): Promise<boolean> {
  if (Capacitor.getPlatform() !== "ios") return false;
  try {
    const info = await CapgoAlarm.getOSInfo();
    return info.supportsNativeAlarms === true;
  } catch (error) {
    logger.warn("CapgoAlarm.getOSInfo failed", error);
    return false;
  }
}

/** Current AlarmKit authorization without prompting. */
export async function checkAlarmAuth(): Promise<AlarmAuthStatus> {
  if (Capacitor.getPlatform() !== "ios") return "unavailable";
  try {
    const result = await CapgoAlarm.checkPermissions();
    return result.granted ? "authorized" : "denied";
  } catch (error) {
    logger.warn("CapgoAlarm.checkPermissions failed", error);
    return "denied";
  }
}

/** Prompt for AlarmKit authorization (granted or not — no tri-state). */
export async function requestAlarmAuth(): Promise<AlarmAuthStatus> {
  if (Capacitor.getPlatform() !== "ios") return "unavailable";
  try {
    const result = await CapgoAlarm.requestPermissions();
    return result.granted ? "authorized" : "denied";
  } catch (error) {
    logger.warn("CapgoAlarm.requestPermissions failed", error);
    return "denied";
  }
}

export type ReminderChannel = "alarm" | "notification";

/**
 * Decide whether a reminder should fire as a true AlarmKit "Leave Alarm" or as
 * the local-notification fallback. We only use an alarm on iOS, when AlarmKit
 * is available and the user has authorized it — every other case (Android, web,
 * unavailable, denied) falls back to a notification. Pure so it can be unit
 * tested without touching Capacitor or the DOM.
 */
export function decideReminderChannel(args: {
  platform: string;
  alarmAvailable: boolean;
  alarmStatus: AlarmAuthStatus;
}): ReminderChannel {
  if (args.platform !== "ios") return "notification";
  if (!args.alarmAvailable) return "notification";
  if (args.alarmStatus !== "authorized") return "notification";
  return "alarm";
}

/**
 * Whether a time-of-day alarm for `fireAt` will land on the intended instant.
 *
 * `@capgo/capacitor-alarm`'s `createAlarm` takes only an hour/minute and fires
 * at the NEXT occurrence of that clock time — it cannot target a specific
 * calendar date. So it's only safe to use for a `fireAt` that is itself the
 * next occurrence of its own HH:MM (i.e. later today, or tomorrow when that
 * time has already passed today). For anything further out — e.g. a weekend
 * train focused on a weekday, or a "tomorrow" departure whose HH:MM recurs
 * earlier today — the next occurrence would fire on the wrong (earlier) day, so
 * the caller must fall back to the dated local notification instead.
 *
 * Pure; exported for unit testing.
 */
export function alarmFiresOnIntendedDay(fireAt: number, now: number): boolean {
  const target = new Date(fireAt);
  const next = new Date(now);
  next.setHours(target.getHours(), target.getMinutes(), 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  // fireAt is minute-aligned; allow sub-minute slack for safety.
  return Math.abs(next.getTime() - fireAt) < 60_000;
}

/**
 * Create a one-time AlarmKit alarm at `fireAt` (epoch ms), or return
 * `{ scheduled: false }` when an alarm can't/shouldn't be used (non-iOS,
 * unavailable, unauthorized, the create call failed, or `fireAt` isn't the next
 * occurrence of its clock time — see `alarmFiresOnIntendedDay`).
 *
 * Does NOT cancel any previous alarm — the caller retires the prior channel
 * only after a new one is confirmed scheduled, so a failed (re)schedule never
 * leaves the user with no reminder.
 */
export async function scheduleLeaveAlarm(opts: {
  label: string;
  fireAt: number;
}): Promise<{ scheduled: boolean; alarmId?: string }> {
  // Date-safety first (cheap + pure): bail before any plugin/permission calls
  // when a time-of-day alarm would fire on the wrong day.
  if (!alarmFiresOnIntendedDay(opts.fireAt, Date.now())) return { scheduled: false };

  const platform = Capacitor.getPlatform();
  const alarmAvailable = await isAlarmAvailable();
  let alarmStatus: AlarmAuthStatus = "unavailable";
  if (alarmAvailable) {
    alarmStatus = await checkAlarmAuth();
    if (alarmStatus !== "authorized") alarmStatus = await requestAlarmAuth();
  }
  if (decideReminderChannel({ platform, alarmAvailable, alarmStatus }) !== "alarm") {
    return { scheduled: false };
  }

  const fireDate = new Date(opts.fireAt);
  try {
    const result = await CapgoAlarm.createAlarm({
      hour: fireDate.getHours(),
      minute: fireDate.getMinutes(),
      label: opts.label,
    });
    if (!result.success || !result.id) {
      logger.warn("CapgoAlarm.createAlarm did not return an id", result.message);
      return { scheduled: false };
    }
    return { scheduled: true, alarmId: result.id };
  } catch (error) {
    logger.warn("CapgoAlarm.createAlarm failed", error);
    return { scheduled: false };
  }
}

/** Cancel a previously scheduled leave alarm by id. Best-effort; logs on failure. */
export async function cancelLeaveAlarm(id: string): Promise<void> {
  try {
    await CapgoAlarm.cancelAlarm({ id });
  } catch (error) {
    logger.warn("CapgoAlarm.cancelAlarm failed", error);
  }
}
