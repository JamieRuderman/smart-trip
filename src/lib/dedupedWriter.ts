/**
 * Keyed, deduplicated, order-preserving async writer.
 *
 * Extracted from the Live Activity controller's registration POST, where three
 * independent triggers (boot reconcile, the arm path, and every drift/delay
 * content sync) all re-assert the same payload — so the naive "remember the last
 * accepted payload" guard both spammed the backend and, worse, raced itself: the
 * remembered value is only written AFTER the response lands, so two callers
 * arriving together both saw a miss and both sent.
 *
 * Guarantees, per key:
 * - an identical payload already **in flight** is joined, not re-sent;
 * - an identical payload already **accepted** is skipped entirely;
 * - a *different* payload is chained behind whatever is in flight, so writes
 *   reach the sink in request order (the sink is a last-write-wins upsert, so
 *   an older payload landing second would clobber newer state);
 * - a write the sink REJECTS is not remembered, so the next trigger retries it.
 */

/** Sink for a write. Returns whether the sink accepted it — a false (or thrown)
 *  result is not remembered, so the value is retried on the next call. */
export type WriteSink<T> = (value: T) => Promise<boolean>;

export interface DedupedWriter<T> {
  /** Write `value` under `key` unless an identical one is already accepted or
   *  in flight. Resolves once this value's write (or the one it joined) has
   *  settled. Never rejects. */
  write(key: string, value: T): Promise<void>;
  /** Forget the last-accepted payload for `key`, so the next `write` re-sends
   *  even if the payload is unchanged. For teardown, when the remote record is
   *  known to be gone. */
  forget(key: string): void;
  /** Whether an identical payload is currently remembered as accepted. Test +
   *  diagnostic seam; callers shouldn't branch on this. */
  isAccepted(key: string, value: T): boolean;
}

export function createDedupedWriter<T>(
  send: WriteSink<T>,
  serialize: (value: T) => string = (value) => JSON.stringify(value),
): DedupedWriter<T> {
  /** Last payload the sink ACCEPTED, per key. */
  const accepted = new Map<string, string>();
  /** The write currently on the wire, per key, with the payload it carries. */
  const inFlight = new Map<string, { json: string; promise: Promise<void> }>();

  async function write(key: string, value: T): Promise<void> {
    const json = serialize(value);
    if (accepted.get(key) === json) return;
    const current = inFlight.get(key);
    // Same payload already on the wire — join it rather than duplicate it.
    if (current?.json === json) return current.promise;

    const promise = (async () => {
      // A different payload is in flight: let it settle so the sink sees these
      // writes in request order. It never rejects (we catch below), so waiting
      // on it can't strand the chain.
      if (current) await current.promise;
      // Re-check after the wait — the write we queued behind may have carried
      // this very payload (several callers arriving during one in-flight write).
      if (accepted.get(key) === json) return;
      let ok = false;
      try {
        ok = await send(value);
      } catch {
        // A throwing sink is a failed write, not a crash for the caller: leave
        // it unremembered so the next trigger retries.
        ok = false;
      }
      if (ok) accepted.set(key, json);
    })();

    const entry = { json, promise };
    inFlight.set(key, entry);
    try {
      await promise;
    } finally {
      // Only clear if we're still the newest entry — a later caller may have
      // chained behind us and installed its own.
      if (inFlight.get(key) === entry) inFlight.delete(key);
    }
  }

  return {
    write,
    forget: (key) => void accepted.delete(key),
    isAccepted: (key, value) => accepted.get(key) === serialize(value),
  };
}
