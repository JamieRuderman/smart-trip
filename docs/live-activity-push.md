# Live Activity push backend (Phase 2)

Keeps the iOS Live Activity countdown corrected for GTFS-RT delays **while the
phone is locked** — when the app's JavaScript can't run, so only an APNs push
can update the activity. Phase 1 (the local countdown) ticks on its own and
self-corrects when the app is foregrounded; this closes the locked-screen gap.

This code is **inert until configured** — no Redis, no APNs key, or the
`VITE_LIVE_ACTIVITY_PUSH` flag unset → every entry point is a graceful no-op.

## How it works

```
client (start, push-enabled)                backend
─────────────────────────────              ─────────────────────────────────────
startActivityWithPush(id, …)  ── token ──▶  POST /api/liveactivity/token   (iOS posts automatically)
POST /api/liveactivity/register  ────────▶  store {id → registration} in Redis, add to la:active
                                            ┌───────────────────────────────────┐
                                            │ cron  /api/liveactivity/push (1/min)│
                                            │  for each active id:                │
                                            │   • GET /api/gtfsrt/tripupdates     │
                                            │   • computeLiveTripStatus(reg,feed) │
                                            │   • decidePushAction vs lastSent    │
                                            │   • APNs update/end → device token  │
                                            └───────────────────────────────────┘
clear / arrival → DELETE /api/liveactivity/register?id=…
```

- The **logical activity id** (`tripActivityId(...)` = trip + service date + a
  random slug) joins the client registration with the iOS-posted token. The
  slug makes the id unguessable — it is the *capability* protecting the record,
  since register/deregister are necessarily public endpoints (no accounts).
- `Text(timerInterval:)` ticks natively, so the cron only pushes when the
  **delay**, the **departure→arrival phase**, or **cancellation** changes, and an
  `end` once arrived. Unchanged state = no push (APNs throttles updates).
  Cancellation is detected two ways: from the matched trip update's
  `CANCELED` relationship, or — when 511 strips the cancelled run's stop
  updates entirely — by matching the feed `startTime` against the
  registration's `originStartTime` (the same fallback the client UI uses).
- The signed APNs provider JWT is **cached in Redis for 45 min** and reused
  across cron runs: APNs throttles provider-token churn
  (`TooManyProviderTokenUpdates`), so a fresh signature per 1-minute run would
  get pushes rejected. An `ExpiredProviderToken` response drops the cache.
- The content state pushed by the server is the **same** `Record<string,string>`
  the client sends (`encodeContentState`), so the widget decodes one shape.
- Registration is self-healing: the client re-POSTs it on every app boot
  (idempotent upsert), so a failed register at focus time (offline) is
  repaired at the next launch, and server-side TTLs are refreshed.
- Abuse bounds on the public endpoints: every string field is length-capped at
  validation, and new registrations are refused past **200 active activities**
  (re-registrations always pass), so junk can't grow the cron's fan-out or the
  Redis footprint unboundedly.

## Required to go live

### 1. Native widget — ✅ shipped (`ios/App/SmartTripWidget/`)
The `SmartTripWidget` extension target renders the lock-screen + Dynamic Island
UI. Its bundle id is **`smart.trip.SmartTripWidget`** — the APNs topic is
therefore `smart.trip.SmartTripWidget.push-type.liveactivity`. Remaining
Xcode-side work: confirm the signing team on the new target, and (for Phase 2)
enable the *Push Notifications* capability on the **App** target so ActivityKit
can mint update tokens.

### 2. APNs auth key
Create a **token-based** APNs key (`.p8`) in the Apple Developer portal
(Certificates, IDs & Profiles → Keys → enable *Apple Push Notifications service*).
You get a `.p8` file + a 10-char **Key ID**; the **Team ID** is `6YH3537ZY9`.

