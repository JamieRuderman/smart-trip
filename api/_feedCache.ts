import { Redis } from "@upstash/redis";

// Connection is auto-injected by the Vercel ↔ Upstash integration. When it's
// absent (e.g. local dev, or before the integration is wired up) the cache
// transparently falls back to direct upstream fetches.
const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

interface CachedFeed {
  /** base64-encoded GTFS-RT protobuf bytes exactly as fetched from 511. */
  data: string;
  /** epoch ms when these bytes were fetched from 511. */
  fetchedAt: number;
}

/**
 * How long a refresh lock is held before it auto-expires (ms). Bounds the
 * worst case if the instance holding it dies mid-fetch; kept just above the
 * upstream fetch timeout (10s) so a slow-but-succeeding fetch isn't cut off.
 */
const LOCK_TTL_MS = 12_000;

/**
 * How long a snapshot is retained as last-known-good (seconds). Lets us keep
 * serving during a prolonged 511 outage; the client's own freshness gates
 * decide when stale data (especially vehicle positions) is too old to display.
 */
const STALE_TTL_SECONDS = 60 * 60;

const dataKey = (feed: string) => `gtfsrt:data:${feed}`;
const lockKey = (feed: string) => `gtfsrt:lock:${feed}`;

const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromB64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

export interface CachedFeedResult {
  bytes: Uint8Array;
  /**
   * True only when we served an older snapshot because the live refresh failed
   * (511 down). The handler uses this to avoid pinning stale data at the CDN.
   */
  servedStale: boolean;
}

/**
 * Fetch a GTFS-RT feed through a shared Redis cache so 511 is polled at most
 * once per `freshnessMs` window GLOBALLY — across every region, origin, and
 * user. This is the architecture 511 requires: one central fetch fanned out to
 * all clients, with an upstream rate independent of how many users we have.
 *
 *  - Fresh snapshot in cache  → served directly; 511 untouched.
 *  - Stale/missing            → exactly one caller wins a Redis lock and
 *                               refreshes 511; concurrent callers serve the
 *                               existing snapshot. A cold cache (no snapshot,
 *                               lock lost) falls back to a direct fetch so the
 *                               very first requests aren't blocked.
 *  - 511 fails during refresh → serve last-known-good if we have it; otherwise
 *                               propagate the error so the handler returns 502.
 */
export async function fetchFeedCached(
  feed: string,
  freshnessMs: number,
  fetchBytes: () => Promise<Uint8Array>
): Promise<CachedFeedResult> {
  // No KV configured — behave exactly like a direct fetch.
  if (!redis) {
    return { bytes: await fetchBytes(), servedStale: false };
  }

  const now = Date.now();
  const cached = await redis.get<CachedFeed>(dataKey(feed));

  if (cached && now - cached.fetchedAt < freshnessMs) {
    return { bytes: fromB64(cached.data), servedStale: false };
  }

  // Snapshot is stale or missing. Only the lock winner refreshes 511.
  const gotLock = await redis.set(lockKey(feed), "1", {
    nx: true,
    px: LOCK_TTL_MS,
  });

  if (!gotLock) {
    // Another instance is already refreshing. Serve the existing snapshot
    // rather than pile onto 511; it's at most ~freshness + lock-TTL old, which
    // the client treats as current. Only a truly cold cache fetches directly.
    if (cached) return { bytes: fromB64(cached.data), servedStale: false };
    return { bytes: await fetchBytes(), servedStale: false };
  }

  try {
    const bytes = await fetchBytes();
    const entry: CachedFeed = { data: toB64(bytes), fetchedAt: now };
    await redis.set(dataKey(feed), entry, { ex: STALE_TTL_SECONDS });
    return { bytes, servedStale: false };
  } catch (err) {
    // 511 failed. Prefer last-known-good over surfacing the outage to users.
    if (cached) return { bytes: fromB64(cached.data), servedStale: true };
    throw err;
  } finally {
    await redis.del(lockKey(feed));
  }
}
