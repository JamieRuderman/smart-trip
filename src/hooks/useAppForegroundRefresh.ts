import { useEffect, useRef } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { logger } from "@/lib/logger";

interface UseAppForegroundRefreshOptions {
  minIntervalMs?: number;
}

/**
 * Runs the callback when the app/browser returns to the foreground or reconnects.
 * Covers web focus + visibility and Capacitor native app resume.
 */
export function useAppForegroundRefresh(
  onRefresh: () => void | Promise<void>,
  { minIntervalMs = 5000 }: UseAppForegroundRefreshOptions = {}
) {
  const onRefreshRef = useRef(onRefresh);
  const lastSuccessfulRefreshAtRef = useRef(0);
  const inFlightRefreshRef = useRef<Promise<void> | null>(null);

  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const triggerRefresh = (reason: string) => {
      if (inFlightRefreshRef.current) {
        return;
      }

      const now = Date.now();
      if (now - lastSuccessfulRefreshAtRef.current < minIntervalMs) {
        return;
      }

      const refreshPromise = Promise.resolve(onRefreshRef.current())
        .then(() => {
          // Throttle only after a successful refresh so failed attempts can retry promptly.
          lastSuccessfulRefreshAtRef.current = Date.now();
        })
        .catch((error) => {
          logger.warn(`Foreground refresh failed (${reason})`, error);
        })
        .finally(() => {
          inFlightRefreshRef.current = null;
        });

      inFlightRefreshRef.current = refreshPromise;
    };

    const onFocus = () => triggerRefresh("window-focus");
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh("visibility-visible");
      }
    };
    const onOnline = () => triggerRefresh("network-online");
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        triggerRefresh("page-show");
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    let didCleanup = false;
    let appStateListener: PluginListenerHandle | null = null;

    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          triggerRefresh("native-app-active");
        }
      })
        .then((listener) => {
          if (didCleanup) {
            listener.remove();
            return;
          }
          appStateListener = listener;
        })
        .catch((error) => {
          logger.warn("Unable to register appStateChange listener", error);
        });
    }

    return () => {
      didCleanup = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      appStateListener?.remove();
    };
  }, [minIntervalMs]);
}
