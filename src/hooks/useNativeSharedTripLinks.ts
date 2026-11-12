import { useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useLocation, useNavigate } from "react-router-dom";
import { nativeSharedTripLocation } from "@/lib/sharedTrip";

const HANDLED_LINK_KEY = "smart-trip-handled-link";

export function useNativeSharedTripLinks() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const router = useRef({ navigate, location: pathname + search });
  router.current = { navigate, location: pathname + search };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let receivedLink = false;
    const openLink = (url: string) => {
      if (!active) return;
      const location = nativeSharedTripLocation(url);
      if (!location) return;
      receivedLink = true;
      sessionStorage.setItem(HANDLED_LINK_KEY, url);
      if (router.current.location !== location) {
        router.current.location = location;
        router.current.navigate(location);
      }
    };

    const listener = App.addListener("appUrlOpen", ({ url }) => openLink(url));
    void App.getLaunchUrl().then((launch) => {
      // getLaunchUrl keeps returning the last opened link for the life of the
      // native process, so a WebView reload would otherwise replay it.
      if (launch && !receivedLink && launch.url !== sessionStorage.getItem(HANDLED_LINK_KEY)) {
        openLink(launch.url);
      }
    }).catch(() => {});

    return () => {
      active = false;
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);
}
