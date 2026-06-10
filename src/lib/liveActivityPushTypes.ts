/**
 * Shared (client + server) types for the Phase 2 Live Activity push backend.
 * Pure — no Capacitor/DOM import — so the Vercel serverless functions in
 * `api/liveactivity/*` can import it via a relative path while the client
 * imports it through the `@/` alias.
 */

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
  /** `tripActivityId(tripNumber, serviceDate)` — the join key with the token. */
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
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.tripNumber === "number" &&
    typeof r.serviceDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.serviceDate) &&
    typeof r.fromStation === "string" &&
    typeof r.toStation === "string" &&
    (r.direction === "northbound" || r.direction === "southbound") &&
    typeof r.scheduledDeparture === "string" &&
    typeof r.scheduledArrival === "string" &&
    typeof r.departureEpochMs === "number" &&
    Number.isFinite(r.departureEpochMs) &&
    typeof r.arrivalEpochMs === "number" &&
    Number.isFinite(r.arrivalEpochMs)
  );
}

/** Validate an unknown body as a `LiveActivityTokenPayload`. Pure. */
export function isLiveActivityTokenPayload(
  v: unknown,
): v is LiveActivityTokenPayload {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.activityId === "string" &&
    typeof r.token === "string" &&
    r.token.length > 0
  );
}
