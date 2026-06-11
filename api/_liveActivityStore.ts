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

/** Fallback TTL for a token that arrives before (or without) its registration
 *  — without it an orphaned token would live forever. A token is useless once
 *  its trip day is over, so a day is generous. Seconds. */
const ORPHAN_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** Sliding TTL on the active-id set: it only needs to outlive the trips it
 *  indexes, so if nothing registers for a day, whatever remains is dead and
 *  the whole index can expire with it. Seconds. */
const ACTIVE_SET_TTL_SECONDS = 24 * 60 * 60;

export const regKey = (id: string) => `la:reg:${id}`;
export const tokenKey = (id: string) => `la:tok:${id}`;
export const sentKey = (id: string) => `la:sent:${id}`;
export const ACTIVE_SET = "la:active";
const JWT_CACHE_KEY = "la:jwt";

/** Last delay/phase/cancellation we pushed, so the cron can diff and skip
 *  no-ops. */
export interface LastSent {
  delayMinutes: number;
  phase: "pre-departure" | "en-route";
  isEnded: boolean;
  isCanceled: boolean;
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
  // Sliding expiry AFTER the sadd so the set always outlives its newest member
  // — per-member records TTL on their own; this only reaps the index itself.
  await redis.expire(ACTIVE_SET, ACTIVE_SET_TTL_SECONDS);
}

/** How many activities are currently indexed — the register endpoint's
 *  capacity gate (it's public, so junk must be boundable). */
export async function countActiveIds(): Promise<number> {
  if (!redis) return 0;
  return (await redis.scard(ACTIVE_SET)) ?? 0;
}

/** Whether `id` is already registered (a re-registration must never be
 *  refused by the capacity gate). */
export async function hasRegistration(id: string): Promise<boolean> {
  if (!redis) return false;
  return ((await redis.exists(regKey(id))) ?? 0) > 0;
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
  // No known arrival (token beat the registration, or it never came) → a
  // bounded fallback TTL, so an orphaned token can't live forever.
  const ttl =
    arrivalEpochMs != null
      ? recordTtlSeconds(arrivalEpochMs, now)
      : ORPHAN_TOKEN_TTL_SECONDS;
  await redis.set(tokenKey(id), apnsToken, { ex: ttl });
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

/**
 * Cross-invocation cache for the signed APNs provider JWT. APNs rejects
 * provider tokens older than 1h but ALSO throttles token churn
 * (`TooManyProviderTokenUpdates` — Apple wants one token reused for 20–60
 * min), so a serverless cron must NOT sign a fresh JWT per run. TTL'd well
 * inside the 1h validity.
 */
const JWT_CACHE_TTL_SECONDS = 45 * 60;

export async function getCachedApnsJwt(): Promise<string | null> {
  if (!redis) return null;
  return (await redis.get<string>(JWT_CACHE_KEY)) ?? null;
}

export async function setCachedApnsJwt(jwt: string): Promise<void> {
  if (!redis) return;
  await redis.set(JWT_CACHE_KEY, jwt, { ex: JWT_CACHE_TTL_SECONDS });
}

/** Drop the cached JWT (e.g. APNs reports `ExpiredProviderToken` after a key
 *  rotation or clock skew) so the next run signs fresh. */
export async function clearCachedApnsJwt(): Promise<void> {
  if (!redis) return;
  await redis.del(JWT_CACHE_KEY);
}
