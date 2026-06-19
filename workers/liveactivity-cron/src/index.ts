/**
 * Cloudflare Worker cron for the SMART-trip Live Activity push backend.
 *
 * All the real work — re-deriving every registered activity's live
 * arrival/delay from GTFS-RT and sending the APNs `update`/`end` that drives
 * the lock-screen + Dynamic Island `departing → arriving → dismiss`
 * transitions — lives in the Vercel function `/api/liveactivity/push` (see
 * docs/live-activity-push.md). That endpoint is an ordinary,
 * `CRON_SECRET`-protected HTTP handler; it just needs *something* to hit it on
 * a schedule. Vercel's own cron caps at once-per-day on the Hobby plan, so this
 * Worker is that scheduler.
 *
 * It does nothing but GET the endpoint with the shared bearer secret on its
 * cron trigger (and, optionally, on an authenticated manual request). All
 * correctness is server-side; this is pure plumbing.
 */

export interface Env {
  /** Full URL of the push endpoint, e.g.
   *  `https://smart-trip.example/api/liveactivity/push`. Set in wrangler.toml. */
  PUSH_ENDPOINT_URL: string;
  /** Shared secret the endpoint checks as `Authorization: Bearer …`. Must equal
   *  the `CRON_SECRET` on the Vercel project. Set with
   *  `npx wrangler secret put CRON_SECRET` (never commit it). */
  CRON_SECRET: string;
}

/** Hit the push endpoint once with the bearer secret. Returns the upstream
 *  response so the manual `fetch` path can surface it; logs either way. Never
 *  throws — a throw in `scheduled` just makes Cloudflare retry the tick, which
 *  would pile up duplicate pushes on a transient upstream blip. */
async function triggerPush(env: Env): Promise<Response> {
  if (!env.PUSH_ENDPOINT_URL || !env.CRON_SECRET) {
    console.error(
      "[cron] missing PUSH_ENDPOINT_URL or CRON_SECRET binding; skipping",
    );
    return new Response("not configured", { status: 500 });
  }
  try {
    const res = await fetch(env.PUSH_ENDPOINT_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const body = await res.text();
    const snippet = body.slice(0, 500);
    if (res.ok) {
      console.log(`[cron] push ${res.status}: ${snippet}`);
    } else {
      console.error(`[cron] push FAILED ${res.status}: ${snippet}`);
    }
    return new Response(body, { status: res.status });
  } catch (err) {
    console.error(`[cron] push request threw: ${String(err)}`);
    return new Response("upstream error", { status: 502 });
  }
}

export default {
  /** Cron trigger — the schedule lives in wrangler.toml (`[triggers].crons`). */
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(triggerPush(env).then(() => undefined));
  },

  /** Manual trigger / health check. Requires the same bearer secret so the
   *  Worker can't be used as an open relay to spam the push endpoint. */
  async fetch(req: Request, env: Env): Promise<Response> {
    const auth = req.headers.get("authorization");
    if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
      return new Response("unauthorized", { status: 401 });
    }
    return triggerPush(env);
  },
} satisfies ExportedHandler<Env>;
