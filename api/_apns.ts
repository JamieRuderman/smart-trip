import { createSign } from "node:crypto";
import { connect } from "node:http2";

/**
 * APNs client for ActivityKit Live Activity pushes (Phase 2). Sends
 * `content-state` updates and `end` events to a per-activity update token so the
 * lock-screen / Dynamic Island countdown stays corrected for delays while the
 * phone is locked (when the app's JS can't run).
 *
 * Credentials come from env (token-based APNs auth, the `.p8` key):
 *   APNS_KEY_ID       — the 10-char Key ID of the .p8 auth key
 *   APNS_TEAM_ID      — Apple Developer team id (e.g. 6YH3537ZY9)
 *   APNS_PRIVATE_KEY  — the .p8 contents (PEM), newlines as real "\n" or literal
 *   APNS_WIDGET_BUNDLE_ID — the APP bundle id (e.g. smart.trip). ActivityKit's
 *                           Live Activity topic is the app's bundle id, NOT the
 *                           widget extension's; the var name is a misnomer kept
 *                           for deploy-config compatibility.
 *   APNS_HOST         — optional; defaults to the production gateway
 *
 * The pure helpers (`apnsJwtClaims`, `buildLiveActivityPayload`,
 * `apnsTopic`) are unit-tested; the network send is integration-only (needs a
 * real key + the widget bundle id, neither of which exists until the native
 * widget ships), so it's kept thin and guarded.
 */

const PRODUCTION_HOST = "api.push.apple.com";

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** PEM contents of the .p8 auth key. */
  signingKey: string;
  /** The APP bundle id (e.g. smart.trip). ActivityKit's Live Activity topic is
   *  the app's bundle id, not the widget extension's — the field name is a
   *  misnomer kept to match the existing APNS_WIDGET_BUNDLE_ID env var. */
  widgetBundleId: string;
  host: string;
}

/** Read + validate APNs config from env. Null (not throwing) when unconfigured,
 *  so the cron degrades to a no-op exactly like the Redis null-guard. */
export function readApnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID;
  const teamId = env.APNS_TEAM_ID;
  const widgetBundleId = env.APNS_WIDGET_BUNDLE_ID;
  const rawKey = env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !widgetBundleId || !rawKey) return null;
  return {
    keyId,
    teamId,
    // Vercel env vars can't hold real newlines; accept "\n"-escaped PEM too.
    signingKey: rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey,
    widgetBundleId,
    host: env.APNS_HOST || PRODUCTION_HOST,
  };
}

/** The APNs topic for Live Activity pushes: the APP bundle id with the fixed
 *  Live Activity suffix (`<app-bundle-id>.push-type.liveactivity`). Pure. */
export function apnsTopic(appBundleId: string): string {
  return `${appBundleId}.push-type.liveactivity`;
}

/** Build the ES256 JWT claims for an APNs provider token. Pure; exported for
 *  tests. `iat` is seconds. APNs rejects tokens older than 1h, so callers
 *  should cache by `iat` and refresh well within that. */
export function apnsJwtClaims(args: {
  teamId: string;
  nowSeconds: number;
}): { iss: string; iat: number } {
  return { iss: args.teamId, iat: args.nowSeconds };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Sign an APNs provider JWT (ES256) from the .p8 key. The header carries the
 *  Key ID; the payload the team id + issued-at. */
export function signApnsJwt(config: ApnsConfig, nowSeconds: number): string {
  const header = { alg: "ES256", kid: config.keyId };
  const claims = apnsJwtClaims({ teamId: config.teamId, nowSeconds });
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims),
  )}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  // dsaEncoding "ieee-p1363" yields the raw r||s signature APNs (JOSE ES256)
  // expects, not the DER encoding createSign emits by default.
  const signature = signer.sign({
    key: config.signingKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

export type LiveActivityPushEvent = "update" | "end";

/**
 * Build the APNs JSON body for a Live Activity push. Pure; exported for tests.
 *
 * `contentState` is the SAME `Record<string,string>` the client sends via
 * `encodeContentState`, but ActivityKit decodes the push's `content-state`
 * with the WIDGET's `ContentState` Codable — and the capacitor-live-activity
 * plugin's `GenericAttributes.ContentState` is `{ values: [String: String] }`.
 * So the flat dict must be wrapped under a `values` key here; sending it flat
 * would fail decoding and iOS would silently drop every push.
 *
 * `staleEpochMs` → `stale-date` (seconds): iOS dims the activity if no fresher
 * push arrives by then. For an `end` event, `dismissEpochMs` → `dismissal-date`.
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
  if (args.staleEpochMs != null) {
    aps["stale-date"] = Math.floor(args.staleEpochMs / 1000);
  }
  if (args.event === "end" && args.dismissEpochMs != null) {
    aps["dismissal-date"] = Math.floor(args.dismissEpochMs / 1000);
  }
  return { aps };
}

export interface ApnsSendResult {
  status: number;
  /** APNs `apns-id` echo / error reason, for logging. */
  reason?: string;
}

/** Abort a hung APNs connection/stream after this long, so one bad send can't
 *  hold the serverless function until the platform timeout. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Send one Live Activity push to a per-activity update token over HTTP/2.
 * Integration-only (real key + token required); opens a short-lived connection
 * per call — fine for the low-volume cron. Throwing is the caller's signal to
 * drop a dead token (e.g. 410 Gone).
 *
 * Both the SESSION and the stream get error handlers: a connection-level
 * failure (DNS, TLS, reset) emits `error` on the session, and an unlistened
 * session `error` is an uncaught exception that would crash the function run.
 */
export async function sendLiveActivityPush(args: {
  config: ApnsConfig;
  token: string;
  jwt: string;
  payload: Record<string, unknown>;
  priority?: number;
}): Promise<ApnsSendResult> {
  const client = connect(`https://${args.config.host}`);
  try {
    return await new Promise<ApnsSendResult>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const fail = (error: unknown) =>
        settle(() =>
          reject(error instanceof Error ? error : new Error(String(error))),
        );
      const timer = setTimeout(() => {
        fail(new Error(`APNs send timed out after ${SEND_TIMEOUT_MS}ms`));
        client.destroy();
      }, SEND_TIMEOUT_MS);
      client.on("error", fail);

      const body = Buffer.from(JSON.stringify(args.payload));
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${args.token}`,
        authorization: `bearer ${args.jwt}`,
        "apns-topic": apnsTopic(args.config.widgetBundleId),
        "apns-push-type": "liveactivity",
        "apns-priority": String(args.priority ?? 10),
        "content-type": "application/json",
        "content-length": String(body.length),
      });
      let status = 0;
      let data = "";
      req.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0);
      });
      req.setEncoding("utf8");
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        let reason: string | undefined;
        try {
          reason = data ? (JSON.parse(data).reason as string) : undefined;
        } catch {
          reason = data || undefined;
        }
        settle(() => resolve({ status, reason }));
      });
      req.on("error", fail);
      req.write(body);
      req.end();
    });
  } finally {
    client.close();
  }
}
