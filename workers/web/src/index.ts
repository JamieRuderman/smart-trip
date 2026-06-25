/**
 * Cloudflare front Worker for the SMART trip app.
 *
 * - Static SPA: served from ./dist via the ASSETS binding (SPA fallback in
 *   wrangler.toml).
 * - Native Live Activity backend: /api/liveactivity/{register,token,deregister}
 *   are handled here → routed to a per-activity Durable Object
 *   (`TripActivityDO`) that drives EXACT-TIME push transitions via DO alarms.
 * - Everything else under /api/* still proxies to the Vercel backend
 *   (`API_ORIGIN`) — the migration seam, shrinking as routes move over.
 *
 * `run_worker_first = ["/api/*"]` guarantees this Worker sees /api/* before the
 * SPA fallback would return index.html for them.
 */
import {
  isLiveActivityRegistration,
  isLiveActivityTokenPayload,
} from "../../../src/lib/liveActivityPushTypes.js";
import {
  getServiceAlerts,
  getTripUpdates,
  getVehiclePositions,
} from "./lib/gtfsrt.js";

export { TripActivityDO } from "./do/tripActivity.js";

/** Wildcard CORS for the public GTFS-RT data (matches api/_cors.ts): the data is
 *  identical for every caller, and the iOS app reads it from capacitor://localhost. */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "Content-Type, X-Requested-With",
  "access-control-max-age": "86400",
};

/** Serve a native GTFS-RT feed with CORS + Cache-Control; 502 on upstream
 *  failure (the client falls back to its cached data / static schedule). */
async function serveGtfsRt(
  request: Request,
  getData: () => Promise<unknown>,
  cacheControl: string,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    return Response.json(await getData(), { headers: { ...CORS, "cache-control": cacheControl } });
  } catch (err) {
    console.warn(`[gtfsrt] ${new URL(request.url).pathname} failed: ${String(err)}`);
    return Response.json({ error: "Upstream feed unavailable" }, { status: 502, headers: CORS });
  }
}

/** Minimal structural DO namespace type (avoids a @cloudflare/workers-types dep). */
interface DurableObjectStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Origin that un-migrated /api/* is proxied to (the Vercel backend). */
  API_ORIGIN: string;
  /** Per-activity Live Activity Durable Objects. */
  TRIP_ACTIVITY: DurableObjectNamespace;
  // APNs creds (forwarded to the DO via env) — see workers/web/src/lib/apns.ts.
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_APP_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_HOST?: string;
  // GTFS-RT native feed (511 + edge Cache API) — see workers/web/src/lib/gtfsrt.ts.
  TRANSIT_511_API_KEY?: string;
}

/** The DO instance for one activity id. */
function activityStub(env: Env, id: string): DurableObjectStub {
  return env.TRIP_ACTIVITY.get(env.TRIP_ACTIVITY.idFromName(id));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Native Live Activity routes → Durable Object ---
    if (path === "/api/liveactivity/register" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!isLiveActivityRegistration(body)) {
        return Response.json({ error: "Invalid registration" }, { status: 400 });
      }
      console.log(`[la] register ${body.id}`);
      return activityStub(env, body.id).fetch("https://do/register", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    if (path === "/api/liveactivity/register" && request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
      console.log(`[la] deregister ${id}`);
      return activityStub(env, id).fetch("https://do/deregister", { method: "POST" });
    }
    if (path === "/api/liveactivity/token" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!isLiveActivityTokenPayload(body)) {
        return Response.json({ error: "Invalid token payload" }, { status: 400 });
      }
      console.log(`[la] token ${body.id}`);
      return activityStub(env, body.id).fetch("https://do/token", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    // --- Native GTFS-RT feeds (511 + protobuf + edge Cache API; no Vercel, no Upstash) ---
    if (path === "/api/gtfsrt/tripupdates") {
      return serveGtfsRt(request, () => getTripUpdates(env, url.origin), "s-maxage=30, stale-while-revalidate=15");
    }
    if (path === "/api/gtfsrt/vehiclepositions") {
      return serveGtfsRt(request, () => getVehiclePositions(env, url.origin), "s-maxage=15");
    }
    if (path === "/api/gtfsrt/alerts") {
      return serveGtfsRt(request, () => getServiceAlerts(env, url.origin), "s-maxage=60, stale-while-revalidate=30");
    }

    // --- Everything else under /api/* still proxies to Vercel ---
    if (path.startsWith("/api/")) {
      const upstream = new URL(env.API_ORIGIN);
      upstream.pathname = path;
      upstream.search = url.search;
      return fetch(new Request(upstream.toString(), request));
    }

    // --- Static asset / SPA fallback ---
    return env.ASSETS.fetch(request);
  },
};
