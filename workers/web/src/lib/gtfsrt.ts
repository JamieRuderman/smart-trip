/**
 * Native GTFS-RT feed access for the Worker — fetch 511, decode the protobuf,
 * normalize, cached in **Cloudflare's edge Cache API** (`caches.default`). The
 * decode (`decodeFeed`) and normalize (`normalizeTripUpdates`) are reused
 * verbatim from the Vercel code (`api/`); only the fetch + cache are
 * re-implemented for the Workers runtime.
 *
 * Cache choice: the Cache API is free with **no per-day write limit**. It
 * replaced Workers KV, whose free-tier 1,000-writes/day cap was far too low for
 * a write-on-every-refresh cache and took the live feeds down. Unlike KV it
 * caches per-colo rather than globally, but traffic here sits on ~one Bay Area
 * colo, so 511 stays at ~one fetch per feed per freshness window — within
 * budget. The cache is best-effort: a write failure degrades to a direct 511
 * fetch, and a 511 hiccup serves the last-known-good feed (never a hard error).
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

/** Minimal Cache API surface — `caches.default` is Cloudflare's global edge
 *  cache: free, with NO per-day write limit (unlike Workers KV's 1k/day free
 *  cap). Typed locally + resolved via globalThis to avoid a
 *  `@cloudflare/workers-types` dependency. */
interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
function edgeCache(): EdgeCache {
  return (globalThis as unknown as { caches: { default: EdgeCache } }).caches
    .default;
}

export interface GtfsRtEnv {
  TRANSIT_511_API_KEY?: string;
}

const BASE = "http://api.511.org/transit";
/** Abort a stalled 511 fetch (it can hang ~60s before a 504). */
const UPSTREAM_TIMEOUT_MS = 10_000;
/** How long a cached feed stays *available* for the stale-on-error fallback,
 *  independent of each feed's much shorter freshness window — a hard backstop so
 *  the cache can't serve indefinitely-stale data if 511 stays down. */
const CACHE_BACKSTOP_SECONDS = 300;
/** Header recording when an entry was fetched, so each feed's own freshness
 *  window applies on top of the backstop TTL. */
const FETCHED_AT_HEADER = "x-feed-fetched-at";
/** Header recording the earliest time to re-attempt 511 after a failed refresh.
 *  Kept separate from the fetch timestamp so serving stale doesn't rewrite the
 *  feed's real age. */
const RETRY_AFTER_HEADER = "x-feed-retry-after";
/** After a failed 511 refresh, keep serving the last-known-good feed (without
 *  re-hitting 511) for this long, so a 511 outage doesn't make every poll
 *  re-fetch and wait the upstream timeout. */
const STALE_RETRY_BACKOFF_MS = 30_000;
/** Cache-key host for callers without an inbound request (the DO). Must be
 *  within the Worker's zone for `Cache.put` to persist. */
const DEFAULT_CACHE_ORIGIN = "https://smarttraintrip.com";

