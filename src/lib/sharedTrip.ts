import type { ScheduleType } from "@/data/trainSchedules";
import type { FocusedRun } from "@/lib/focusedTrip";
import { isFerryLeg, legPlaces, placeStation, validPlace, type Place } from "@/lib/places";
import { getTodayScheduleType, nextServiceDate, type ProcessedTrip } from "@/lib/scheduleUtils";
import {
  AGENCY_TIME_ZONE,
  agencyDateKey,
  agencyWallTimeToEpochSeconds,
  cleanTimeString,
  parseServiceDate,
  parseTimeToMinutes,
} from "@/lib/timeUtils";
import { SITE_URL } from "@/seo/constants";

export const SHARED_TRIP_PATH = "/share/trip";
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS_AHEAD = 14;
const DAY_MS = 86_400_000;

export function isSharedTripPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === SHARED_TRIP_PATH;
}

export interface SharedTrip {
  run: FocusedRun;
  from: Place;
  to: Place;
  departure: string;
  ferryDeparture: string | null;
}

export function sharedTripServiceDate(now: Date, scheduleType: ScheduleType): string {
  return nextServiceDate(parseServiceDate(agencyDateKey(now)), scheduleType);
}

export function sharedTripUrl(
  trip: ProcessedTrip,
  scheduleType: ScheduleType,
  serviceDate: string,
  origin: string = SITE_URL,
): URL {
  const url = new URL(SHARED_TRIP_PATH, origin);
  const ferry = trip.inboundFerry ?? trip.outboundFerry;
  const { from, to } = legPlaces(trip.fromStation, trip.toStation, !!ferry);
  const params = new URLSearchParams({
    train: String(trip.trip),
    date: serviceDate,
    from,
    to,
    type: scheduleType,
    departure: cleanTimeString(trip.departureTime),
  });
  if (ferry) params.set("ferry", cleanTimeString(ferry.depart));
  url.search = params.toString();
  return url;
}

export function parseSharedTrip(search: string, now: Date = new Date()): SharedTrip | null {
  const params = new URLSearchParams(search);
  const number = params.get("train") ?? "";
  const tripNumber = Number(number);
  const serviceDate = params.get("date") ?? "";
  const scheduleType = params.get("type");
  const from = validPlace((params.get("from") ?? "") as Place | "");
  const to = validPlace((params.get("to") ?? "") as Place | "");
  const departure = params.get("departure") ?? "";
  const ferryDeparture = params.get("ferry");
  if (
    !/^[1-9]\d{0,8}$/.test(number) ||
    !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(serviceDate) ||
    !CLOCK_TIME.test(departure) ||
    (scheduleType !== "weekday" && scheduleType !== "weekend") ||
    !from || !to || placeStation(from) === placeStation(to)
  ) return null;
  const viaFerry = isFerryLeg(from, to);
  if (viaFerry ? !CLOCK_TIME.test(ferryDeparture ?? "") : ferryDeparture != null) return null;

  const isoDate = new Date(`${serviceDate}T12:00:00Z`);
  if (Number.isNaN(isoDate.getTime()) || isoDate.toISOString().slice(0, 10) !== serviceDate) {
    return null;
  }
  if (sharedTripDaysAhead(serviceDate, now) > MAX_DAYS_AHEAD) return null;

  return {
    from,
    to,
    departure,
    ferryDeparture,
    run: {
      tripNumber,
      serviceDate,
      scheduleType,
      fromStation: placeStation(from),
      toStation: placeStation(to),
      ...(viaFerry ? { viaFerry: true } : {}),
    },
  };
}

export function matchesSharedDeparture(shared: SharedTrip, trip: ProcessedTrip): boolean {
  const ferry = trip.inboundFerry ?? trip.outboundFerry;
  return (
    getTodayScheduleType(parseServiceDate(shared.run.serviceDate)) === shared.run.scheduleType &&
    cleanTimeString(trip.departureTime) === shared.departure &&
    (ferry ? cleanTimeString(ferry.depart) : null) === shared.ferryDeparture
  );
}

export function sharedTripArrival(
  serviceDate: string,
  scheduled: { start: string; end: string },
  liveEnd: string,
): number {
  const day = new Date(`${serviceDate}T12:00:00Z`);
  if (parseTimeToMinutes(scheduled.end) < parseTimeToMinutes(scheduled.start)) {
    day.setUTCDate(day.getUTCDate() + 1);
  }
  const shift = parseTimeToMinutes(liveEnd) - parseTimeToMinutes(scheduled.end);
  // An estimate crossing midnight is still closest to its scheduled arrival.
  if (shift < -720) day.setUTCDate(day.getUTCDate() + 1);
  if (shift > 720) day.setUTCDate(day.getUTCDate() - 1);
  return agencyWallTimeToEpochSeconds(day.toISOString().slice(0, 10).replace(/-/g, ""), cleanTimeString(liveEnd)) * 1000;
}

export function sharedTripDaysAhead(serviceDate: string, now: Date): number {
  const today = Date.parse(`${agencyDateKey(now)}T12:00:00Z`);
  return Math.round((Date.parse(`${serviceDate}T12:00:00Z`) - today) / DAY_MS);
}

export function formatSharedServiceDate(
  serviceDate: string,
  locale: string,
  style: Intl.DateTimeFormatOptions = { dateStyle: "full" },
): string {
  return new Intl.DateTimeFormat(locale, { ...style, timeZone: AGENCY_TIME_ZONE })
    .format(new Date(`${serviceDate}T12:00:00Z`));
}

export function nativeSharedTripLocation(input: string): string | null {
  try {
    const url = new URL(input);
    return url.origin === SITE_URL && isSharedTripPath(url.pathname)
      ? url.pathname + url.search
      : null;
  } catch {
    return null;
  }
}

export function androidSharedTripIntent(url: URL): string {
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=smart.trip;end`;
}
