/**
 * Durable Object that owns ONE Live Activity's lifecycle on Cloudflare — the
 * native replacement for the Vercel poll-cron, giving **exact-time** transitions
 * instead of up-to-2-min latency.
 *
 * It wakes via the DO Alarms API precisely at the (live, delay-adjusted)
 * departure instant (the departing→arriving flip) and arrival instant (the
 * end/dismissal), and re-checks the feed every `POLL_MS` in between so a
 * newly-appearing delay still lands. All the matching/decision/content logic is
 * the SAME pure code the Vercel backend uses — only the APNs transport is
 * Workers-native (`../lib/apns`).
 *
 * The per-tick decision (`planTick`) is a PURE function (no storage/network), so
 * it's unit-tested directly; the class is a thin shell that does the storage I/O
 * and APNs send around it.
 *
 * One DO instance per activity id (`idFromName(reg.id)`), so its storage holds
 * exactly that activity's registration, token, last-sent state, and cached
 * provider JWT — no shared Redis needed.
 */
import {
  ARRIVED_DROP_GRACE_MS,
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
import { getTripUpdates, type GtfsRtEnv } from "../lib/gtfsrt.js";

/** Env visible to the DO (Worker bindings): APNs creds + the native 511/KV feed. */
export interface DoEnv extends ApnsEnv, GtfsRtEnv {}

export interface LastSent {
  delayMinutes: number;
  phase: "pre-departure" | "en-route";
  isEnded: boolean;
  isCanceled: boolean;
  /** Arrival instant the widget is currently counting down to (the last value we
   *  pushed). The `end` dismisses to THIS, not the latest feed arrival, so iOS
   *  removes the activity exactly when the on-screen countdown reaches 0:00. */
  arrivalEpochMs: number;
}

/** Feed re-check cadence BETWEEN the exact boundaries. A Durable Object has one
 *  alarm slot, so each scheduled alarm wakes for whichever independent concern
 *  is next: the boundary timer or this feed-refresh timer. */
export const POLL_MS = 90_000;
/** Reuse a signed provider JWT this long — APNs throttles provider-token churn
 *  (TooManyProviderTokenUpdates) and rejects tokens older than 1h. */
const JWT_TTL_MS = 40 * 60_000;

/**
 * Next wake: the nearer of the upcoming boundary (departure, then arrival) and
 * a poll tick. These are conceptually separate timers, but the DO Alarms API
 * only stores one timestamp, so the persisted alarm is the one that happens
 * first. Callers pass the LIVE/displayed instants when known, so a slipped
 * departure or arrival still transitions on time.
 */
export function nextWake(
  departureEpochMs: number,
  arrivalEpochMs: number,
  now: number,
): number {
  const poll = now + POLL_MS;
  if (now < departureEpochMs) return Math.min(departureEpochMs, poll);
  if (now < arrivalEpochMs) return Math.min(arrivalEpochMs, poll);
  return poll;
}

export interface TickInput {
  reg: LiveActivityRegistration;
  token: string | null;
  lastSent: LastSent | null;
  /** Normalized feed, or null when the fetch failed. Past the displayed arrival
   *  grace, null is treated as terminal so the activity can't stick at 0:00. */
  updates: FeedTripUpdate[] | null;
  now: number;
}

export interface TickPlan {
  /** A push to send, or null when nothing changed / can't push. */
  push: { event: "update" | "end"; payload: Record<string, unknown> } | null;
  /** lastSent to persist AFTER a successful non-end push (null = leave as-is). */
  lastSent: LastSent | null;
  /** Tear down after this tick (ended, or arrived with no token to dismiss). */
  stop: boolean;
  /** Absolute epoch ms to wake next (ignored when `stop`). */
  nextAlarm: number;
}

/**
 * Decide what to do for one tick — PURE (no I/O). Derives the live status, picks
 * the push (flip / delay update / end) via the shared `decidePushAction`, and
 * schedules the next wake against the LIVE instants so transitions stay exact
 * under delay. The DO shell sends `push` and persists `lastSent`/`stop` based on
 * the actual APNs outcome.
 */
export function planTick(input: TickInput): TickPlan {
  const { reg, token, lastSent, updates, now } = input;
  const fallbackDelayMs = Math.max(0, lastSent?.delayMinutes ?? 0) * 60_000;
  const fallbackDepartureEpochMs = reg.departureEpochMs + fallbackDelayMs;
  const displayedArrivalEpochMs = lastSent?.arrivalEpochMs ?? reg.arrivalEpochMs;
  const status = updates
    ? computeLiveTripStatus({ reg, updates, now })
    : now >= displayedArrivalEpochMs + ARRIVED_DROP_GRACE_MS
      ? {
          departureEpochMs: fallbackDepartureEpochMs,
          arrivalEpochMs: displayedArrivalEpochMs,
          delayMinutes: Math.max(0, lastSent?.delayMinutes ?? 0),
          isCanceled: lastSent?.isCanceled ?? false,
          isEnded: true,
        }
      : null;

  // Schedule against live instants when the feed is available, else the last
  // displayed targets we pushed (falling back to the registration's schedule).
  const nextAlarm = nextWake(
    status?.departureEpochMs ?? fallbackDepartureEpochMs,
    status?.arrivalEpochMs ?? displayedArrivalEpochMs,
    now,
  );

  if (!status) return { push: null, lastSent: null, stop: false, nextAlarm };

  const { action, phase } = decidePushAction({ status, lastSent, now });
  if (action === "none") return { push: null, lastSent: null, stop: false, nextAlarm };

  // If the feed says the train arrived a few seconds before the arrival time we
  // last pushed to the widget, wait until the visible countdown reaches 0:00.
  // Sending an ActivityKit `end` with a future dismissal-date can leave iOS in a
  // frozen terminal render; ending at the displayed boundary removes it cleanly.
  const arrivalForView =
    action === "end" ? displayedArrivalEpochMs : status.arrivalEpochMs;
  if (action === "end" && now < arrivalForView) {
    return { push: null, lastSent: null, stop: false, nextAlarm: arrivalForView };
  }

  if (!token) {
    // Can't push: if it has ended there's nothing to dismiss → stop; else wait
    // for the token (the /token route reschedules us when it arrives).
    return { push: null, lastSent: null, stop: action === "end", nextAlarm };
  }

  // On `end`, dismiss to the arrival the widget is DISPLAYING (last pushed), so
  // iOS removes the activity exactly when the on-screen countdown hits 0:00 —
  // not a few seconds early when the live feed arrival has jittered ahead of
  // what the user last saw. iOS holds the (frozen) activity until this instant.
  const content = buildContentState({
    departureEpochMs: status.departureEpochMs,
    arrivalEpochMs: arrivalForView,
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
    dismissEpochMs: action === "end" ? arrivalForView : undefined,
  });

  if (action === "end") {
    return { push: { event: "end", payload }, lastSent: null, stop: true, nextAlarm };
  }
  return {
    push: { event: "update", payload },
    lastSent: {
      delayMinutes: status.delayMinutes,
      phase,
      isEnded: false,
      isCanceled: status.isCanceled,
      arrivalEpochMs: status.arrivalEpochMs,
    },
    stop: false,
    nextAlarm,
  };
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
        await this.ensureScheduled(reg);
        return Response.json({ ok: true });
      }
      case "/token": {
        const { token } = (await req.json()) as { token: string };
        await this.state.storage.put("token", token);
        const reg = await this.state.storage.get<LiveActivityRegistration>("reg");
        if (reg) await this.ensureScheduled(reg);
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

  /** Ensure an alarm is pending no later than the next scheduled-time wake. */
  private async ensureScheduled(reg: LiveActivityRegistration): Promise<void> {
    const next = nextWake(reg.departureEpochMs, reg.arrivalEpochMs, Date.now());
    const current = await this.state.storage.getAlarm();
    if (current == null || current > next) await this.state.storage.setAlarm(next);
  }

  /** The alarm tick: plan (pure), send any push, persist, reschedule. */
  async alarm(): Promise<void> {
    const reg = await this.state.storage.get<LiveActivityRegistration>("reg");
    if (!reg) return; // deregistered between scheduling and firing
    const config = readApnsConfig(this.env);
    if (!config) {
      console.warn(`[la] ${reg.id} alarm fired but APNs is not configured`);
      return; // unconfigured → no-op (and no reschedule spin)
    }

    try {
      const now = Date.now();
      const [token, lastSent, updates] = await Promise.all([
        this.state.storage.get<string>("token"),
        this.state.storage.get<LastSent>("lastSent"),
        this.fetchUpdates(),
      ]);

      const plan = planTick({
        reg,
        token: token ?? null,
        lastSent: lastSent ?? null,
        updates,
        now,
      });

      console.log(
        `[la] ${reg.id} tick action=${plan.push?.event ?? "none"} stop=${plan.stop} hasToken=${!!token}`,
      );

      if (plan.push && token) {
        const outcome = await this.push(config, token, plan.push.payload);
        console.log(`[la] ${reg.id} push ${plan.push.event} -> ${outcome}`);
        if (outcome === "dead-token") return void (await this.stop());
        if (outcome === "ok") {
          if (plan.stop) return void (await this.stop());
          if (plan.lastSent) await this.state.storage.put("lastSent", plan.lastSent);
        }
        // "retry" → fall through to reschedule; lastSent unchanged.
      } else if (plan.stop) {
        return void (await this.stop());
      }

      await this.state.storage.setAlarm(plan.nextAlarm);
    } catch {
      // Never let a transient feed/APNs error permanently stall the loop. (DO
      // alarms auto-retry on throw, but reschedule a poll so the cadence holds.)
      await this.state.storage.setAlarm(Date.now() + POLL_MS);
    }
  }

  /** Normalized trip-updates read IN-PROCESS via the native 511 + edge cache
   *  path (no Vercel round-trip); null on failure (retry next alarm, with a
   *  terminal fallback in `planTick`). The edge Cache API means the DO and the
   *  /api/gtfsrt/tripupdates route share one 511 poll budget. */
  private async fetchUpdates(): Promise<FeedTripUpdate[] | null> {
    try {
      const { updates } = await getTripUpdates(this.env);
      return updates;
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
      console.log(`[la] apns ${host} -> ${result.status} ${result.reason ?? ""}`);
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
