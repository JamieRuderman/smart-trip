// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFeedBytes } from "./gtfsrt.js";

/**
 * In-memory stand-in for the edge Cache API (`caches.default`). Stores bytes +
 * headers and returns a fresh Response on each match (Response bodies are
 * single-use). TTL/eviction is irrelevant on the timescales these tests use.
 */
function makeCacheMock() {
  const store = new Map<string, { bytes: Uint8Array; headers: Record<string, string> }>();
  return {
    default: {
      async match(req: Request): Promise<Response | undefined> {
        const e = store.get(req.url);
        return e ? new Response(e.bytes, { headers: e.headers }) : undefined;
      },
      async put(req: Request, res: Response): Promise<void> {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => (headers[k] = v));
        store.set(req.url, { bytes, headers });
      },
    },
  };
}

const FRESHNESS = 15_000;
const BACKOFF = 30_000;
const ORIGIN = "https://t.test";
const env = { TRANSIT_511_API_KEY: "test-key" };
const FEED = new Uint8Array([1, 2, 3]);

let fetchSpy: ReturnType<typeof vi.fn>;
let now = 1_000_000;

const ok511 = () => fetchSpy.mockResolvedValue(new Response(FEED, { status: 200 }));
const fail511 = () => fetchSpy.mockRejectedValue(new Error("511 down"));
const get = () => getFeedBytes(env, "tripupdates", FRESHNESS, ORIGIN);

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  (globalThis as unknown as { caches: unknown }).caches = makeCacheMock();
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe("getFeedBytes — Cache API caching + resilience", () => {
  it("fetches 511 on a cold cache, then serves the fresh entry without re-fetching", async () => {
    ok511();
    expect(Array.from(await get())).toEqual([1, 2, 3]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    now += FRESHNESS - 1; // still fresh
    await get();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the freshness window passes", async () => {
    ok511();
    await get();
    now += FRESHNESS + 1;
    await get();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("serves last-known-good (not an error) when 511 fails", async () => {
    ok511();
    await get();
    now += FRESHNESS + 1;
    fail511();
    expect(Array.from(await get())).toEqual([1, 2, 3]);
  });

  it("backs off after a failure — does NOT re-hit 511 on every poll", async () => {
    ok511();
    await get(); // fetch #1 (populate)
    now += FRESHNESS + 1;
    fail511();
    await get(); // fetch #2 (fails → sets backoff)
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Polls within the backoff window serve stale WITHOUT calling 511.
    now += 5_000;
    await get();
    await get();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Past the backoff window, 511 is retried once more.
    now += BACKOFF;
    await get();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("clears the backoff once 511 recovers", async () => {
    ok511();
    await get();
    now += FRESHNESS + 1;
    fail511();
    await get(); // backoff set
    now += BACKOFF + 1;
    ok511(); // 511 back
    await get(); // refresh succeeds → clears retry-after
    const after = fetchSpy.mock.calls.length;
    await get(); // now fresh again → no new fetch
    expect(fetchSpy.mock.calls.length).toBe(after);
  });
});
