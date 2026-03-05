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
  const lastRefreshAtRef = useRef(0);

  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const triggerRefresh = (reason: string) => {
      const now = Date.now();
      if (now - lastRefreshAtRef.current < minIntervalMs) {
        return;
      }

      lastRefreshAtRef.current = now;

      Promise.resolve(onRefreshRef.current()).catch((error) => {
        logger.warn(`Foreground refresh failed (${reason})`, error);
      });
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
