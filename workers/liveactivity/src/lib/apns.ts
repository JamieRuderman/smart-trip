/**
 * APNs client for the **Cloudflare Workers** runtime — Live Activity pushes.
 *
 * `node:http2` + `node:crypto` don't exist on Workers, so the two non-portable
 * pieces are implemented with web standards:
 *   - ES256 provider-JWT signing via **WebCrypto** (`crypto.subtle`, ECDSA P-256)
 *   - the HTTP/2 POST via **`fetch()`** (Workers speaks HTTP/2 to APNs in prod)
 *
 * The pure status/content logic is shared (imported from `src/lib` / `api/`);
 * this APNs transport layer is the only Workers-specific implementation.
 */

export const PRODUCTION_HOST = "api.push.apple.com";
export const SANDBOX_HOST = "api.sandbox.push.apple.com";

/** The other APNs gateway. A Live Activity token is bound to ONE environment —
 *  sandbox (dev build) or production (TestFlight/App Store) — so a caller that
 *  gets `BadDeviceToken` from one retries the other. The provider JWT is valid
 *  for both. */
export function alternateApnsHost(host: string): string {
  return host === SANDBOX_HOST ? PRODUCTION_HOST : SANDBOX_HOST;
}

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** PEM contents of the .p8 auth key (PKCS#8). */
  signingKey: string;
  /** App bundle id (e.g. smart.trip). Topic = `${appBundleId}.push-type.liveactivity`. */
  appBundleId: string;
  host: string;
}

/** Env shape the APNs config is read from (Worker `env`, not `process.env`). */
export interface ApnsEnv {
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_APP_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_HOST?: string;
}

/** Read + validate APNs config from the Worker env. Null (not throwing) when
 *  unconfigured, so the push path degrades to a no-op. */
export function readApnsConfig(env: ApnsEnv): ApnsConfig | null {
  const { APNS_KEY_ID, APNS_TEAM_ID, APNS_APP_ID, APNS_PRIVATE_KEY } = env;
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_APP_ID || !APNS_PRIVATE_KEY) return null;
  return {
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    appBundleId: APNS_APP_ID,
    // Secrets can't hold real newlines; accept "\n"-escaped PEM too.
    signingKey: APNS_PRIVATE_KEY.includes("\\n")
      ? APNS_PRIVATE_KEY.replace(/\\n/g, "\n")
      : APNS_PRIVATE_KEY,
    host: env.APNS_HOST || PRODUCTION_HOST,
  };
}

/** APNs Live Activity topic: app bundle id + the fixed suffix. Pure. */
export function apnsTopic(appBundleId: string): string {
  return `${appBundleId}.push-type.liveactivity`;
}

function base64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlFromString(s: string): string {
  return base64urlFromBytes(new TextEncoder().encode(s));
}

/** Decode a PKCS#8 PEM into the raw DER bytes `crypto.subtle.importKey` wants. */
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Sign an APNs provider JWT (ES256) with WebCrypto. Async (importKey/sign are
 * promises, unlike Node's sync `createSign`). ECDSA P-256/SHA-256 yields the raw
 * r‖s (IEEE P1363) signature JOSE ES256 expects — no DER unwrapping needed.
 * `iat` is seconds; APNs rejects tokens older than 1h, so cache by `iat`.
 */
export async function signApnsJwt(config: ApnsConfig, nowSeconds: number): Promise<string> {
  const header = { alg: "ES256", kid: config.keyId };
  const claims = { iss: config.teamId, iat: nowSeconds };
  const signingInput = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(
    JSON.stringify(claims),
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(config.signingKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64urlFromBytes(new Uint8Array(signature))}`;
}

export type LiveActivityPushEvent = "update" | "end";

/**
 * Build the APNs JSON body for a Live Activity push. Pure. The flat
 * content-state dict is wrapped under `values` to match the plugin's
 * `GenericAttributes.ContentState` Codable, or iOS drops the push.
 */
export function buildLiveActivityPayload(args: {
  event: LiveActivityPushEvent;
  contentState: Record<string, string>;
  timestampSeconds: number;
  staleEpochMs?: number;
  dismissEpochMs?: number;
}): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    timestamp: args.timestampSeconds,
    event: args.event,
    "content-state": { values: args.contentState },
  };
  if (args.staleEpochMs != null) aps["stale-date"] = Math.floor(args.staleEpochMs / 1000);
  if (args.event === "end" && args.dismissEpochMs != null) {
    aps["dismissal-date"] = Math.floor(args.dismissEpochMs / 1000);
  }
  return { aps };
}

export interface ApnsSendResult {
  status: number;
  /** APNs error `reason` (e.g. BadDeviceToken), for routing/logging. */
  reason?: string;
}

/** Send one Live Activity push over `fetch` (HTTP/2 to APNs in production). */
export async function sendLiveActivityPush(args: {
  config: ApnsConfig;
  token: string;
  jwt: string;
  payload: Record<string, unknown>;
  priority?: number;
}): Promise<ApnsSendResult> {
  const res = await fetch(`https://${args.config.host}/3/device/${args.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${args.jwt}`,
      "apns-topic": apnsTopic(args.config.appBundleId),
      "apns-push-type": "liveactivity",
      "apns-priority": String(args.priority ?? 10),
      "content-type": "application/json",
    },
    body: JSON.stringify(args.payload),
  });
  // APNs returns an empty body on success and `{"reason":"…"}` on error. Read the
  // text once (can't re-read a consumed body) and parse only if present.
  const text = await res.text();
  let reason: string | undefined;
  if (text) {
    try {
      reason = (JSON.parse(text) as { reason?: string }).reason;
    } catch {
      reason = text;
    }
  }
  return { status: res.status, reason };
}
