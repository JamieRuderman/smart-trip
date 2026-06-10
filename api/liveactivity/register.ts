import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isLiveActivityRegistration } from "../../src/lib/liveActivityPushTypes.js";
import {
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
 * Phase 2 — inert until the widget extension + APNs credentials exist. When
 * Redis isn't configured the store is a no-op and this returns 503 so the
 * client can fall back silently.
 */
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
