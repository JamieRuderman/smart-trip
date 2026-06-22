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

export { TripActivityDO } from "./do/tripActivity.js";

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
