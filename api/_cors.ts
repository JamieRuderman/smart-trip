import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Apply CORS for the public GTFS-RT data endpoints. Returns `true` if the
 * caller should stop further processing (a handled preflight).
 *
 * Policy: a single wildcard `Access-Control-Allow-Origin: *` and NO
 * `Vary: Origin`.
 *
 * Why wildcard instead of an origin allowlist:
 *  - These endpoints serve public, uncredentialed GTFS-RT data that is byte-for-
 *    byte identical for every caller. There is nothing origin-specific to
 *    protect.
 *  - An Origin allowlist only constrains *browser* requests anyway — any server,
 *    script, or curl can omit/spoof the Origin header (and the previous code
 *    already let originless requests through). So it never actually prevented
 *    scraping or upstream load; it only blocked other websites' in-browser use.
 *  - Crucially, `Vary: Origin` forced Vercel's edge cache to keep a SEPARATE
 *    cached copy per Origin (web domain, capacitor://localhost, https://localhost,
 *    every preview URL, originless). Each variant missed independently and
 *    triggered its own upstream 511 fetch, multiplying our load against 511's
 *    rate limit. Dropping Vary collapses those to ONE shared cache entry per
 *    feed per edge — the actual lever for reducing 511 traffic.
 *
 * Abuse/load is controlled by the Cache-Control on each endpoint (shared edge
 * cache) and the upstream 511 rate limit — not by CORS.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}
