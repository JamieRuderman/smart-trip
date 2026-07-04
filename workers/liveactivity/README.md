# smart-trip-liveactivity — Live Activity Durable Object Worker

Implements `TripActivityDO`, the per-activity Durable Object that drives
**exact-time** Live Activity push transitions (APNs) via the DO Alarms API.
See `docs/live-activity-push.md` for the full architecture.

## Why a separate Worker?

Cloudflare **does not generate Preview URLs for Workers that implement a
Durable Object**. Keeping the DO here — and having `smart-trip-web` reach it
through a cross-script binding (`script_name = "smart-trip-liveactivity"` in
the root `wrangler.toml`) — is what makes per-version preview builds of the
web Worker possible.

- **No public surface**: no routes, `workers_dev = false`. The only way in is
  the binding; the public `/api/liveactivity/*` routes live in
  `workers/web/src/index.ts` and proxy here via `stub.fetch()`.
- **State**: the original Durable Objects (registrations, tokens, pending
  alarms) were carried over from `smart-trip-web` with a `transferred_classes`
  migration (see `wrangler.toml` here).

## Deploy

Deployed **manually** — it changes rarely and is not connected to Workers
Builds:

```sh
npx wrangler deploy --config workers/liveactivity/wrangler.toml
```

## Secrets

Set on THIS Worker (the web Worker no longer needs the APNs creds):

```sh
npx wrangler secret put APNS_KEY_ID          --config workers/liveactivity/wrangler.toml
npx wrangler secret put APNS_PRIVATE_KEY     --config workers/liveactivity/wrangler.toml
npx wrangler secret put TRANSIT_511_API_KEY  --config workers/liveactivity/wrangler.toml
```

`APNS_APP_ID` / `APNS_TEAM_ID` are plain vars in `wrangler.toml` (not secret).
The DO reads the 511 feed natively (`workers/web/src/lib/gtfsrt.ts`, shared
source), hence the `TRANSIT_511_API_KEY` secret here too.
