# Live Activity push backend

Keeps the iOS Live Activity countdown corrected for GTFS-RT delays **while the
phone is locked** — when the app's JavaScript can't run, so only an APNs push
can update the activity. The local countdown ticks on its own and self-corrects
when the app is foregrounded; this closes the locked-screen gap.

This code is **inert until configured** — no APNs key, or the
`VITE_LIVE_ACTIVITY_PUSH` flag unset → every entry point is a graceful no-op.

## How it works

The backend is a Cloudflare **Durable Object** (`TripActivityDO`,
`workers/liveactivity/src/do/tripActivity.ts`, deployed as its own
`smart-trip-liveactivity` Worker and reached from `smart-trip-web` via a
cross-script binding): one instance per activity id, driving
**exact-time** transitions via the DO Alarms API — no polling cron, no Redis.

```
client (start, push-enabled)               Cloudflare Worker + Durable Object
─────────────────────────────             ──────────────────────────────────────
startActivityWithPush(id, …) ── token ──▶  POST /api/liveactivity/token
POST /api/liveactivity/register ────────▶  → TripActivityDO(idFromName(id))
                                           ┌──────────────────────────────────┐
                                           │ DO alarm (exact-time + ~90s poll) │
                                           │  • getTripUpdates() (edge cache)  │
                                           │  • computeLiveTripStatus(reg,feed)│
                                           │  • decidePushAction vs lastSent   │
                                           │  • APNs update/end → device token │
                                           └──────────────────────────────────┘
clear / arrival → DELETE /api/liveactivity/register?id=…   (or the DO ends it)
```

- One **Durable Object per activity id** (`idFromName(reg.id)`) holds exactly
  that activity's registration, token, last-sent state, and cached provider JWT
  in DO storage — no shared store.
- The DO wakes via the **Alarms API** precisely at the (live, delay-adjusted)
  departure instant (the departing→arriving flip) and arrival instant (the
  end/dismissal), and re-checks the feed every ~90s in between so a
  newly-appearing delay still lands. That gives exact-time transitions instead
  of the up-to-2-min latency a poll-cron had.
- The **logical activity id** (`tripActivityId(...)` = trip + service date + a
  random slug) joins the client registration with the iOS-posted token. The
  slug makes the id unguessable — it is the *capability* protecting the record,
  since register/deregister are necessarily public endpoints (no accounts).
- `Text(timerInterval:)` ticks natively, so the DO only pushes when the
  **delay**, the **departure→arrival phase**, or **cancellation** changes, and an
  `end` once arrived. Unchanged state = no push (APNs throttles updates).
  Cancellation is detected two ways: from the matched trip update's `CANCELED`
  relationship, or — when 511 strips the cancelled run's stop updates entirely —
  by matching the feed `startTime` against the registration's `originStartTime`.
- The signed APNs provider JWT is **cached in DO storage for ~40 min** and
  reused across ticks: APNs throttles provider-token churn
  (`TooManyProviderTokenUpdates`), so a fresh signature per tick would get
  pushes rejected. An `ExpiredProviderToken` / `InvalidProviderToken` response
  drops the cache so the next tick signs fresh.
- The content state pushed by the server is the **same** `Record<string,string>`
  the client sends (`encodeContentState`), so the widget decodes one shape.
- Registration is self-healing: the client re-POSTs it on every app boot
  (idempotent upsert), so a failed register at focus time (offline) is repaired
  at the next launch.

## Required to go live

### 1. Native widget — ✅ shipped (`ios/App/SmartTripWidget/`)
The `SmartTripWidget` extension renders the lock-screen + Dynamic Island UI; its
own bundle id is **`smart.trip.widget`**. The APNs topic, however, is built from
the **app**'s bundle id, *not* the widget's: ActivityKit Live Activity pushes use
`<app-bundle-id>.push-type.liveactivity`, i.e.
**`smart.trip.push-type.liveactivity`** (Apple WWDC23 "Update Live Activities
with push notifications").

### 2. APNs auth key
Create a **token-based** APNs key (`.p8`) in the Apple Developer portal
(Certificates, IDs & Profiles → Keys → enable *Apple Push Notifications service*).
You get a `.p8` file + a 10-char **Key ID**; the **Team ID** is `6YH3537ZY9`.

### 3. Cloudflare Worker config
APNs topic identifiers live in `wrangler.toml` `[vars]` (`APNS_APP_ID`,
`APNS_TEAM_ID`); the `.p8` **Key ID** and **private key** are **secrets**, set
out-of-band and never committed:

```sh
npx wrangler secret put APNS_KEY_ID
npx wrangler secret put APNS_PRIVATE_KEY
```

| Var | Value |
| --- | --- |
| `APNS_KEY_ID` | the `.p8` Key ID (**secret**) |
| `APNS_PRIVATE_KEY` | the `.p8` PEM contents — newlines as literal `\n` accepted (**secret**) |
| `APNS_TEAM_ID` | `6YH3537ZY9` |
| `APNS_APP_ID` | `smart.trip` — the **app** bundle id (ActivityKit's Live Activity topic is the app's id, *not* the widget's `smart.trip.widget`). The DO appends `.push-type.liveactivity`, yielding `smart.trip.push-type.liveactivity` |
| `APNS_HOST` | optional; the gateway tried **first** (defaults to production `api.push.apple.com`). The DO falls back to the other gateway on `BadDeviceToken`, so one backend serves **both** sandbox (dev/Xcode builds) and production (TestFlight/App Store) tokens — no need to flip this per build type |

### 4. Enable the client path
Build the native app with `VITE_LIVE_ACTIVITY_PUSH=1`. Until then the app uses
the local-only start (`startTripActivity`), so nothing registers.

## Files

| Path | Role |
| --- | --- |
| `src/lib/liveActivityContent.ts` | platform-free content model + builders (shared client/server) |
| `src/lib/liveActivityPushTypes.ts` | registration / token types + validators (shared) |
| `src/lib/native/liveActivityPush.ts` | client: start-with-push + register / deregister (gated) |
| `api/_liveActivityStatus.ts` | pure live-status derivation + push decision (shared) |
| `workers/web/src/index.ts` | `/api/liveactivity/{register,token}` routes → the Durable Object |
| `workers/liveactivity/src/do/tripActivity.ts` | the Durable Object: alarms, feed re-check, push decision, lifecycle |
| `workers/liveactivity/src/lib/apns.ts` | APNs ES256 JWT (WebCrypto) + payload builder + `fetch()` HTTP/2 sender |

## Verified vs pending

**Unit-tested** (pure logic): the APNs payload + topic, the live-status
matching/delay/phase derivation, the push decision, the per-tick plan
(`planTick`), the alarm scheduling (`nextWake`), and registration/token
validation.

**Validated on device**: the live APNs send and the end-to-end token round-trip
— start a trip, lock the phone, and confirm the countdown flips to a delay (gold)
and the activity dismisses on arrival.
