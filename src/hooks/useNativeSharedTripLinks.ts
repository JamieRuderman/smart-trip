import { useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useLocation, useNavigate } from "react-router-dom";
import { nativeSharedTripLocation } from "@/lib/sharedTrip";

const HANDLED_LINK_KEY = "smart-trip-handled-link";

function handledLink(): string | null {
  try {
    return sessionStorage.getItem(HANDLED_LINK_KEY);
  } catch {
    return null;
  }
}

function rememberHandledLink(url: string): void {
  try {
    sessionStorage.setItem(HANDLED_LINK_KEY, url);
  } catch {
    // Ignore storage errors (private mode).
  }
}

export function useNativeSharedTripLinks() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const router = useRef({ navigate, location: pathname + search });
  router.current = { navigate, location: pathname + search };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let receivedLink = false;
    const openLink = (url: string, fromLaunch: boolean) => {
      if (!active) return;
      const location = nativeSharedTripLocation(url);
      if (!location) return;
      receivedLink = true;
      // getLaunchUrl keeps returning the last opened link for the life of the
      // native process, so a WebView reload would otherwise replay it.
      if (fromLaunch && handledLink() === url) return;
      rememberHandledLink(url);
      if (router.current.location !== location) {
        router.current.location = location;
        router.current.navigate(location);
      }
    };

    const listener = App.addListener("appUrlOpen", ({ url }) => openLink(url, false));
    void App.getLaunchUrl().then((launch) => {
      if (launch && !receivedLink) openLink(launch.url, true);
    }).catch(() => {});

    return () => {
      active = false;
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);
}
