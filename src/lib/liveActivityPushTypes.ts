/**
 * Shared (client + server) types for the Live Activity push backend.
 * Pure — no Capacitor/DOM import — so the server-side push backend (the
 * Cloudflare Worker / Durable Object under `workers/web/`) can import it via a
 * relative path while the client imports it through the `@/` alias.
 */

/** Hard caps on string fields. The register/token endpoints are necessarily
 *  public (the app has no user accounts), so every inbound string is bounded
 *  to keep junk payloads from bloating the activity store. Generous vs. real
 *  values: activity ids are ~30 chars, station names ~25, APNs tokens ~160
 *  hex. */
export const MAX_ID_LENGTH = 128;
export const MAX_STATION_LENGTH = 64;
export const MAX_TIME_LENGTH = 8;
export const MAX_APNS_TOKEN_LENGTH = 512;

function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

/**
 * What the client registers with the backend when it starts a push-enabled
 * Live Activity. The server uses this to re-derive the live arrival/delay from
 * GTFS-RT while the phone is locked and push corrections via APNs.
 *
 * Absolute epochs are client-computed (they already handle overnight rollover
 * via `focusedDepartureInstant`/`focusedArrivalInstant`); the scheduled HH:MM +
 * direction let the server match this trip inside the GTFS-RT feed.
 */
export interface LiveActivityRegistration {
  /** `tripActivityId(tripNumber, serviceDate)` — the join key with the token.
   *  Carries a random slug, making it the capability that guards this record
   *  on the public register/deregister endpoints. */
  id: string;
  tripNumber: number;
  /** "YYYY-MM-DD" service day. */
  serviceDate: string;
  fromStation: string;
  toStation: string;
  direction: "northbound" | "southbound";
  /** Scheduled departure at fromStation, "HH:MM" (static timetable). */
  scheduledDeparture: string;
  /** Scheduled arrival at toStation, "HH:MM" (static timetable). */
  scheduledArrival: string;
  /** Absolute scheduled departure instant (epoch ms), overnight-aware. */
  departureEpochMs: number;
  /** Absolute scheduled arrival instant (epoch ms), overnight-aware. */
  arrivalEpochMs: number;
  /** Scheduled departure at the trip's ORIGIN terminal, "HH:MM" — matches the
   *  feed's `startTime`, so the server can flag cancelled runs whose
   *  stop_time_updates were omitted (511 does that). Optional: absent when
   *  the origin time isn't present in the static timetable. */
  originStartTime?: string;
  /** Lead minutes of the armed "leave alarm" reminder, when one is set. The
   *  server derives the leave-alarm countdown instant as `liveDeparture - lead`
   *  and feeds it into every pushed content state, so a locked-screen delay
   *  correction keeps the "Leave in" stage instead of dropping the leave-alarm
   *  countdown and reverting to "Departs in". Absent when no reminder is armed;
   *  the client re-registers whenever the reminder is armed or cleared. */
  reminderLeadMinutes?: number;
}

/** The per-activity APNs token payload iOS POSTs to the token endpoint (the
 *  shape configured via `LiveActivity.setUpdateTokenEndpoint`). */
export interface LiveActivityTokenPayload {
  /** Logical id (matches `LiveActivityRegistration.id`). */
  id: string;
  /** System `Activity.id` (opaque; useful for debugging). */
  activityId: string;
  /** Hex-encoded APNs live-activity update token for this activity. */
  token: string;
}

/** Validate an unknown body as a `LiveActivityRegistration`. Pure; used by the
 *  register endpoint and unit-tested without a server. */
export function isLiveActivityRegistration(
  v: unknown,
): v is LiveActivityRegistration {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isBoundedString(r.id, MAX_ID_LENGTH) &&
    typeof r.tripNumber === "number" &&
    Number.isFinite(r.tripNumber) &&
    typeof r.serviceDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.serviceDate) &&
    isBoundedString(r.fromStation, MAX_STATION_LENGTH) &&
    isBoundedString(r.toStation, MAX_STATION_LENGTH) &&
    (r.direction === "northbound" || r.direction === "southbound") &&
    isBoundedString(r.scheduledDeparture, MAX_TIME_LENGTH) &&
    isBoundedString(r.scheduledArrival, MAX_TIME_LENGTH) &&
    typeof r.departureEpochMs === "number" &&
    Number.isFinite(r.departureEpochMs) &&
    typeof r.arrivalEpochMs === "number" &&
    Number.isFinite(r.arrivalEpochMs) &&
    // Arrival must be strictly after departure — the server schedules the
    // departure→arrival transition and the post-arrival teardown against these,
    // so an inverted/equal pair would mis-drive (or never end) the activity.
    r.arrivalEpochMs > r.departureEpochMs &&
    (r.originStartTime === undefined ||
      isBoundedString(r.originStartTime, MAX_TIME_LENGTH)) &&
    (r.reminderLeadMinutes === undefined ||
      (typeof r.reminderLeadMinutes === "number" &&
        Number.isFinite(r.reminderLeadMinutes) &&
        r.reminderLeadMinutes >= 0))
  );
}

/** How far in the FUTURE a registration's departure may be. Generous vs real
 *  use (a rider can pin a weekend trip a few days out) while bounding how long
 *  an abusive registration can keep its Durable Object + alarm alive. */
export const MAX_REGISTRATION_FUTURE_MS = 8 * 24 * 60 * 60 * 1000;
/** How far in the PAST a registration's departure may be — a trip that just
 *  started (or just ended) is still legitimately registerable. */
export const MAX_REGISTRATION_PAST_MS = 6 * 60 * 60 * 1000;
/** Max span from departure to arrival. SMART end-to-end is ~90 min; 6h is a
 *  generous ceiling that still caps the DO's self-scheduling lifetime. */
export const MAX_REGISTRATION_DURATION_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a (shape-valid) registration's instants are within a plausible
 * scheduling horizon of `now`. The register endpoint is public and accountless,
 * so without this a single request could schedule a Durable Object alarm
 * arbitrarily far out (or with an absurd duration) and keep it — and its 511
 * poll loop — alive indefinitely. Pure + time-injected so it's unit-testable.
 */
export function isRegistrationWithinHorizon(
  reg: LiveActivityRegistration,
  now: number,
): boolean {
  return (
    reg.departureEpochMs >= now - MAX_REGISTRATION_PAST_MS &&
    reg.departureEpochMs <= now + MAX_REGISTRATION_FUTURE_MS &&
    reg.arrivalEpochMs <= reg.departureEpochMs + MAX_REGISTRATION_DURATION_MS
  );
}

/** Validate an unknown body as a `LiveActivityTokenPayload`. Pure. */
export function isLiveActivityTokenPayload(
  v: unknown,
): v is LiveActivityTokenPayload {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isBoundedString(r.id, MAX_ID_LENGTH) &&
    typeof r.activityId === "string" &&
    r.activityId.length <= MAX_ID_LENGTH &&
    isBoundedString(r.token, MAX_APNS_TOKEN_LENGTH)
  );
}
