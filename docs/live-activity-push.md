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

- The **logical activity id** (`tripActivityId(tripNumber, serviceDate)`) joins
  the client registration with the iOS-posted token.
- `Text(timerInterval:)` ticks natively, so the cron only pushes when the
  **delay**, the **departure→arrival phase**, or **cancellation** changes, and an
  `end` once arrived. Unchanged state = no push (APNs throttles updates).
- The content state pushed by the server is the **same** `Record<string,string>`
  the client sends (`encodeContentState`), so the widget decodes one shape.

## Required to go live

### 1. Native widget (the Mac/Xcode work from Phase 1's plan)
The widget extension must exist and render a real Live Activity before any token
is minted. Note its **bundle id** (e.g. `smart.trip.SmartTripWidget`) — the APNs
topic is `<widget-bundle-id>.push-type.liveactivity`.

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
| `APNS_WIDGET_BUNDLE_ID` | the widget bundle id |
| `APNS_HOST` | optional; defaults to `api.push.apple.com` (use `api.sandbox.push.apple.com` for dev builds) |
| `CRON_SECRET` | shared secret; Vercel sends it as `Authorization: Bearer …` to the cron |
| `PUBLIC_BASE_URL` | optional; the cron's base for its internal `/api/gtfsrt/tripupdates` fetch (falls back to `VERCEL_URL`) |

Redis is already wired via the existing `KV_REST_API_URL` / `KV_REST_API_TOKEN`
(same Upstash integration the GTFS-RT cache uses).

### 4. Enable the client path
Build the native app with `VITE_LIVE_ACTIVITY_PUSH=1`. Until then the app uses
the Phase 1 local-only start (`startTripActivity`), so nothing registers.

### 5. Cron
`vercel.json` schedules `/api/liveactivity/push` every minute. **Minute-level
crons require a Vercel Pro plan**; on Hobby, lengthen the schedule (the countdown
still ticks natively between pushes).

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
