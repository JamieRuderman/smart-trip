import { useEffect, useState } from "react";

/**
 * Returns the current timestamp (in seconds) that auto-updates on a given
 * interval. The timer only runs while `enabled` is true.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!enabled) return;
    // Sync immediately in case time drifted while disabled.
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);

  return now;
}
