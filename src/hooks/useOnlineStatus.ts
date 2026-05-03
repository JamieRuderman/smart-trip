import { useEffect, useState } from "react";

/**
 * Reactive `navigator.onLine` value. Re-renders on `online` / `offline`
 * events so consumers can switch UI when connectivity changes.
 *
 * Note: `navigator.onLine` is a coarse signal — it reports network-interface
 * status, not whether the app's API is actually reachable. Treat `false` as
 * "definitely offline" and `true` as "probably online". Components that
 * depend on a specific endpoint should still listen to that endpoint's
 * own freshness signals (e.g. `lastUpdated` from polling hooks).
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
