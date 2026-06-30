import { useEffect, useState } from "react";

/**
 * Returns a `Date` that advances every `intervalMs`, triggering a rerender.
 *
 * The interval pauses while the tab is hidden (and resyncs on becoming visible),
 * so the per-second diagram animation — which recomputes every train's on-path
 * position each tick — doesn't burn CPU on a backgrounded tab.
 */
export function useClockTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id = 0;
    const start = () => {
      stop();
      setNow(new Date()); // resync immediately (drift while hidden)
      id = window.setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      if (id) window.clearInterval(id);
      id = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
  return now;
}
