import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { logger } from "./logger";

/** A single OS/browser notification to fire at an absolute time. */
export interface ScheduledNotification {
  id: number;
  title: string;
  body: string;
  /** Epoch ms when the notification should fire. */
  at: number;
}

/** Whether reminders can fire in the current environment (native always; web
 *  needs the Notification API, absent on iOS Chrome/Firefox and non-PWA Safari). */
export function isReminderSupported(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === "undefined") return false;
  return "Notification" in window;
}

/** iOS web-browser detection — used to decide whether to surface an App Store
 *  CTA when reminders aren't supported. Excludes Capacitor native iOS. */
export function isIOSWebBrowser(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod|iPad/i.test(navigator.userAgent);
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await LocalNotifications.checkPermissions();
      if (status.display === "granted") return true;
      const req = await LocalNotifications.requestPermissions();
      return req.display === "granted";
    } catch (error) {
      logger.warn("Failed to check/request native notification permission", error);
      return false;
    }
  }
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch (error) {
    logger.warn("Failed to request web notification permission", error);
    return false;
  }
}

const WEB_NOTIFICATION_ICON = "/apple-touch-icon.png";

/** In-flight web setTimeout handles, keyed by notification id. */
const webTimers = new Map<number, number>();

function fireWebNotification(n: ScheduledNotification): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(n.title, {
      body: n.body,
      tag: `smart-trip-reminder-${n.id}`,
      icon: WEB_NOTIFICATION_ICON,
      badge: WEB_NOTIFICATION_ICON,
    });
  } catch (error) {
    logger.warn("Failed to fire web notification", error);
  }
}

/**
 * Arm a web timer that fires the notification at `n.at`. `onFired` runs after
 * firing so the caller can clean up its own storage. If the time has already
 * passed, fires immediately.
 */
export function armWebTimer(
  n: ScheduledNotification,
  onFired: () => void,
): void {
  const existing = webTimers.get(n.id);
  if (existing != null) window.clearTimeout(existing);
  const run = () => {
    webTimers.delete(n.id);
    fireWebNotification(n);
    onFired();
  };
  const delay = n.at - Date.now();
  if (delay <= 0) {
    run();
    return;
  }
  webTimers.set(n.id, window.setTimeout(run, delay));
}

function clearWebTimer(id: number): void {
  const handle = webTimers.get(id);
  if (handle != null) {
    window.clearTimeout(handle);
    webTimers.delete(id);
  }
}

/**
 * Schedule a notification on the current platform. On web this arms a timer
 * (and `onFired` is invoked after it fires). Throws if the native scheduler
 * refuses (revoked permission, exact-alarm denied) so callers can surface it.
 */
export async function scheduleNotification(
  n: ScheduledNotification,
  onFired: () => void,
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: n.id,
          title: n.title,
          body: n.body,
          // allowWhileIdle lets the alarm fire through Android Doze and wake the
          // device. Without it — and without exact-alarm permission, which we
          // don't request — the plugin falls back to a non-wakeup inexact alarm
          // (AlarmManager.set + RTC) that Doze defers to the next maintenance
          // window, so a reminder set for an early hour with the phone idle
          // silently never fires. No-op on iOS (reminders use AlarmKit there).
          schedule: { at: new Date(n.at), allowWhileIdle: true },
        },
      ],
    });
    return;
  }
  armWebTimer(n, onFired);
}

export async function cancelNotification(id: number): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.cancel({ notifications: [{ id }] });
    } catch (error) {
      logger.warn("Failed to cancel native notification", error);
    }
    return;
  }
  clearWebTimer(id);
}