### 3. Environment variables (Vercel project settings)
| Var | Value |
| --- | --- |
| `APNS_KEY_ID` | the `.p8` Key ID |
| `APNS_TEAM_ID` | `6YH3537ZY9` |
| `APNS_PRIVATE_KEY` | the `.p8` PEM contents (newlines as literal `\n` are accepted) |
| `APNS_WIDGET_BUNDLE_ID` | `smart.trip.SmartTripWidget` |
| `APNS_HOST` | optional; defaults to `api.push.apple.com` (use `api.sandbox.push.apple.com` for dev builds) |
| `CRON_SECRET` | shared secret; the scheduler must send it as `Authorization: Bearer …`. **Required** — the push endpoint treats a missing secret as "not configured" and no-ops, so it can never run unauthenticated |
| `PUBLIC_BASE_URL` | optional; the cron's base for its internal `/api/gtfsrt/tripupdates` fetch (falls back to `VERCEL_URL`) |

Redis is already wired via the existing `KV_REST_API_URL` / `KV_REST_API_TOKEN`
(same Upstash integration the GTFS-RT cache uses).

### 4. Enable the client path
Build the native app with `VITE_LIVE_ACTIVITY_PUSH=1`. Until then the app uses
the Phase 1 local-only start (`startTripActivity`), so nothing registers.

### 5. Schedule the cron — **stay on the Vercel free (Hobby) plan**
`/api/liveactivity/push` is an ordinary, `CRON_SECRET`-protected function, so any
scheduler can drive it. **Do not use Vercel's built-in cron on Hobby:** it caps
cron jobs at *once per day* and an every-minute `crons` entry in `vercel.json`
**fails the deploy** ("Hobby accounts are limited to daily cron jobs"). That's
why there is no `crons` block in `vercel.json`.

Instead point a **free external scheduler** at the endpoint:

- **[cron-job.org](https://cron-job.org/en/)** (simplest — no code): add a job
  hitting `https://<your-app>/api/liveactivity/push` every 1 minute, with a
  custom header `Authorization: Bearer <CRON_SECRET>`. Free tier allows
  once-per-minute.
- **[Cloudflare Workers Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)**
  (free, reliable, 1-min): a few-line Worker that `fetch`es the endpoint with the
  same header on a `* * * * *` trigger.

Frequency is a cost/latency knob, not a correctness one: the native
`Text(timerInterval:)` keeps ticking between pushes, so **every 2–3 minutes** is
plenty (a newly-appearing delay reflects on the locked screen within that window)
and keeps you well inside free quotas. SMART delays don't change minute-to-minute.

> If you later move to Vercel **Pro**, you can instead add a `crons` block to
> `vercel.json` (`{ "path": "/api/liveactivity/push", "schedule": "* * * * *" }`)
> and drop the external scheduler — the endpoint is identical either way.

## Files

| Path | Role |
| --- | --- |
| `src/lib/liveActivityContent.ts` | platform-free content model + builders (shared client/server) |
| `src/lib/liveActivityPushTypes.ts` | registration / token types + validators (shared) |
| `src/lib/native/liveActivityPush.ts` | client: start-with-push + register / deregister (gated) |
| `api/_apns.ts` | APNs ES256 JWT, payload builder, HTTP/2 sender |
| `api/_liveActivityStore.ts` | Redis store (registration / token / last-sent / active set) |
| `api/_liveActivityStatus.ts` | pure live-status derivation + push decision |
| `api/liveactivity/register.ts` | register (POST) / deregister (DELETE) |
| `api/liveactivity/token.ts` | iOS token sink (`setUpdateTokenEndpoint` target) |
| `api/liveactivity/push.ts` | the cron |

## Verified vs pending

**Unit-tested** (pure logic): JWT signing/claims, APNs payload + topic, the
live-status matching/delay/phase derivation, the push decision, the Redis TTL
math, registration/token validation, and the client gating + register/deregister
calls.

**Not yet verifiable here** (needs the `.p8` key + the widget bundle id + a real
device): the live APNs HTTP/2 send and the end-to-end token round-trip. Validate
on a device once steps 1–4 are done — start a trip, lock the phone, and confirm a
delay injected into the feed moves the countdown.
