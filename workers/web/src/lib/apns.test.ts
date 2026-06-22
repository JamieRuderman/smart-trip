// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  alternateApnsHost,
  apnsTopic,
  buildLiveActivityPayload,
  PRODUCTION_HOST,
  readApnsConfig,
  SANDBOX_HOST,
  signApnsJwt,
  type ApnsConfig,
} from "./apns.js";

/** Export a freshly generated EC P-256 private key as PKCS#8 PEM, the format
 *  `signApnsJwt` (and a real Apple .p8) uses. */
async function generateP8Pem(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  };
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe("signApnsJwt (WebCrypto ES256)", () => {
  it("produces a header.payload.signature JWT that verifies against the public key", async () => {
    const { pem, publicKey } = await generateP8Pem();
    const config: ApnsConfig = {
      keyId: "KEY1234567",
      teamId: "TEAM123456",
      signingKey: pem,
      appBundleId: "smart.trip",
      host: PRODUCTION_HOST,
    };

    const jwt = await signApnsJwt(config, 1700);
    const [headerB64, payloadB64, sigB64] = jwt.split(".");

    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
    expect(header).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(payload).toEqual({ iss: "TEAM123456", iat: 1700 });

    // The signature must verify over `header.payload` as raw r‖s (P1363) — the
    // shape JOSE ES256 requires and crypto.subtle.verify expects directly.
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    expect(ok).toBe(true);
  });
});

describe("apnsTopic", () => {
  it("appends the Live Activity push-type suffix to the app bundle id", () => {
    expect(apnsTopic("smart.trip")).toBe("smart.trip.push-type.liveactivity");
  });
});

describe("alternateApnsHost", () => {
  it("flips sandbox↔production and treats unknown as production", () => {
    expect(alternateApnsHost(SANDBOX_HOST)).toBe(PRODUCTION_HOST);
    expect(alternateApnsHost(PRODUCTION_HOST)).toBe(SANDBOX_HOST);
    expect(alternateApnsHost("api.example.com")).toBe(SANDBOX_HOST);
  });
});

describe("readApnsConfig", () => {
  const base = {
    APNS_KEY_ID: "KEY1234567",
    APNS_TEAM_ID: "TEAM123456",
    APNS_APP_ID: "smart.trip",
    APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  };

  it("is null when any secret is missing", () => {
    expect(readApnsConfig({})).toBeNull();
    const { APNS_KEY_ID: _omit, ...partial } = base;
    void _omit;
    expect(readApnsConfig(partial)).toBeNull();
  });

  it("un-escapes \\n in the PEM and defaults the host to production", () => {
    const cfg = readApnsConfig(base)!;
    expect(cfg.host).toBe(PRODUCTION_HOST);
    expect(cfg.signingKey).toContain("\n");
    expect(cfg.signingKey).not.toContain("\\n");
  });
});

describe("buildLiveActivityPayload", () => {
  const contentState = { phase: "en-route", delayMinutes: "4" };

  it("wraps content-state under values + sets stale-date (seconds)", () => {
    const payload = buildLiveActivityPayload({
      event: "update",
      contentState,
      timestampSeconds: 1000,
      staleEpochMs: 2_000_000,
    });
    expect(payload).toEqual({
      aps: {
        timestamp: 1000,
        event: "update",
        "content-state": { values: contentState },
        "stale-date": 2000,
      },
    });
  });

  it("adds dismissal-date only on end events", () => {
    const update = buildLiveActivityPayload({
      event: "update",
      contentState,
      timestampSeconds: 1,
      dismissEpochMs: 5000,
    });
    expect((update.aps as Record<string, unknown>)["dismissal-date"]).toBeUndefined();

    const end = buildLiveActivityPayload({
      event: "end",
      contentState,
      timestampSeconds: 1,
      dismissEpochMs: 5000,
    });
    expect((end.aps as Record<string, unknown>)["dismissal-date"]).toBe(5);
  });
});
