import type { Station } from "@/types/smartSchedule";
import { Capacitor } from "@capacitor/core";
import { getFilteredTrips, type ProcessedTrip } from "@/lib/scheduleUtils";
import { armWebTimer } from "@/lib/notificationScheduler";
import { reminderIdFor } from "@/lib/notificationId";

export interface FocusedTripReminder {
  leadMinutes: number;
  /** Epoch ms the notification fires (snapshot; rescheduled on observed drift). */
  reminderAt: number;
  /** Stable id used to schedule + cancel the notification. */
  notificationId: number;
  title: string;
  body: string;
}

export interface FocusedTrip {
  source: "user";
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  /** "YYYY-MM-DD" — the run's service day. The only stored temporal anchor;
   *  departure/arrival are derived from static schedule + this date. */
  serviceDate: string;
  reminder: FocusedTripReminder | null;
}

export const FOCUSED_TRIP_STORAGE_KEY = "smart-train-focused-trip";
export const FOCUSED_TRIP_CHANGED_EVENT = "smart-train-focused-trip-changed";

const SERVICE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isFocusedTrip(value: unknown): value is FocusedTrip {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const reminderOk =
    r.reminder === null ||
    (typeof r.reminder === "object" &&
      r.reminder !== null &&
      typeof (r.reminder as Record<string, unknown>).leadMinutes === "number" &&
      typeof (r.reminder as Record<string, unknown>).reminderAt === "number" &&
      typeof (r.reminder as Record<string, unknown>).notificationId === "number" &&
      typeof (r.reminder as Record<string, unknown>).title === "string" &&
      typeof (r.reminder as Record<string, unknown>).body === "string");
  return (
    r.source === "user" &&
    typeof r.tripNumber === "number" &&
    typeof r.fromStation === "string" &&
    typeof r.toStation === "string" &&
    (r.scheduleType === "weekday" || r.scheduleType === "weekend") &&
    typeof r.serviceDate === "string" &&
    SERVICE_DATE_RE.test(r.serviceDate as string) &&
    reminderOk
  );
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.replace(/[*~]/g, "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Resolve a focused trip's static arrival to an absolute instant on its
 * service date. Overnight trips (arrival clock-time before departure) roll to
 * the next calendar day.
 */
function arrivalInstant(focused: FocusedTrip, trip: ProcessedTrip): number {
  const [y, mo, d] = focused.serviceDate.split("-").map(Number);
  const depMin = hhmmToMinutes(trip.departureTime);
  const arrMin = hhmmToMinutes(trip.arrivalTime);
  const dayOffset = arrMin < depMin ? 1 : 0;
  return new Date(y, mo - 1, d + dayOffset, Math.floor(arrMin / 60), arrMin % 60, 0, 0).getTime();
}

/**
 * Rebuild the full ProcessedTrip for a focused trip from static schedule data,
 * so the pinned card can render regardless of the home screen's current
 * from/to. Null if the trip no longer exists in that schedule.
 */
export function reconstructFocusedTrip(focused: FocusedTrip): ProcessedTrip | null {
  const trips = getFilteredTrips(
    focused.fromStation,
    focused.toStation,
    focused.scheduleType,
  );
  return trips.find((t) => t.trip === focused.tripNumber) ?? null;
}

/**
 * Resolve the focused trip's departure (at its fromStation) to an absolute
 * instant on its service date. Lets the reminder control compute a fire time
 * for the user's actual boarding station regardless of which leg/view the
 * control is rendered in (e.g. the line map's full-corridor view). Null if the
 * trip can't be reconstructed.
 */
export function focusedDepartureInstant(focused: FocusedTrip): number | null {
  const trip = reconstructFocusedTrip(focused);
  if (!trip) return null;
  const [y, mo, d] = focused.serviceDate.split("-").map(Number);
  const min = hhmmToMinutes(trip.departureTime);
  return new Date(y, mo - 1, d, Math.floor(min / 60), min % 60, 0, 0).getTime();
}

/**
 * Read the focused trip, clearing it once its (static) arrival on the service
 * date has passed, or when the trip can no longer be found in the schedule
 * (timetable changed under a stale focus).
 */
export function loadFocusedTrip(): FocusedTrip | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(FOCUSED_TRIP_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isFocusedTrip(parsed)) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return null;
    }
    const trip = reconstructFocusedTrip(parsed);
    if (!trip) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return null;
    }
    if (arrivalInstant(parsed, trip) <= Date.now()) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveFocusedTrip(trip: FocusedTrip | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (trip === null) {
      localStorage.removeItem(FOCUSED_TRIP_STORAGE_KEY);
      return;
    }
    localStorage.setItem(FOCUSED_TRIP_STORAGE_KEY, JSON.stringify(trip));
  } catch {
    // localStorage unavailable — no-op
  }
}

function toServiceDate(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const LEGACY_REMINDER_KEY = "smart-train-departure-reminders";

/**
 * One-time migration from the old per-trip reminder array to the single
 * focused trip. Promotes the still-future reminder with the latest departure,
 * deriving serviceDate from its departure epoch; deletes the legacy key.
 */
export function migrateLegacyReminders(): FocusedTrip | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LEGACY_REMINDER_KEY);
  if (!raw) return null;
  localStorage.removeItem(LEGACY_REMINDER_KEY);
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;

  const now = Date.now();
  const future = list.filter(
    (r): r is Record<string, unknown> =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as Record<string, unknown>).departureAt === "number" &&
      ((r as Record<string, unknown>).departureAt as number) > now,
  );
  if (future.length === 0) return null;

  future.sort((a, b) => (b.departureAt as number) - (a.departureAt as number));
  const r = future[0];
  const departureAt = r.departureAt as number;
  const day = new Date(departureAt).getDay();
  const scheduleType: "weekday" | "weekend" =
    day === 0 || day === 6 ? "weekend" : "weekday";
  const tripNumber = r.tripNumber as number;
  const serviceDate = toServiceDate(departureAt);

  const focused: FocusedTrip = {
    source: "user",
    tripNumber,
    fromStation: r.fromStation as Station,
    toStation: r.toStation as Station,
    scheduleType,
    serviceDate,
    reminder: {
      leadMinutes: r.leadMinutes as number,
      reminderAt: r.reminderAt as number,
      notificationId: reminderIdFor(tripNumber, serviceDate),
      title: r.title as string,
      body: r.body as string,
    },
  };
  saveFocusedTrip(focused);
  return focused;
}

let booted = false;

/**
 * One-time boot: migrate legacy reminders, then re-arm the web timer for a
 * surviving reminder (no-op on native — the OS owns scheduled notifications).
 */
export function bootFocusedTrip(): void {
  if (booted) return;
  booted = true;
  migrateLegacyReminders();
  if (Capacitor.isNativePlatform()) return;
  const focused = loadFocusedTrip();
  if (!focused?.reminder) return;
  armWebTimer(
    {
      id: focused.reminder.notificationId,
      title: focused.reminder.title,
      body: focused.reminder.body,
      at: focused.reminder.reminderAt,
    },
    () => {
      const after = loadFocusedTrip();
      if (after) saveFocusedTrip({ ...after, reminder: null });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
      }
    },
  );
}
