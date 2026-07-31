import { describe, expect, it, vi } from "vitest";
import { createDedupedWriter } from "./dedupedWriter";

/** A sink whose individual writes can be resolved by the test, so concurrent
 *  callers can be held mid-flight and the race window inspected. */
function controllableSink() {
  const calls: { value: unknown; resolve: (ok: boolean) => void }[] = [];
  const send = vi.fn(
    (value: unknown) =>
      new Promise<boolean>((resolve) => {
        calls.push({ value, resolve });
      }),
  );
  return { send, calls };
}

const REG = { id: "trip-1", lead: 15 };

describe("createDedupedWriter", () => {
  it("sends a first write through to the sink", async () => {
    const { send, calls } = controllableSink();
    const writer = createDedupedWriter(send);
    const p = writer.write(REG.id, REG);
    expect(send).toHaveBeenCalledTimes(1);
    calls[0].resolve(true);
    await p;
    expect(writer.isAccepted(REG.id, REG)).toBe(true);
  });

  it("collapses concurrent IDENTICAL writes into ONE send", async () => {
    // The regression: boot reconcile and the first content sync both fire on a
    // cold start, and the last-accepted guard can't see a write that hasn't
    // landed yet — so both used to POST.
    const { send, calls } = controllableSink();
    const writer = createDedupedWriter(send);

    const a = writer.write(REG.id, REG);
    const b = writer.write(REG.id, { ...REG });
    const c = writer.write(REG.id, { ...REG });
    expect(send).toHaveBeenCalledTimes(1);

    calls[0].resolve(true);
    await Promise.all([a, b, c]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("skips a repeat of an already-accepted payload", async () => {
    const { send, calls } = controllableSink();
    const writer = createDedupedWriter(send);
    const first = writer.write(REG.id, REG);
    calls[0].resolve(true);
    await first;

    await writer.write(REG.id, { ...REG });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends a CHANGED payload, chained after the in-flight one, in order", async () => {
    // A reminder re-armed mid-flight must not land before the older payload —
    // register is a last-write-wins upsert, so out-of-order would restore the
    // stale lead.
    const { send, calls } = controllableSink();
    const writer = createDedupedWriter(send);

    const older = writer.write(REG.id, REG);
    const newer = writer.write(REG.id, { ...REG, lead: 45 });
    // The second write must NOT be on the wire while the first is unsettled.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(REG);

    calls[0].resolve(true);
    await older;
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ ...REG, lead: 45 });

    calls[1].resolve(true);
    await newer;
    expect(writer.isAccepted(REG.id, { ...REG, lead: 45 })).toBe(true);
  });

  it("does not remember a REJECTED write, so the next call retries", async () => {
    const { send, calls } = controllableSink();
    const writer = createDedupedWriter(send);

    const first = writer.write(REG.id, REG);
    calls[0].resolve(false);
    await first;
    expect(writer.isAccepted(REG.id, REG)).toBe(false);

    const retry = writer.write(REG.id, REG);
    expect(send).toHaveBeenCalledTimes(2);
    calls[1].resolve(true);
    await retry;
    expect(writer.isAccepted(REG.id, REG)).toBe(true);
  });

  it("treats a THROWING sink as a failed write, without rejecting the caller", async () => {
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    const writer = createDedupedWriter(send);
    await expect(writer.write(REG.id, REG)).resolves.toBeUndefined();
    expect(writer.isAccepted(REG.id, REG)).toBe(false);
  });

  it("keys independently — a second activity id is not deduped against the first", async () => {
    const { send, calls } = controllableSink();
    const writer = createDedupedWriter(send);
    void writer.write("trip-1", REG);
    void writer.write("trip-2", REG);
    expect(send).toHaveBeenCalledTimes(2);
    calls.forEach((c) => c.resolve(true));
  });

  it("forget() makes an unchanged payload send again", async () => {
    const { send, calls } = controllableSink();
    const writer = createDedupedWriter(send);
    const first = writer.write(REG.id, REG);
    calls[0].resolve(true);
    await first;

    writer.forget(REG.id);
    const again = writer.write(REG.id, REG);
    expect(send).toHaveBeenCalledTimes(2);
    calls[1].resolve(true);
    await again;
  });
});
