/**
 * Durable Object that owns ONE Live Activity's lifecycle on Cloudflare — the
 * native replacement for the Vercel poll-cron, giving **exact-time** transitions
 * instead of up-to-2-min latency.
 *
 * It wakes via the DO Alarms API precisely at the departure instant (the
 * departing→arriving flip) and the arrival instant (the end/dismissal), and
 * re-checks the feed every `POLL_MS` in between so a newly-appearing delay still
 * lands. All the matching/decision/content logic is the SAME pure code the Vercel
 * backend uses (`computeLiveTripStatus`, `decidePushAction`, `buildContentState`)
 * — only the APNs transport is Workers-native (`../lib/apns`).
 *
 * One DO instance per activity id (`idFromName(reg.id)`), so its storage holds
 * exactly that activity's registration, token, last-sent state, and cached
 * provider JWT — no shared Redis needed.
 */
import {
  computeLiveTripStatus,
  decidePushAction,
  type FeedTripUpdate,
} from "../../../../api/_liveActivityStatus.js";
import {
  buildContentState,
  encodeContentState,
} from "../../../../src/lib/liveActivityContent.js";
import type { LiveActivityRegistration } from "../../../../src/lib/liveActivityPushTypes.js";
import {
  alternateApnsHost,
  buildLiveActivityPayload,
  readApnsConfig,
  sendLiveActivityPush,
  signApnsJwt,
  type ApnsConfig,
  type ApnsEnv,
} from "../lib/apns.js";

/** Env visible to the DO (Worker bindings): APNs creds + where to read the feed. */
export interface DoEnv extends ApnsEnv {
  API_ORIGIN: string;
}

/** Minimal structural types for the DO runtime APIs we use, so this compiles
 *  without pulling in @cloudflare/workers-types. */
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface LastSent {
  delayMinutes: number;
  phase: "pre-departure" | "en-route";
  isEnded: boolean;
  isCanceled: boolean;
}

/** Feed re-check cadence BETWEEN the exact boundaries. The native countdown
 *  ticks on its own, so ~90s is ample for delay drift; the transitions stay
 *  exact because we also wake right on each boundary. */
const POLL_MS = 90_000;
/** Reuse a signed provider JWT this long — APNs throttles provider-token churn
 *  (TooManyProviderTokenUpdates) and rejects tokens older than 1h. */
const JWT_TTL_MS = 40 * 60_000;

export class TripActivityDO {
  private state: DurableObjectState;
  private env: DoEnv;

  constructor(state: DurableObjectState, env: DoEnv) {
    this.state = state;
    this.env = env;
  }

