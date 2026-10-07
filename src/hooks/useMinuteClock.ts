import { useEffect, useMemo, useState } from "react";
import { parseDebugTimeFromUrl } from "@/lib/debugTime";

/**
 * The app's wall clock for countdowns: a `Date` that advances exactly on each
 * minute boundary (so a displayed minute flips when the clock rolls over, not
 * up to ~59s late) and resyncs the instant the app returns to the foreground.
 * Honors the `?debugTime=` URL override by freezing at that instant.
 */
export function useMinuteClock(): Date {
  const debugCurrentTime = useMemo(() => parseDebugTimeFromUrl(), []);
  const [currentTime, setCurrentTime] = useState<Date>(
    () => debugCurrentTime ?? new Date(),
  );
  useEffect(() => {
    if (debugCurrentTime) return;
    let timeoutId = 0;
    let intervalId = 0;
    const tick = () => setCurrentTime(new Date());
    // Align the tick to the wall-clock minute boundary so the displayed minute
    // flips exactly when the clock rolls over, not up to ~59s late.
    const startAligned = () => {
      timeoutId = window.setTimeout(() => {
        tick();
        intervalId = window.setInterval(tick, 60_000);
      }, 60_000 - (Date.now() % 60_000));
    };
    startAligned();
    // JS timers are suspended while the app is backgrounded, so `currentTime`
    // — and every countdown derived from it — is stale on return. Resync the
    // instant we become visible/focused again, then realign the interval.
    const resync = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      tick();
      startAligned();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [debugCurrentTime]);
  return currentTime;
}
