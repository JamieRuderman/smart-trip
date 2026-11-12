import { useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useLocation, useNavigate } from "react-router-dom";
import { nativeSharedTripLocation } from "@/lib/sharedTrip";

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
      if (router.current.location !== location) {
        router.current.location = location;
        router.current.navigate(location);
      }
    };

    const listener = App.addListener("appUrlOpen", ({ url }) => openLink(url));
    void App.getLaunchUrl().then((launch) => {
      if (launch && !receivedLink) openLink(launch.url);
    }).catch(() => {});

    return () => {
      active = false;
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);
}
