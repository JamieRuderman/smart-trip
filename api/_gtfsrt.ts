// gtfs-realtime-bindings is a CommonJS module (module.exports = $root).
// A default ESM import gives us the $root object; we re-export transit_realtime
// so consuming files can use enum values without importing the package directly.
import GtfsRealtimeBindings, {
  transit_realtime as transitRealtimeTypes,
} from "gtfs-realtime-bindings";

type GtfsRealtimeModule = {
  transit_realtime: typeof transitRealtimeTypes;
};

export const transit_realtime = (GtfsRealtimeBindings as GtfsRealtimeModule).transit_realtime;

const BASE = "http://api.511.org/transit";

/** Thrown when the upstream 511.org feed responds non-OK (e.g. 429 rate limit,
 *  503 maintenance). The handler maps these to 502 Bad Gateway so clients can
 *  tell upstream issues apart from real bugs in our own code. */
export class UpstreamGtfsRtError extends Error {
  readonly feed: string;
  readonly upstreamStatus: number;
  constructor(feed: string, upstreamStatus: number) {
    super(`511.org ${feed} responded ${upstreamStatus}`);
    this.name = "UpstreamGtfsRtError";
    this.feed = feed;
    this.upstreamStatus = upstreamStatus;
  }
}

export async function fetchGtfsRt(
  feed: "servicealerts" | "vehiclepositions" | "tripupdates"
): Promise<transitRealtimeTypes.FeedMessage> {
  const apiKey = process.env.TRANSIT_511_API_KEY;
  if (!apiKey) throw new Error("Missing TRANSIT_511_API_KEY");

  const url = `${BASE}/${feed}?api_key=${apiKey}&agency=SA`;
  const res = await fetch(url);
  if (!res.ok) throw new UpstreamGtfsRtError(feed, res.status);

  const buffer = await res.arrayBuffer();
  return transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
}

export function getTranslation(
  translated: transitRealtimeTypes.ITranslatedString | null | undefined
): string {
  if (!translated?.translation?.length) return "";
  const en = translated.translation.find((translation) => translation.language === "en");
  return en?.text ?? translated.translation[0]?.text ?? "";
}

// ── Shared enum string maps ───────────────────────────────────────────────────
// These are GTFS-RT protocol concerns shared across all endpoint transforms.

const { TripDescriptor, TripUpdate, VehiclePosition } = transit_realtime;

/** Maps TripDescriptor.ScheduleRelationship numeric values to strings. */
export const TRIP_SCHEDULE_RELATIONSHIP: Record<number, string> = {
  [TripDescriptor.ScheduleRelationship.SCHEDULED]: "SCHEDULED",
  [TripDescriptor.ScheduleRelationship.ADDED]: "ADDED",
  [TripDescriptor.ScheduleRelationship.UNSCHEDULED]: "UNSCHEDULED",
  [TripDescriptor.ScheduleRelationship.CANCELED]: "CANCELED",
  [TripDescriptor.ScheduleRelationship.DUPLICATED]: "DUPLICATED",
};

/** Maps TripUpdate.StopTimeUpdate.ScheduleRelationship numeric values to strings. */
export const STOP_SCHEDULE_RELATIONSHIP: Record<number, string> = {
  [TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED]: "SCHEDULED",
  [TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED]: "SKIPPED",
  [TripUpdate.StopTimeUpdate.ScheduleRelationship.NO_DATA]: "NO_DATA",
};

/** Maps VehiclePosition.VehicleStopStatus numeric values to strings. */
export const VEHICLE_STOP_STATUS: Record<number, string> = {
  [VehiclePosition.VehicleStopStatus.INCOMING_AT]: "INCOMING_AT",
  [VehiclePosition.VehicleStopStatus.STOPPED_AT]: "STOPPED_AT",
  [VehiclePosition.VehicleStopStatus.IN_TRANSIT_TO]: "IN_TRANSIT_TO",
};

/** Known VehicleStopStatus enum values for validation. */
export const KNOWN_VEHICLE_STOP_STATUS_VALUES = new Set([
  VehiclePosition.VehicleStopStatus.INCOMING_AT,
  VehiclePosition.VehicleStopStatus.STOPPED_AT,
  VehiclePosition.VehicleStopStatus.IN_TRANSIT_TO,
]);
