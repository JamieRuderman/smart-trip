/**
 * Native GTFS-RT feed access for the Worker — fetch 511, decode the protobuf,
 * normalize, cached in **Cloudflare KV**. This is the Workers-native replacement
 * for the Vercel `_feedCache.ts` (Upstash) path, so the migrated backend has NO
 * Upstash dependency: Live Activity state lives in the Durable Object, and the
 * feed cache lives in KV.
 *
 * The decode (`decodeFeed`) and normalize (`normalizeTripUpdates`) are reused
 * verbatim from the Vercel code (`api/`) — only the fetch + cache are
 * re-implemented for the Workers runtime (KV instead of Upstash; env binding
 * instead of `process.env`).
 *
 * KV is global, so a cached entry fans out to every colo within seconds —
 * bounding the 511 poll to ~one fetch per feed per freshness window. No refresh
 * lock (unlike the Vercel path): the worst case is a couple of concurrent
 * refreshes at a window boundary, well within 511's budget for this app.
 */
import {
  decodeFeed,
  getTranslation,
  transit_realtime,
  VEHICLE_STOP_STATUS,
} from "../../../../api/_gtfsrt.js";
import {
  normalizeTripUpdates,
  TRIPUPDATES_FRESHNESS_MS,
  type NormalizedTripUpdate,
} from "../../../../api/_tripUpdatesFeed.js";
import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";

type IFeedMessage = GtfsRealtime.IFeedMessage;
type IFeedEntity = GtfsRealtime.IFeedEntity;

export type GtfsFeed = "tripupdates" | "vehiclepositions" | "servicealerts";

interface FeedMeta {
  fetchedAt?: number;
}

/** Minimal KV surface we use (avoids a `@cloudflare/workers-types` dependency). */
export interface FeedCacheKV {
  getWithMetadata(
    key: string,
    options: { type: "arrayBuffer" },
  ): Promise<{ value: ArrayBuffer | null; metadata: FeedMeta | null }>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { metadata?: FeedMeta; expirationTtl?: number },
  ): Promise<void>;
}

export interface GtfsRtEnv {
  TRANSIT_511_API_KEY?: string;
  FEED_CACHE: FeedCacheKV;
}

const BASE = "http://api.511.org/transit";
/** Abort a stalled 511 fetch (it can hang ~60s before a 504). */
const UPSTREAM_TIMEOUT_MS = 10_000;
/** Hard KV expiry backstop (seconds); the freshness check drives normal refresh. */
const KV_TTL_SECONDS = 300;

