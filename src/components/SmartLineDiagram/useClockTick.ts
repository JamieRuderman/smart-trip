import { useEffect, useState } from "react";

/** Returns a `Date` that advances every `intervalMs`, triggering a rerender. */
export function useClockTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
