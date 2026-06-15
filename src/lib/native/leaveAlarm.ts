import { Capacitor, registerPlugin } from "@capacitor/core";
import { logger } from "../logger";

/**
 * Thin, mockable wrapper around the app's LOCAL `LeaveAlarm` Capacitor plugin
 * for the "Leave Alarm" feature. A true alarm is used on both native platforms:
 * iOS via Apple AlarmKit (ios/App/App/LeaveAlarm/, iOS 26+) and Android via
 * AlarmManager.setAlarmClock + a full-screen alarm activity
 * (android/.../LeaveAlarm*). Web has no alarm and stays on the local-
 * notification path.
 *
 * The local plugin replaced `@capgo/capacitor-alarm`, whose JS API could only
 * target the NEXT occurrence of an hour/minute — so any reminder more than
 * ~24h out (e.g. a weekend trip focused midweek) silently fell back to a
 * notification. Scheduling is now date-based (any future instant), and the
 * alert carries the app's own presentation: brand tint, a stop button, and a
 * "View trip" secondary button that opens the app.
 *
 * The alarm breaks through Silent Mode / Focus / Do Not Disturb, instead of a
 * notification that's easy to miss. Keeping the plugin API behind this module
 * means the focused-trip scheduler and its unit tests depend on our stable
 * surface, and any native-side drift is isolated here.
 */

export type AlarmAuthStatus = "authorized" | "denied" | "unavailable";

/** The local plugin's surface (see ios/App/App/LeaveAlarm/LeaveAlarmPlugin.swift).
 *  Exported for tests. */
export interface LeaveAlarmNativePlugin {
  isAvailable(): Promise<{ value: boolean }>;
  checkAuthorization(): Promise<{ status: string }>;
  requestAuthorization(): Promise<{ status: string }>;
  schedule(options: {
    /** Absolute fire instant, epoch ms — any future date. */
    fireAtMs: number;
    /** Alert title (already localized by the caller). */
    title: string;
    stopButtonTitle?: string;
    /** When set, adds a secondary button that opens the app. */
    openButtonTitle?: string;
  }): Promise<{ id: string }>;
  cancel(options: { id: string }): Promise<void>;
}

const LeaveAlarm = registerPlugin<LeaveAlarmNativePlugin>("LeaveAlarm");

/** Platforms with a native LeaveAlarm implementation: iOS (AlarmKit) and
 *  Android (AlarmManager.setAlarmClock + full-screen alarm). Web has none. */
function alarmCapablePlatform(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android";
}

/** Whether a real alarm can be scheduled here (iOS AlarmKit or Android
 *  setAlarmClock). */
export async function isAlarmAvailable(): Promise<boolean> {
  if (!alarmCapablePlatform()) return false;
  try {
    const { value } = await LeaveAlarm.isAvailable();
    return value === true;
  } catch (error) {
    logger.warn("LeaveAlarm.isAvailable failed", error);
    return false;
  }
}

function toAuthStatus(status: string): AlarmAuthStatus {
  if (status === "authorized") return "authorized";
  if (status === "unavailable") return "unavailable";
  // "denied", "notDetermined", or anything unrecognized: not authorized yet —
  // callers follow up with requestAlarmAuth, which prompts when undetermined.
  return "denied";
}

/** Current AlarmKit authorization without prompting. */
export async function checkAlarmAuth(): Promise<AlarmAuthStatus> {
  if (!alarmCapablePlatform()) return "unavailable";
  try {
    const { status } = await LeaveAlarm.checkAuthorization();
    return toAuthStatus(status);
  } catch (error) {
    logger.warn("LeaveAlarm.checkAuthorization failed", error);
    return "denied";
  }
}

/** Prompt for AlarmKit authorization (no re-prompt if already decided). */
export async function requestAlarmAuth(): Promise<AlarmAuthStatus> {
  if (!alarmCapablePlatform()) return "unavailable";
  try {
    const { status } = await LeaveAlarm.requestAuthorization();
    return toAuthStatus(status);
  } catch (error) {
    logger.warn("LeaveAlarm.requestAuthorization failed", error);
    return "denied";
  }
}

export type ReminderChannel = "alarm" | "notification";

/**
 * Decide whether a reminder should fire as a true "Leave Alarm" or as the
 * local-notification fallback. We use an alarm on iOS (AlarmKit) and Android
 * (setAlarmClock) when it's available and the user has authorized it — every
 * other case (web, unavailable, denied) falls back to a notification. Pure so
 * it can be unit tested without touching Capacitor or the DOM.
 */
export function decideReminderChannel(args: {
  platform: string;
  alarmAvailable: boolean;
  alarmStatus: AlarmAuthStatus;
}): ReminderChannel {
  if (args.platform !== "ios" && args.platform !== "android") return "notification";
  if (!args.alarmAvailable) return "notification";
  if (args.alarmStatus !== "authorized") return "notification";
  return "alarm";
}

/** Localized labels for the alarm alert's buttons. Optional end to end — the
 *  native side falls back to sensible defaults when omitted. */
export interface LeaveAlarmButtonText {
  stop?: string;
  viewTrip?: string;
}

/**
 * Create a one-time alarm at `fireAt` (epoch ms — ANY future date, not just the
 * next occurrence of its clock time), or return `{ scheduled: false }` when an
 * alarm can't/shouldn't be used (web, unavailable, unauthorized, or the
 * schedule call failed).
 *
 * Does NOT cancel any previous alarm — the caller retires the prior channel
 * only after a new one is confirmed scheduled, so a failed (re)schedule never
 * leaves the user with no reminder.
 */
export async function scheduleLeaveAlarm(opts: {
  label: string;
  fireAt: number;
  buttons?: LeaveAlarmButtonText;
}): Promise<{ scheduled: boolean; alarmId?: string }> {
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

  try {
    const { id } = await LeaveAlarm.schedule({
      fireAtMs: opts.fireAt,
      title: opts.label,
      stopButtonTitle: opts.buttons?.stop,
      openButtonTitle: opts.buttons?.viewTrip,
    });
    if (!id) {
      logger.warn("LeaveAlarm.schedule did not return an id");
      return { scheduled: false };
    }
    return { scheduled: true, alarmId: id };
  } catch (error) {
    logger.warn("LeaveAlarm.schedule failed", error);
    return { scheduled: false };
  }
}

/** Cancel a previously scheduled leave alarm by id. Best-effort; logs on failure. */
export async function cancelLeaveAlarm(id: string): Promise<void> {
  try {
    await LeaveAlarm.cancel({ id });
  } catch (error) {
    logger.warn("LeaveAlarm.cancel failed", error);
  }
}