async function fetch511(apiKey: string, feed: GtfsFeed): Promise<Uint8Array> {
  const res = await fetch(`${BASE}/${feed}?api_key=${apiKey}&agency=SA`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`511 ${feed} responded ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Raw GTFS-RT protobuf bytes for a feed, KV-cached to ~one 511 fetch / window. */
export async function getFeedBytes(
  env: GtfsRtEnv,
  feed: GtfsFeed,
  freshnessMs: number,
): Promise<Uint8Array> {
  const key = `feed:${feed}`;
  const cached = await env.FEED_CACHE.getWithMetadata(key, { type: "arrayBuffer" });
  if (
    cached.value &&
    cached.metadata?.fetchedAt &&
    Date.now() - cached.metadata.fetchedAt < freshnessMs
  ) {
    return new Uint8Array(cached.value);
  }
  if (!env.TRANSIT_511_API_KEY) throw new Error("Missing TRANSIT_511_API_KEY");
  const bytes = await fetch511(env.TRANSIT_511_API_KEY, feed);
  await env.FEED_CACHE.put(key, bytes, {
    metadata: { fetchedAt: Date.now() },
    expirationTtl: KV_TTL_SECONDS,
  });
  return bytes;
}

/** Normalized trip-updates — the exact shape the client and the DO consume. */
export async function getTripUpdates(
  env: GtfsRtEnv,
): Promise<{ timestamp: number; updates: NormalizedTripUpdate[] }> {
  const bytes = await getFeedBytes(env, "tripupdates", TRIPUPDATES_FRESHNESS_MS);
  return normalizeTripUpdates(decodeFeed(bytes));
}

const VEHICLEPOSITIONS_FRESHNESS_MS = 15_000;
const SERVICEALERTS_FRESHNESS_MS = 300_000;

/** Normalized vehicle positions (shape mirrors api/gtfsrt/vehiclepositions.ts —
 *  minus the dev-only validation `warnings`, which were diagnostic). */
function normalizeVehiclePositions(feed: IFeedMessage): {
  timestamp: number;
  vehicles: unknown[];
} {
  const feedTimestamp = Number(feed.header?.timestamp ?? 0);
  const vehicles = (feed.entity ?? [])
    .filter(
      (e): e is IFeedEntity & { vehicle: GtfsRealtime.IVehiclePosition } =>
        e.vehicle != null,
    )
    .map((entity) => {
      const v = entity.vehicle;
      const vehicleId = v.vehicle?.id ?? entity.id ?? "";
      const currentStatusNum = v.currentStatus ?? undefined;
      return {
        vehicleId,
        vehicleLabel: v.vehicle?.label ?? vehicleId,
        trip: v.trip
          ? {
              tripId: v.trip.tripId ?? "",
              startTime: v.trip.startTime ?? "",
              startDate: v.trip.startDate ?? "",
              routeId: v.trip.routeId ?? "",
              directionId: v.trip.directionId ?? 0,
            }
          : undefined,
        position: {
          latitude: v.position?.latitude ?? 0,
          longitude: v.position?.longitude ?? 0,
          bearing: v.position?.bearing != null ? v.position.bearing : undefined,
          speed: v.position?.speed != null ? v.position.speed : undefined,
        },
        currentStopSequence: v.currentStopSequence ?? undefined,
        currentStatus:
          currentStatusNum != null
            ? VEHICLE_STOP_STATUS[currentStatusNum] ?? "IN_TRANSIT_TO"
            : undefined,
        stopId: v.stopId ?? undefined,
        timestamp: v.timestamp != null ? Number(v.timestamp) : undefined,
      };
    });
  return { timestamp: feedTimestamp, vehicles };
}

export async function getVehiclePositions(env: GtfsRtEnv) {
  const bytes = await getFeedBytes(env, "vehiclepositions", VEHICLEPOSITIONS_FRESHNESS_MS);
  return normalizeVehiclePositions(decodeFeed(bytes));
}

const { Alert } = transit_realtime;
const mapEffect = (e?: number | null): string =>
  e == null ? "UNKNOWN_EFFECT" : Alert.Effect[e] ?? "UNKNOWN_EFFECT";
const mapCause = (c?: number | null): string =>
  c == null ? "UNKNOWN_CAUSE" : Alert.Cause[c] ?? "UNKNOWN_CAUSE";

/** Normalized service alerts (shape mirrors api/gtfsrt/alerts.ts). */
function normalizeServiceAlerts(feed: IFeedMessage): {
  timestamp: number;
  alerts: unknown[];
} {
  const timestamp = Number(feed.header?.timestamp ?? 0);
  const alerts = (feed.entity ?? [])
    .filter(
      (e): e is IFeedEntity & { alert: GtfsRealtime.IAlert } => e.alert != null,
    )
    .map((entity) => {
      const alert = entity.alert;
      return {
        id: entity.id,
        activePeriods: (alert.activePeriod ?? []).map((p) => ({
          start: p.start ? Number(p.start) : undefined,
          end: p.end ? Number(p.end) : undefined,
        })),
        informedEntities: (alert.informedEntity ?? []).map((i) => ({
          agencyId: i.agencyId ?? undefined,
          routeId: i.routeId ?? undefined,
          tripId: i.trip?.tripId ?? undefined,
          stopId: i.stopId ?? undefined,
        })),
        cause: mapCause(alert.cause),
        effect: mapEffect(alert.effect),
        headerText: getTranslation(alert.headerText),
        descriptionText: getTranslation(alert.descriptionText),
        url: getTranslation(alert.url) || undefined,
      };
    });
  return { timestamp, alerts };
}

export async function getServiceAlerts(env: GtfsRtEnv) {
  const bytes = await getFeedBytes(env, "servicealerts", SERVICEALERTS_FRESHNESS_MS);
  return normalizeServiceAlerts(decodeFeed(bytes));
}
