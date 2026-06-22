import { describe, it, expect } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  alternateApnsHost,
  apnsJwtClaims,
  apnsTopic,
  buildLiveActivityPayload,
  PRODUCTION_HOST,
  readApnsConfig,
  SANDBOX_HOST,
  signApnsJwt,
  type ApnsConfig,
} from "./_apns.js";

describe("apnsTopic", () => {
  it("appends the Live Activity push-type suffix to the app bundle id", () => {
    // ActivityKit's topic is the APP bundle id, not the widget's
    // (smart.trip.widget) — see _apns.ts / docs/live-activity-push.md.
    expect(apnsTopic("smart.trip")).toBe(
      "smart.trip.push-type.liveactivity",
    );
  });
});

describe("alternateApnsHost", () => {
  it("flips between the sandbox and production gateways", () => {
    expect(alternateApnsHost(SANDBOX_HOST)).toBe(PRODUCTION_HOST);
    expect(alternateApnsHost(PRODUCTION_HOST)).toBe(SANDBOX_HOST);
  });

  it("treats an unknown host as production so the fallback hits sandbox", () => {
    expect(alternateApnsHost("api.example.com")).toBe(SANDBOX_HOST);
  });
});

describe("apnsJwtClaims", () => {
  it("sets iss=teamId and iat=now (seconds)", () => {
    expect(apnsJwtClaims({ teamId: "TEAM123", nowSeconds: 1000 })).toEqual({
      iss: "TEAM123",
      iat: 1000,
    });
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
    expect(readApnsConfig({} as NodeJS.ProcessEnv)).toBeNull();
    const { APNS_KEY_ID: _omit, ...partial } = base;
    void _omit;
    expect(readApnsConfig(partial as NodeJS.ProcessEnv)).toBeNull();
  });

  it("un-escapes \\n in the PEM and defaults the host", () => {
    const cfg = readApnsConfig(base as unknown as NodeJS.ProcessEnv)!;
    expect(cfg.host).toBe("api.push.apple.com");
    expect(cfg.signingKey).toContain("\n");
    expect(cfg.signingKey).not.toContain("\\n");
  });
});

describe("buildLiveActivityPayload", () => {
  const contentState = { phase: "en-route", delayMinutes: "4" };

  it("builds an update payload with content-state + stale-date (seconds)", () => {
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
        // Wrapped under `values`: that's the Codable shape of the plugin's
        // GenericAttributes.ContentState, which ActivityKit uses to decode the
        // push. A flat dict here fails decoding and the update is dropped.
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
    expect((end.aps as Record<string, unknown>).event).toBe("end");
  });
});

describe("signApnsJwt", () => {
  it("produces a verifiable ES256 JWT (header.payload.signature)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const config: ApnsConfig = {
      keyId: "KEY1234567",
      teamId: "TEAM123456",
      signingKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      appBundleId: "smart.trip",
      host: "api.push.apple.com",
    };

    const jwt = signApnsJwt(config, 1700);
    const [headerB64, payloadB64, sigB64] = jwt.split(".");
    expect(sigB64).toBeTruthy();

    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    expect(header).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(payload).toEqual({ iss: "TEAM123456", iat: 1700 });

    const verifier = createVerify("SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const ok = verifier.verify(
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(sigB64, "base64url"),
    );
    expect(ok).toBe(true);
  });
});
