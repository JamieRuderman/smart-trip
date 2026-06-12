import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isLiveActivityRegistration } from "../../src/lib/liveActivityPushTypes.js";
import {
  countActiveIds,
  hasRegistration,
  liveActivityStoreAvailable,
  putRegistration,
  removeActivity,
} from "../_liveActivityStore.js";

/**
 * Register (POST) or deregister (DELETE ?id=) a focused trip for push-backed
 * Live Activity updates. The client calls this when it starts/ends a
 * push-enabled activity; the cron (`push.ts`) then corrects its countdown from
 * GTFS-RT while the phone is locked.
 *
 * The endpoint is necessarily public (no accounts), so two layers bound abuse:
 * activity ids carry a random slug (the capability — a stranger can't guess a
 * victim's id to overwrite or deregister it), and the active set is capped so
 * junk registrations can't grow the cron's per-run work or the Redis footprint
 * unboundedly.
 *
 * Phase 2 — inert until the widget extension + APNs credentials exist. When
 * Redis isn't configured the store is a no-op and this returns 503 so the
 * client can fall back silently.
 */

/** Far above any realistic concurrent ridership for this app; small enough
 *  that a junk flood can't inflate the cron's per-run fan-out. */
const MAX_ACTIVE_ACTIVITIES = 200;
function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!liveActivityStoreAvailable()) {
    return res.status(503).json({ error: "Live Activity store unavailable" });
  }

  if (req.method === "DELETE") {
    const id = typeof req.query.id === "string" ? req.query.id : null;
    if (!id) return res.status(400).json({ error: "Missing id" });
    await removeActivity(id);
    return res.status(204).end();
  }

  if (req.method === "POST") {
    const body =
      typeof req.body === "string" ? safeJson(req.body) : req.body;
    if (!isLiveActivityRegistration(body)) {
      return res.status(400).json({ error: "Invalid registration" });
    }
    // Capacity-gate NEW ids only — a re-registration (same id; e.g. the
    // client's boot-time heal) updates in place and must never be refused.
    if (
      !(await hasRegistration(body.id)) &&
      (await countActiveIds()) >= MAX_ACTIVE_ACTIVITIES
    ) {
      return res.status(429).json({ error: "Too many active activities" });
    }
    await putRegistration(body);
    return res.status(204).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