  /** Internal control surface, called by the front Worker via a DO stub. */
  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    switch (pathname) {
      case "/register": {
        const reg = (await req.json()) as LiveActivityRegistration;
        await this.state.storage.put("reg", reg);
        await this.ensureScheduled();
        return Response.json({ ok: true });
      }
      case "/token": {
        const { token } = (await req.json()) as { token: string };
        await this.state.storage.put("token", token);
        await this.ensureScheduled();
        return Response.json({ ok: true });
      }
      case "/deregister": {
        await this.stop();
        return Response.json({ ok: true });
      }
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /** Ensure an alarm is pending no later than the next wake. */
  private async ensureScheduled(): Promise<void> {
    const reg = await this.state.storage.get<LiveActivityRegistration>("reg");
    if (!reg) return;
    const next = nextWake(reg, Date.now());
    const current = await this.state.storage.getAlarm();
    if (current == null || current > next) await this.state.storage.setAlarm(next);
  }

  /** The alarm tick: derive live status, push a flip / delay update / end as
   *  needed, then reschedule. Mirrors the Vercel cron's per-activity body. */
  async alarm(): Promise<void> {
    const reg = await this.state.storage.get<LiveActivityRegistration>("reg");
    if (!reg) return; // deregistered between scheduling and firing
    const config = readApnsConfig(this.env);
    if (!config) return; // unconfigured → no-op (and no reschedule spin)

    const now = Date.now();
    const updates = await this.fetchUpdates();
    // computeLiveTripStatus returns a terminal `ended` status once a run is gone
    // from the feed AND past arrival (api/_liveActivityStatus.ts), so the DO ends
    // the activity even after 511 prunes the finished run.
    const status = updates ? computeLiveTripStatus({ reg, updates, now }) : null;

    if (status) {
      const lastSent = (await this.state.storage.get<LastSent>("lastSent")) ?? null;
      const { action, phase } = decidePushAction({ status, lastSent, now });
      if (action !== "none") {
        const token = await this.state.storage.get<string>("token");
        if (!token) {
          // Arrived without ever receiving a token → nothing to dismiss; stop.
          if (action === "end") return void (await this.stop());
        } else {
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
          const outcome = await this.push(config, token, payload);
          if (outcome === "dead-token") return void (await this.stop());
          if (outcome === "ok") {
            if (action === "end") return void (await this.stop());
            await this.state.storage.put<LastSent>("lastSent", {
              delayMinutes: status.delayMinutes,
              phase,
              isEnded: false,
              isCanceled: status.isCanceled,
            });
          }
          // "retry": leave lastSent as-is; the next alarm tries again.
        }
      }
    }

    await this.state.storage.setAlarm(nextWake(reg, Date.now()));
  }

  /** Normalized trip-updates from the existing backend; null on failure (leave
   *  the countdown ticking, retry next alarm). Reuses the Vercel feed cache. */
  private async fetchUpdates(): Promise<FeedTripUpdate[] | null> {
    try {
      const res = await fetch(`${this.env.API_ORIGIN}/api/gtfsrt/tripupdates`);
      if (!res.ok) return null;
      const body = (await res.json()) as { updates?: FeedTripUpdate[] };
      return body.updates ?? null;
    } catch {
      return null;
    }
  }

  /** Send a push, trying the configured gateway then the other on
   *  BadDeviceToken (sandbox vs production; the provider JWT is valid for both). */
  private async push(
    config: ApnsConfig,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<"ok" | "dead-token" | "retry"> {
    const jwt = await this.providerJwt(config);
    let result: Awaited<ReturnType<typeof sendLiveActivityPush>> | undefined;
    for (const host of [config.host, alternateApnsHost(config.host)]) {
      result = await sendLiveActivityPush({ config: { ...config, host }, token, jwt, payload });
      if (result.status < 400 || result.reason !== "BadDeviceToken") break;
    }
    if (!result) return "retry";
    if (result.status === 410 || result.reason === "BadDeviceToken") return "dead-token";
    if (result.status >= 400) {
      // A bad cached JWT fails every push the same way — drop it so the next
      // tick signs fresh (expired = routine; invalid = creds were just fixed).
      if (result.reason === "ExpiredProviderToken" || result.reason === "InvalidProviderToken") {
        await this.state.storage.delete("jwt");
      }
      return "retry";
    }
    return "ok";
  }

  /** Cached provider JWT in the DO's own storage (the Redis-cache equivalent). */
  private async providerJwt(config: ApnsConfig): Promise<string> {
    const cached = await this.state.storage.get<{ jwt: string; iatMs: number }>("jwt");
    if (cached && Date.now() - cached.iatMs < JWT_TTL_MS) return cached.jwt;
    const jwt = await signApnsJwt(config, Math.floor(Date.now() / 1000));
    await this.state.storage.put("jwt", { jwt, iatMs: Date.now() });
    return jwt;
  }

  /** Tear down: cancel the alarm and wipe this activity's state. */
  private async stop(): Promise<void> {
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
  }
}

/** Next wake: the nearer of the upcoming boundary (departure, then arrival) and
 *  a poll tick — so transitions fire EXACTLY on the boundary while a delay is
 *  still re-checked every POLL_MS. Past arrival it keeps polling (not a hot
 *  loop) until the feed confirms the run ended, at which point `alarm()` stops. */
function nextWake(reg: LiveActivityRegistration, now: number): number {
  const poll = now + POLL_MS;
  if (now < reg.departureEpochMs) return Math.min(reg.departureEpochMs, poll);
  if (now < reg.arrivalEpochMs) return Math.min(reg.arrivalEpochMs, poll);
  return poll;
}
