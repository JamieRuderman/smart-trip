# Live Activity cron (Cloudflare Worker)

The scheduler that drives the Live Activity push backend. It is the
"Cloudflare Workers Cron" option from
[`docs/live-activity-push.md`](../../docs/live-activity-push.md) §5.

**What it does:** on a cron trigger it sends a single authenticated `GET` to the
Vercel function `/api/liveactivity/push`. That endpoint holds all the logic —
re-deriving each registered activity's live arrival/delay from GTFS-RT and
sending the APNs `update`/`end` that powers the lock-screen + Dynamic Island
`departing → arriving → dismiss` transitions while the phone is locked. This
Worker is pure plumbing; it carries no trip logic and no Apple credentials.

Why a separate Worker instead of `vercel.json` crons: Vercel's built-in cron is
capped at **once per day** on the Hobby plan (an every-minute `crons` entry
fails the deploy), so the push endpoint is designed to be poked by any external
scheduler that can send `Authorization: Bearer <CRON_SECRET>`. Cloudflare's cron
triggers are free and run at 1-minute granularity.

## Deploy

Prereqs: a Cloudflare account and the push endpoint already live on Vercel with
its `CRON_SECRET` set (see the main doc §3).

```sh
cd workers/liveactivity-cron
npm install

# 1. Point the Worker at your deployed endpoint: edit PUSH_ENDPOINT_URL in
#    wrangler.toml (or pass --var PUSH_ENDPOINT_URL:https://… at deploy).

# 2. Set the shared secret (must equal CRON_SECRET on the Vercel project).
#    Stored encrypted by Cloudflare; never committed.
npx wrangler secret put CRON_SECRET

# 3. Ship it.
npx wrangler deploy
```

## Configuration

| Binding | Where | Purpose |
| --- | --- | --- |
| `PUSH_ENDPOINT_URL` | `[vars]` in `wrangler.toml` | full URL of `/api/liveactivity/push` |
| `CRON_SECRET` | `wrangler secret put` | bearer secret; must match the Vercel project's `CRON_SECRET` |

Schedule lives in `wrangler.toml` under `[triggers].crons` (default
`*/2 * * * *`). Frequency is a latency/cost knob, not a correctness one — the
native `Text(timerInterval:)` keeps ticking between pushes.

## Verify

```sh
# Tail live logs, then wait for the next tick (or trigger manually below).
npx wrangler tail

# Manual trigger / health check — same bearer the cron uses; returns the
# upstream status/body. A bare GET (no header) returns 401, so the Worker
# can't be used as an open relay.
curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-worker-subdomain>.workers.dev
```

A healthy run logs `"[cron] push 200: {…"ok":true…}"`. The endpoint itself
no-ops (`{"ok":true,"skipped":"not configured"}`) until the APNs key, Redis
store, and `CRON_SECRET` are all configured on Vercel — see the main doc.
