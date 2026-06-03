import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";
import { applyCors } from "./_cors.js";
import { fetchGtfsRtBytes, decodeFeed, UpstreamGtfsRtError } from "./_gtfsrt.js";
import { fetchFeedCached } from "./_feedCache.js";

type Feed = "vehiclepositions" | "tripupdates" | "servicealerts";
type FeedMessage = GtfsRealtime.IFeedMessage;

interface GtfsRtHandlerOptions<T> {
  feed: Feed;
  sampleFile: string;
  cacheControl: string;
  /**
   * Max age (ms) before the shared Redis cache refreshes this feed from 511.
   * Bounds the GLOBAL upstream poll rate — one fetch per window no matter how
   * many users/regions hit us — to stay under 511's rate limit.
   */
  freshnessMs: number;
  transform: (feed: FeedMessage, req: VercelRequest) => T;
  /** Enable ?raw=true passthrough — returns full parsed protobuf feed as JSON */
  supportRaw?: boolean;
}

/**
 * Shared GTFS-RT handler wrapper.
 *
 * Handles: CORS, USE_SAMPLE_DATA passthrough, protobuf fetch, optional ?raw=true
 * debug mode, Cache-Control, and error → 500 JSON.
 *
 * Each endpoint provides only the feed-specific `transform` callback.
 */
export function createGtfsRtHandler<T>(options: GtfsRtHandlerOptions<T>) {
  const { feed, sampleFile, cacheControl, freshnessMs, transform, supportRaw = false } = options;

  return async function handler(req: VercelRequest, res: VercelResponse) {
    if (applyCors(req, res)) return;

    try {
      if (process.env.USE_SAMPLE_DATA === "true") {
        const samplePath = resolve(process.cwd(), sampleFile);
        const sample = JSON.parse(readFileSync(samplePath, "utf-8"));
        res.setHeader("Cache-Control", "no-store");
        return res.json(sample);
      }

      const { bytes, servedStale } = await fetchFeedCached(
        feed,
        freshnessMs,
        () => fetchGtfsRtBytes(feed),
      );
      const feedData = decodeFeed(bytes);

      if (supportRaw && req.query.raw === "true") {
        // Return the full parsed-but-unnormalized protobuf feed for debugging.
        // JSON.stringify handles protobuf Long values via their toJSON() method.
        res.setHeader("Cache-Control", "no-store");
        return res.json(feedData);
      }

      const result = transform(feedData, req);
      // Only let the CDN cache genuinely-fresh responses. A snapshot served
      // because 511 was down (servedStale) must not be pinned at the edge, or
      // it would outlive 511's recovery.
      res.setHeader("Cache-Control", servedStale ? "no-store" : cacheControl);
      return res.json(result);
    } catch (err) {
      // Distinguish upstream 511.org failures (rate limit, outage) from real
      // server errors in our own code: 502 Bad Gateway with the upstream
      // status, no caching. Lets clients (and humans reading the console)
      // tell "transit feed is throttling us" apart from "we have a bug".
      if (err instanceof UpstreamGtfsRtError) {
        // Surface upstream 511 failures in Vercel's function logs. The response
        // body carries upstreamStatus, but the Logs view doesn't show bodies —
        // so without this line a 511 outage is invisible in observability.
        console.warn(
          `[gtfsrt] upstream ${err.feed} failed: ${err.upstreamStatus}`,
        );
        res.setHeader("Cache-Control", "no-store");
        return res.status(502).json({
          error: err.message,
          upstreamStatus: err.upstreamStatus,
        });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  };
}

// ── Shared validation utilities ──────────────────────────────────────────────

/**
 * Warn if a vehicle or entity timestamp is stale relative to the feed header.
 * Returns a warning string, or null if fresh.
 */
export function warnIfStaleTimestamp(
  entityId: string,
  entityTimestamp: number | null | undefined,
  feedTimestamp: number,
  staleThresholdSeconds = 120
): string | null {
  if (entityTimestamp == null) return null;
  const age = feedTimestamp - entityTimestamp;
  if (age > staleThresholdSeconds) {
    return `Entity ${entityId} timestamp is ${age}s behind feed header (threshold: ${staleThresholdSeconds}s)`;
  }
  return null;
}

/**
 * Warn if a stop ID is not in the known set.
 * Returns a warning string, or null if recognised.
 */
export function warnIfUnknownStopId(
  stopId: string | null | undefined,
  knownStopIds: Set<string>
): string | null {
  if (!stopId) return null;
  if (!knownStopIds.has(stopId)) {
    return `Unknown stop ID: ${stopId}`;
  }
  return null;
}

/**
 * Warn if an enum value is not in the expected set.
 * Returns a warning string, or null if known.
 */
export function warnIfUnknownEnum(
  field: string,
  value: number | null | undefined,
  knownValues: Set<number>
): string | null {
  if (value == null) return null;
  if (!knownValues.has(value)) {
    return `Unknown ${field} enum value: ${value}`;
  }
  return null;
}
