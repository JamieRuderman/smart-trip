import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isLiveActivityTokenPayload } from "../../src/lib/liveActivityPushTypes.js";
import {
  getRegistration,
  liveActivityStoreAvailable,
  putToken,
} from "../_liveActivityStore.js";

/**
 * Receives per-activity APNs update tokens that iOS POSTs automatically — this
 * is the URL the client passes to `LiveActivity.setUpdateTokenEndpoint`. iOS
 * persists the endpoint and keeps POSTing `{ id, activityId, token }` across
 * launches, so the backend has a fresh token even when the WebView isn't
 * running. The token is keyed by the logical `id`, joining it to the
 * registration the client sent to `register.ts`.
 */
function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!liveActivityStoreAvailable()) {
    return res.status(503).json({ error: "Live Activity store unavailable" });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (!isLiveActivityTokenPayload(body)) {
    return res.status(400).json({ error: "Invalid token payload" });
  }

  // Tie the token's TTL to the trip's arrival when we already know it.
  const reg = await getRegistration(body.id);
  await putToken(body.id, body.token, reg?.arrivalEpochMs);
  return res.status(204).end();
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