async function fetch511(apiKey: string, feed: GtfsFeed): Promise<Uint8Array> {
  const res = await fetch(`${BASE}/${feed}?api_key=${apiKey}&agency=SA`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`511 ${feed} responded ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Cache key for a feed. The host must be within the Worker's zone for
 *  `Cache.put` to persist, so we key off the inbound request's origin when we
 *  have one and fall back to the production apex otherwise. */
function feedCacheKey(feed: GtfsFeed, origin: string): Request {
  return new Request(`${origin}/__feed-cache/${feed}`);
}

/** Build a cacheable feed Response carrying its fetch time, plus an optional
 *  re-attempt-after marker set when a 511 refresh just failed. */
function feedResponse(bytes: Uint8Array, fetchedAt: number, retryAfter = 0): Response {
  const headers: Record<string, string> = {
    [FETCHED_AT_HEADER]: String(fetchedAt),
    "cache-control": `max-age=${CACHE_BACKSTOP_SECONDS}`,
  };
  if (retryAfter > 0) headers[RETRY_AFTER_HEADER] = String(retryAfter);
  return new Response(bytes, { headers });
}

/** Best-effort cache write — must NEVER break the response. A fatal cache write
 *  is what turned the KV write-limit into a full outage. */
async function cachePut(cache: EdgeCache, key: Request, response: Response): Promise<void> {
  try {
    await cache.put(key, response);
  } catch {
    /* ignore — degrade to direct 511 fetches */
  }
}

/** Raw GTFS-RT protobuf bytes for a feed, cached in the edge Cache API to ~one
 *  511 fetch per freshness window. Best-effort + resilient: a cache-write
 *  failure degrades to a direct 511 fetch, and a 511 hiccup serves the
 *  last-known-good feed instead of throwing — then backs off so a sustained
 *  outage doesn't re-hit 511 on every poll. */
export async function getFeedBytes(
  env: GtfsRtEnv,
  feed: GtfsFeed,
  freshnessMs: number,
  cacheOrigin: string = DEFAULT_CACHE_ORIGIN,
): Promise<Uint8Array> {
  const cache = edgeCache();
  const key = feedCacheKey(feed, cacheOrigin);

  // Whatever we have cached (fresh, or merely stale-within-backstop).
  const cached = await cache.match(key).catch(() => undefined);
  const cachedBytes = cached ? new Uint8Array(await cached.arrayBuffer()) : null;
  const fetchedAt = cached ? Number(cached.headers.get(FETCHED_AT_HEADER)) || 0 : 0;
  const retryAfter = cached ? Number(cached.headers.get(RETRY_AFTER_HEADER)) || 0 : 0;

  // Serve cached without touching 511 when it's still fresh, OR when we're
  // inside a post-failure backoff (don't re-hammer 511 during an outage).
  if (cachedBytes && (Date.now() - fetchedAt < freshnessMs || Date.now() < retryAfter)) {
    return cachedBytes;
  }

  // Stale or missing → refresh from 511.
  if (!env.TRANSIT_511_API_KEY) {
    if (cachedBytes) return cachedBytes;
    throw new Error("Missing TRANSIT_511_API_KEY");
  }
  let bytes: Uint8Array;
  try {
    bytes = await fetch511(env.TRANSIT_511_API_KEY, feed);
  } catch (err) {
    // 511 hiccup → serve last-known-good, and back off so the next
    // ~STALE_RETRY_BACKOFF_MS of polls serve stale instead of each re-attempting
    // 511 and waiting the upstream timeout. fetchedAt is preserved so the feed's
    // real age stays truthful.
    if (cachedBytes) {
      await cachePut(cache, key, feedResponse(cachedBytes, fetchedAt, Date.now() + STALE_RETRY_BACKOFF_MS));
      return cachedBytes;
    }
    throw err;
  }

  await cachePut(cache, key, feedResponse(bytes, Date.now()));
  return bytes;
}

/** Normalized trip-updates — the exact shape the client and the DO consume. */
export async function getTripUpdates(
  env: GtfsRtEnv,
  cacheOrigin?: string,
): Promise<{ timestamp: number; updates: NormalizedTripUpdate[] }> {
  const bytes = await getFeedBytes(env, "tripupdates", TRIPUPDATES_FRESHNESS_MS, cacheOrigin);
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

export async function getVehiclePositions(env: GtfsRtEnv, cacheOrigin?: string) {
  const bytes = await getFeedBytes(env, "vehiclepositions", VEHICLEPOSITIONS_FRESHNESS_MS, cacheOrigin);
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

export async function getServiceAlerts(env: GtfsRtEnv, cacheOrigin?: string) {
  const bytes = await getFeedBytes(env, "servicealerts", SERVICEALERTS_FRESHNESS_MS, cacheOrigin);
  return normalizeServiceAlerts(decodeFeed(bytes));
}
