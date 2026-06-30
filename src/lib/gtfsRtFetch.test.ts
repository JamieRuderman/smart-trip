import { describe, expect, it } from "vitest";
import {
  GtfsRtError,
  isFeedUnavailable,
  isUpstreamFeedDown,
} from "@/lib/gtfsRtFetch";

describe("isUpstreamFeedDown", () => {
  it("is true only for a 502 (511 upstream outage)", () => {
    expect(isUpstreamFeedDown(new GtfsRtError(502, 503))).toBe(true);
    expect(isUpstreamFeedDown(new GtfsRtError(500))).toBe(false);
    expect(isUpstreamFeedDown(new TypeError("network"))).toBe(false);
    expect(isUpstreamFeedDown(null)).toBe(false);
  });
});

describe("isFeedUnavailable", () => {
  it("is true for ANY fetch failure, not just a 511 outage", () => {
    // 511 outage
    expect(isFeedUnavailable(new GtfsRtError(502, 503))).toBe(true);
    // our own API erroring
    expect(isFeedUnavailable(new GtfsRtError(500))).toBe(true);
    // client/network failure (fetch reject is a TypeError)
    expect(isFeedUnavailable(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("is false when there is no error (a successful fetch)", () => {
    expect(isFeedUnavailable(null)).toBe(false);
    expect(isFeedUnavailable(undefined)).toBe(false);
  });
});
