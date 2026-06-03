import { Redis } from "@upstash/redis";
import { UpstreamGtfsRtError } from "./_gtfsrt.js";

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

  try {
    return await fetchViaCache(redis, feed, freshnessMs, fetchBytes);
  } catch (err) {
    // A genuine 511 failure must propagate (handler → 502, possibly after
    // serving stale). But a *Redis* problem — auth (WRONGPASS), network,
    // anything — must not take the endpoint down: fall back to a direct fetch
    // so trains still load. Logged loudly so the misconfiguration shows up in
    // Vercel logs rather than being silently masked.
    if (err instanceof UpstreamGtfsRtError) throw err;
    console.warn(
      `[gtfsrt] Redis cache unavailable for ${feed}; serving direct from 511: ${String(err)}`,
    );
    return { bytes: await fetchBytes(), servedStale: false };
  }
}

async function fetchViaCache(
  client: Redis,
  feed: string,
  freshnessMs: number,
  fetchBytes: () => Promise<Uint8Array>
): Promise<CachedFeedResult> {
  const now = Date.now();
  const cached = await client.get<CachedFeed>(dataKey(feed));

  if (cached && now - cached.fetchedAt < freshnessMs) {
    return { bytes: fromB64(cached.data), servedStale: false };
  }

  // Snapshot is stale or missing. Only the lock winner refreshes 511; the lock
  // doubles as a backoff (see the catch) so a failing 511 isn't re-hit on every
  // request during an outage.
  const gotLock = await client.set(lockKey(feed), "1", {
    nx: true,
    px: LOCK_TTL_MS,
  });

  if (!gotLock) {
    // Another instance holds the lock — either refreshing now or backing off
    // after a failed refresh. Serve the existing snapshot, which is by
    // definition past its freshness window here, marked stale so the CDN won't
    // pin it. Only a truly cold cache falls back to a direct fetch.
    if (cached) return { bytes: fromB64(cached.data), servedStale: true };
    return { bytes: await fetchBytes(), servedStale: false };
  }

  try {
    const bytes = await fetchBytes();
    const entry: CachedFeed = { data: toB64(bytes), fetchedAt: now };
    await client.set(dataKey(feed), entry, { ex: STALE_TTL_SECONDS });
    // Success — release the lock so the next freshness window can refresh.
    await client.del(lockKey(feed));
    return { bytes, servedStale: false };
  } catch (err) {
    // 511 failed. Keep the lock as a backoff (~one freshness window) instead of
    // releasing it, so we don't re-hit a down upstream on every request — a
    // failed refresh then costs the same poll budget as a healthy one. Serve
    // last-known-good if we have it; otherwise propagate the error (→ 502).
    await client.set(lockKey(feed), "1", { px: freshnessMs });
    if (cached) return { bytes: fromB64(cached.data), servedStale: true };
    throw err;
  }
}
