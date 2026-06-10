import { Redis } from "@upstash/redis";
import type {
  LiveActivityRegistration,
} from "../src/lib/liveActivityPushTypes.js";

/**
 * Redis-backed store for the Live Activity push backend (Phase 2). Holds, per
 * logical activity id: the trip registration, the iOS-posted APNs token, and
 * the last delay we pushed (so the cron only pushes on change). A set of active
 * ids lets the cron enumerate what to poll.
 *
 * Mirrors `_feedCache.ts`: the same Vercel↔Upstash connection, and a graceful
 * null when unconfigured so the endpoints degrade to no-ops in local dev.
 */
const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

/** Records are TTL'd to arrival + this grace so a finished/abandoned activity
 *  expires itself even if the end call never arrives. Seconds. */
const RECORD_GRACE_SECONDS = 60 * 60;

export const regKey = (id: string) => `la:reg:${id}`;
export const tokenKey = (id: string) => `la:tok:${id}`;
export const sentKey = (id: string) => `la:sent:${id}`;
export const ACTIVE_SET = "la:active";

/** Last delay/phase we pushed, so the cron can diff and skip no-ops. */
export interface LastSent {
  delayMinutes: number;
  phase: "pre-departure" | "en-route";
  isEnded: boolean;
}

/** TTL (seconds) from now until `arrivalEpochMs` + grace, floored at the grace
 *  so an already-arrived registration still lingers briefly. Pure. */
export function recordTtlSeconds(
  arrivalEpochMs: number,
  now: number,
  graceSeconds = RECORD_GRACE_SECONDS,
): number {
  const untilArrival = Math.ceil((arrivalEpochMs - now) / 1000);
  return Math.max(graceSeconds, untilArrival + graceSeconds);
}

export function liveActivityStoreAvailable(): boolean {
  return redis != null;
}

export async function putRegistration(
  reg: LiveActivityRegistration,
  now = Date.now(),
): Promise<void> {
  if (!redis) return;
  const ttl = recordTtlSeconds(reg.arrivalEpochMs, now);
  await Promise.all([
    redis.set(regKey(reg.id), reg, { ex: ttl }),
    redis.sadd(ACTIVE_SET, reg.id),
  ]);
}

export async function getRegistration(
  id: string,
): Promise<LiveActivityRegistration | null> {
  if (!redis) return null;
  return (await redis.get<LiveActivityRegistration>(regKey(id))) ?? null;
}

export async function putToken(
  id: string,
  apnsToken: string,
  arrivalEpochMs: number | undefined,
  now = Date.now(),
): Promise<void> {
  if (!redis) return;
  const ttl =
    arrivalEpochMs != null ? recordTtlSeconds(arrivalEpochMs, now) : undefined;
  await redis.set(tokenKey(id), apnsToken, ttl != null ? { ex: ttl } : undefined);
}

export async function getToken(id: string): Promise<string | null> {
  if (!redis) return null;
  return (await redis.get<string>(tokenKey(id))) ?? null;
}

export async function getLastSent(id: string): Promise<LastSent | null> {
  if (!redis) return null;
  return (await redis.get<LastSent>(sentKey(id))) ?? null;
}

export async function setLastSent(
  id: string,
  sent: LastSent,
  arrivalEpochMs: number,
  now = Date.now(),
): Promise<void> {
  if (!redis) return;
  await redis.set(sentKey(id), sent, { ex: recordTtlSeconds(arrivalEpochMs, now) });
}

export async function listActiveIds(): Promise<string[]> {
  if (!redis) return [];
  return (await redis.smembers(ACTIVE_SET)) ?? [];
}

/** Drop every record for an activity (on end / dead token / arrival). */
export async function removeActivity(id: string): Promise<void> {
  if (!redis) return;
  await Promise.all([
    redis.del(regKey(id)),
    redis.del(tokenKey(id)),
    redis.del(sentKey(id)),
    redis.srem(ACTIVE_SET, id),
  ]);
}
