import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { logger } from "./logger";

export interface DepartureReminder {
  id: number;
  tripNumber: number;
  fromStation: string;
  toStation: string;
  /** Epoch ms of the train's scheduled (or live) departure. */
  departureAt: number;
  /** Epoch ms when the reminder should fire. */
  reminderAt: number;
  /** Minutes before departure the reminder fires (for display). */
  leadMinutes: number;
  /** Localized strings used to fire the web notification — also useful if we
   *  ever surface the reminder in an in-app list. */
  title: string;
  body: string;
}

export interface ReminderText {
  title: string;
  body: string;
}

export const REMINDER_STORAGE_KEY = "smart-train-departure-reminders";
export const REMINDER_CHANGED_EVENT = "smart-train-reminders-changed";

/**
 * Notification IDs must be 32-bit signed integers on both native platforms.
 * We pack (yymmdd << 14) | (tripNumber & 0x3FFF) so two same-numbered trips on
 * different days don't collide.
 */
export function reminderIdFor(tripNumber: number, departureAt: number): number {
  const d = new Date(departureAt);
  const yymmdd =
    (d.getFullYear() % 100) * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return (yymmdd << 14) | (tripNumber & 0x3fff);
}

function isReminder(value: unknown): value is DepartureReminder {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "number" &&
    Number.isFinite(r.id) &&
    typeof r.tripNumber === "number" &&
    typeof r.fromStation === "string" &&
    typeof r.toStation === "string" &&
    typeof r.departureAt === "number" &&
    Number.isFinite(r.departureAt) &&
    typeof r.reminderAt === "number" &&
    Number.isFinite(r.reminderAt) &&
    typeof r.leadMinutes === "number" &&
    typeof r.title === "string" &&
    typeof r.body === "string"
  );
}

function safeLoad(): DepartureReminder[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(REMINDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isReminder);
  } catch {
    return [];
  }
}

function safeSave(list: DepartureReminder[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable — no-op
  }
}

/** Drop any reminders whose fire time is more than a minute in the past. */
function prune(list: DepartureReminder[]): DepartureReminder[] {
  const cutoff = Date.now() - 60_000;
  return list.filter((r) => r.reminderAt > cutoff);
}

/**
 * Returns the current set of reminders, pruning expired ones and persisting
 * the cleanup back to storage. Persistent pruning is what keeps native
 * storage from growing unbounded (native skips rehydrate entirely).
 */
export function listReminders(): DepartureReminder[] {
  const raw = safeLoad();
  const pruned = prune(raw);
  if (pruned.length !== raw.length) safeSave(pruned);
  return pruned;
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

  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch (error) {
    logger.warn("Failed to request web notification permission", error);
    return false;
  }
}

/** Tracks in-flight setTimeout handles on web so we can cancel a reminder. */
const webTimers = new Map<number, number>();

function fireWebNotification(reminder: DepartureReminder): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(reminder.title, {
      body: reminder.body,
      tag: `smart-trip-reminder-${reminder.id}`,
    });
  } catch (error) {
    logger.warn("Failed to fire web notification", error);
  }
}

function armWebTimer(reminder: DepartureReminder): void {
  const existing = webTimers.get(reminder.id);
  if (existing != null) window.clearTimeout(existing);

  const delay = reminder.reminderAt - Date.now();
  if (delay <= 0) {
    fireWebNotification(reminder);
    const remaining = safeLoad().filter((r) => r.id !== reminder.id);
    safeSave(remaining);
    return;
  }
  const handle = window.setTimeout(() => {
    webTimers.delete(reminder.id);
    fireWebNotification(reminder);
    const remaining = safeLoad().filter((r) => r.id !== reminder.id);
    safeSave(remaining);
    window.dispatchEvent(new Event(REMINDER_CHANGED_EVENT));
  }, delay);
  webTimers.set(reminder.id, handle);
}

async function scheduleNative(reminder: DepartureReminder): Promise<void> {
  await LocalNotifications.schedule({
    notifications: [
      {
        id: reminder.id,
        title: reminder.title,
        body: reminder.body,
        schedule: { at: new Date(reminder.reminderAt) },
      },
    ],
  });
}

/**
 * Schedule a reminder. Throws if the underlying platform refuses to schedule
 * (e.g. iOS permission was revoked after the first grant, Android exact-alarm
 * denied) — callers should treat that as "not scheduled" and surface it to
 * the user, since leaving a phantom storage entry would falsely show "active"
 * with no notification ever firing.
 */
export async function scheduleReminder(
  reminder: DepartureReminder
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await scheduleNative(reminder);
  } else {
    armWebTimer(reminder);
  }

  const next = safeLoad().filter((r) => r.id !== reminder.id);
  next.push(reminder);
  safeSave(next);
}

export async function cancelReminder(id: number): Promise<void> {
  const next = safeLoad().filter((r) => r.id !== id);
  safeSave(next);

  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.cancel({ notifications: [{ id }] });
    } catch (error) {
      logger.warn("Failed to cancel native notification", error);
    }
  } else {
    const handle = webTimers.get(id);
    if (handle != null) {
      window.clearTimeout(handle);
      webTimers.delete(id);
    }
  }
}

let rehydrated = false;

/**
 * Re-arm any persisted web reminders after a reload. Safe to call multiple
 * times; runs once per page. No-op on native (the OS owns scheduled
 * notifications across launches).
 */
export function rehydrateWebReminders(): void {
  if (rehydrated) return;
  rehydrated = true;
  if (Capacitor.isNativePlatform()) return;
  // Don't write storage from here — that would race against another tab that
  // just scheduled a new reminder. listReminders() prunes on next read.
  for (const reminder of prune(safeLoad())) {
    armWebTimer(reminder);
  }
}
