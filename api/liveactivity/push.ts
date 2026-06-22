import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildContentState,
  encodeContentState,
} from "../../src/lib/liveActivityContent.js";
import {
  readApnsConfig,
  signApnsJwt,
  buildLiveActivityPayload,
  sendLiveActivityPush,
} from "../_apns.js";
import {
  computeLiveTripStatus,
  decidePushAction,
  type FeedTripUpdate,
} from "../_liveActivityStatus.js";
import {
  clearCachedApnsJwt,
  getCachedApnsJwt,
  getLastSent,
  getRegistration,
  getToken,
  listActiveIds,
  liveActivityStoreAvailable,
  removeActivity,
  setCachedApnsJwt,
  setLastSent,
} from "../_liveActivityStore.js";
import { fetchFeedCached } from "../_feedCache.js";
import { fetchGtfsRtBytes, decodeFeed } from "../_gtfsrt.js";
import {
  normalizeTripUpdates,
  TRIPUPDATES_FRESHNESS_MS,
} from "../_tripUpdatesFeed.js";

/**
 * Cron (scheduled HTTP hit) that corrects every registered Live Activity's
 * countdown from GTFS-RT while phones are locked. For each active activity it
 * re-derives the live arrival/delay, and pushes an `update` (delay, phase, or
 * cancellation changed) or `end` (arrived) via APNs — otherwise nothing, since
 * the native `Text(timerInterval:)` ticks on its own.
 *
 * Inert until configured: no Redis store, no APNs `.p8` credentials, or no
 * `CRON_SECRET` → 200 no-op. The secret is part of the "configured" check
 * (not just an optional guard) so that the push path can never be driven
 * anonymously once the APNs credentials exist.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const apns = readApnsConfig();
  if (!liveActivityStoreAvailable() || !apns || !secret) {
    return res.status(200).json({ ok: true, skipped: "not configured" });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const ids = await listActiveIds();
  if (ids.length === 0) return res.status(200).json({ ok: true, processed: 0 });

  let updates: FeedTripUpdate[];
  try {
    updates = await fetchTripUpdates();
  } catch (err) {
    console.warn(`[liveactivity] tripupdates fetch failed: ${String(err)}`);
    return res.status(502).json({ error: "Upstream feed unavailable" });
  }

  const now = Date.now();
  // Reuse one provider JWT across runs (Redis-cached, 45 min): APNs throttles
  // provider-token churn (TooManyProviderTokenUpdates), so a fresh signature
  // per 1-minute cron run would get pushes rejected.
  let jwt = await getCachedApnsJwt();
  if (!jwt) {
    jwt = signApnsJwt(apns, Math.floor(now / 1000));
    await setCachedApnsJwt(jwt);
  }
  let pushed = 0;
  let ended = 0;

  await Promise.all(
    ids.map(async (id) => {
      const [reg, token, lastSent] = await Promise.all([
        getRegistration(id),
        getToken(id),
        getLastSent(id),
      ]);
      // A registration without a token yet (token POST not arrived) — skip; the
      // native countdown still ticks. A registration that expired — clean up.
      if (!reg) return void (await removeActivity(id));
      if (!token) return;

      const status = computeLiveTripStatus({ reg, updates, now });
      if (!status) return;

      const { action, phase } = decidePushAction({ status, lastSent, now });
      if (action === "none") return;

      const content = buildContentState({
        departureEpochMs: status.departureEpochMs,
        arrivalEpochMs: status.arrivalEpochMs,
        delayMinutes: status.delayMinutes,
        nextStop: null,
        remainingStops: null,
        isCanceled: status.isCanceled,
        isEnded: action === "end",
        now,
      });
      const payload = buildLiveActivityPayload({
        event: action,
        contentState: encodeContentState(content),
        timestampSeconds: Math.floor(now / 1000),
        staleEpochMs: content.staleAfterEpochMs,
        dismissEpochMs: action === "end" ? status.arrivalEpochMs : undefined,
      });

      try {
        const result = await sendLiveActivityPush({
          config: apns,
          token,
          jwt,
          payload,
        });
        // 410 Gone / BadDeviceToken → the token is dead; stop tracking it.
        if (result.status === 410 || result.reason === "BadDeviceToken") {
          await removeActivity(id);
          return;
        }
        if (result.status >= 400) {
          // A bad cached JWT fails every push the same way — drop it so the next
          // run signs fresh. `ExpiredProviderToken` (age) is the routine case;
          // `InvalidProviderToken` (bad key/team/signature) clears it too so the
          // cron self-heals on the next run once the APNs credentials are fixed
          // (the JWT cache lives in Redis, surviving the fix's redeploy).
          if (
            result.reason === "ExpiredProviderToken" ||
            result.reason === "InvalidProviderToken"
          ) {
            await clearCachedApnsJwt();
          }
          console.warn(
            `[liveactivity] push ${id} → ${result.status} ${result.reason ?? ""}`,
          );
          return;
        }
      } catch (err) {
        console.warn(`[liveactivity] push ${id} threw: ${String(err)}`);
        return;
      }

      if (action === "end") {
        await removeActivity(id);
        ended += 1;
      } else {
        await setLastSent(
          id,
          {
            delayMinutes: status.delayMinutes,
            phase,
            isEnded: false,
            isCanceled: status.isCanceled,
          },
          status.arrivalEpochMs,
          now,
        );
        pushed += 1;
      }
    }),
  );

  return res.status(200).json({ ok: true, processed: ids.length, pushed, ended });
}

/** Read the normalized trip-updates IN-PROCESS, reusing the same Redis-backed
 *  511 cache the `/api/gtfsrt/tripupdates` endpoint serves. Avoids an HTTP
 *  round-trip to our own function — that cold-started a second instance and
 *  intermittently blew the cron's timeout, skipping whole runs. A cache hit is
 *  immediate; only a stale window pays the bounded upstream 511 fetch (which
 *  has its own timeout), and the upstream poll budget is unchanged. */
async function fetchTripUpdates(): Promise<FeedTripUpdate[]> {
  const { bytes } = await fetchFeedCached(
    "tripupdates",
    TRIPUPDATES_FRESHNESS_MS,
    () => fetchGtfsRtBytes("tripupdates"),
  );
  return normalizeTripUpdates(decodeFeed(bytes)).updates;
}
