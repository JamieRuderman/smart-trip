import type { Station } from "@/types/smartSchedule";

export interface FocusedTripReminder {
  leadMinutes: number;
  /** Epoch ms the notification fires. */
  reminderAt: number;
  title: string;
  body: string;
}

export interface FocusedTrip {
  /** How the trip became focused. Only "user" is produced today; "riding" is
   *  reserved for the deferred riding-detector integration. */
  source: "user";
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  /** Live-aware epoch ms of departure from fromStation. */
  departureAt: number;
  /** Live-aware epoch ms of arrival at toStation — drives auto-clear. */
  arrivalAt: number;
  /** null = focused with no reminder armed. */
  reminder: FocusedTripReminder | null;
}

export const FOCUSED_TRIP_STORAGE_KEY = "smart-train-focused-trip";
export const FOCUSED_TRIP_CHANGED_EVENT = "smart-train-focused-trip-changed";

function isFocusedTrip(value: unknown): value is FocusedTrip {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const reminderOk =
    r.reminder === null ||
    (typeof r.reminder === "object" &&
      r.reminder !== null &&
      typeof (r.reminder as Record<string, unknown>).leadMinutes === "number" &&
      typeof (r.reminder as Record<string, unknown>).reminderAt === "number" &&
      typeof (r.reminder as Record<string, unknown>).title === "string" &&
      typeof (r.reminder as Record<string, unknown>).body === "string");
  return (
    r.source === "user" &&
    typeof r.tripNumber === "number" &&
    typeof r.fromStation === "string" &&
    typeof r.toStation === "string" &&
    (r.scheduleType === "weekday" || r.scheduleType === "weekend") &&
    typeof r.departureAt === "number" &&
    Number.isFinite(r.departureAt) &&
    typeof r.arrivalAt === "number" &&
    Number.isFinite(r.arrivalAt) &&
    reminderOk
  );
}

/** Read the focused trip, dropping (and clearing) it once its arrival passes. */
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
    if (parsed.arrivalAt <= Date.now()) {
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

const LEGACY_REMINDER_KEY = "smart-train-departure-reminders";

/**
 * One-time migration from the old per-trip reminder array to the single
 * focused trip. Promotes the still-future reminder with the latest departure,
 * preserving its reminder; deletes the legacy key unconditionally. We can't
 * recover the original arrival time from a legacy reminder, so arrivalAt is
 * seeded to departureAt — the focus then clears at departure for migrated
 * records, which is acceptable for a one-shot upgrade path. scheduleType is
 * inferred from the departure date's day-of-week.
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

  const focused: FocusedTrip = {
    source: "user",
    tripNumber: r.tripNumber as number,
    fromStation: r.fromStation as Station,
    toStation: r.toStation as Station,
    scheduleType,
    departureAt,
    arrivalAt: departureAt,
    reminder: {
      leadMinutes: r.leadMinutes as number,
      reminderAt: r.reminderAt as number,
      title: r.title as string,
      body: r.body as string,
    },
  };
  saveFocusedTrip(focused);
  return focused;
}
