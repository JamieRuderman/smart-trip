import { describe, expect, it } from "vitest";
import { buildFeedbackMailto, FEEDBACK_EMAIL } from "./feedback";

function parse(mailto: string) {
  const url = new URL(mailto);
  return {
    to: url.pathname,
    subject: url.searchParams.get("subject"),
    body: url.searchParams.get("body") ?? "",
  };
}

describe("buildFeedbackMailto", () => {
  it("includes the app version, build and device in a native report", () => {
    const { to, subject, body } = parse(
      buildFeedbackMailto({
        platform: "Android",
        appVersion: "1.14.1 (34)",
        osVersion: "16",
        model: "Google Pixel 9",
        language: "en",
      }),
    );
    expect(to).toBe(FEEDBACK_EMAIL);
    expect(subject).toBe("SMART trip feedback (Android 1.14.1 (34))");
    expect(body).toContain("App version: 1.14.1 (34)");
    expect(body).toContain("OS version: 16");
    expect(body).toContain("Device: Google Pixel 9");
    expect(body.startsWith("\n\n")).toBe(true);
  });

  it("omits fields the platform can't provide", () => {
    const { subject, body } = parse(buildFeedbackMailto({ platform: "Web" }));
    expect(subject).toBe("SMART trip feedback (Web)");
    expect(body).toContain("Platform: Web");
    expect(body).not.toContain("App version");
    expect(body).not.toContain("undefined");
  });
});
