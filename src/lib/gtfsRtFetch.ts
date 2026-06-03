import { apiBaseUrl } from "@/lib/env";

/**
 * Error thrown by {@link fetchGtfsRtJson} when one of our /api/gtfsrt/*
 * endpoints responds non-OK. Carries the HTTP status from our own API and,
 * when our API reached 511 but the upstream feed failed, the `upstreamStatus`
 * that 511 reported (our 502 responses include it).
 */
export class GtfsRtError extends Error {
  readonly status: number;
  readonly upstreamStatus?: number;

  constructor(status: number, upstreamStatus?: number) {
    super(
      upstreamStatus != null
        ? `511 upstream responded ${upstreamStatus}`
        : `Realtime fetch failed: ${status}`,
    );
    this.name = "GtfsRtError";
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }

  /**
   * True when our API reached 511 but the upstream feed failed (502 Bad
   * Gateway). Distinguishes "the 511 data feed is down" from a bug in our own
   * API (500) or a client/network problem (fetch reject).
   */
  get isUpstreamDown(): boolean {
    return this.status === 502;
  }
}

/**
 * Fetch JSON from one of our /api/gtfsrt/* endpoints. On a non-OK response it
 * throws a typed {@link GtfsRtError}, parsing the `upstreamStatus` out of the
 * error body when present so the UI can tell a 511 outage apart from other
 * failures.
 */
export async function fetchGtfsRtJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`);
  if (!res.ok) {
    let upstreamStatus: number | undefined;
    try {
      const body = (await res.json()) as { upstreamStatus?: unknown };
      if (typeof body?.upstreamStatus === "number") {
        upstreamStatus = body.upstreamStatus;
      }
    } catch {
      // Non-JSON error body — leave upstreamStatus undefined.
    }
    throw new GtfsRtError(res.status, upstreamStatus);
  }
  return res.json() as Promise<T>;
}

/** True when a react-query error indicates the upstream 511 feed is down. */
export function isUpstreamFeedDown(error: unknown): boolean {
  return error instanceof GtfsRtError && error.isUpstreamDown;
}
